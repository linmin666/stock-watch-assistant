import * as db from "./db.js";
import { fetchKlines, fetchRealtimeSnapshots, sinaSymbolOf, type Kline } from "./eastmoney.js";
import { detectSignals } from "./detector.js";
import { sendSignals } from "./notifier.js";
import { getSettings } from "./db.js";
import { tradingPhase } from "./trading-time.js";
import { fetchIndices, type IndexQuote } from "./indices.js";
import { PERIODS, type EngineStatus, type Period, type Quote, type SignalType } from "../shared/types.js";

const POLL_INTERVAL_MS = 30_000;

interface StockQuoteCache {
  /** key: `${code}-${period}` */
  byPeriod: Map<string, Quote>;
  error: string | null;
  updatedAt: string;
  /** 当日涨跌幅（相对昨收，来自实时快照），快照失败时为 null */
  dayChangePct: number | null;
}

const quoteCache = new Map<string, StockQuoteCache>();

/** 批量拉取实时快照，把当日涨跌幅写入缓存（失败不影响 K 线轮询） */
async function refreshDayChangePct(stocks: { code: string; name: string; market: string }[]): Promise<void> {
  try {
    const symbols = stocks.map((s) => sinaSymbolOf(s.code, s.market as "SH" | "SZ" | "BJ"));
    const snaps = await fetchRealtimeSnapshots(symbols);
    for (const s of stocks) {
      const snap = snaps.get(sinaSymbolOf(s.code, s.market as "SH" | "SZ" | "BJ"));
      let cache = quoteCache.get(s.code);
      if (!cache) {
        cache = { byPeriod: new Map(), error: null, updatedAt: new Date().toISOString(), dayChangePct: null };
        quoteCache.set(s.code, cache);
      }
      cache.dayChangePct = snap ? snap.changePct : null;
    }
  } catch {
    // 快照失败静默忽略，仅影响当日涨跌幅展示
  }
}

let lastRunAt: string | null = null;
let timer: NodeJS.Timeout | null = null;

/** 指数行情缓存（随每轮轮询/手动刷新更新） */
let indexCache: IndexQuote[] = [];
let indexError: string | null = null;

/** 拉取指数行情并更新缓存（失败保留旧数据） */
export async function refreshIndices(): Promise<void> {
  try {
    indexCache = await fetchIndices();
    indexError = null;
  } catch (err) {
    indexError = err instanceof Error ? err.message : String(err);
  }
}

export function getIndices(): { indices: IndexQuote[]; error: string | null } {
  return { indices: indexCache, error: indexError };
}

function log(msg: string): void {
  console.log(`[engine] ${new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })} ${msg}`);
}

/** 对未推送信号补偿推送一次 */
async function retryUnnotified(): Promise<void> {
  const pending = db.getUnnotifiedSignals();
  if (pending.length === 0) return;
  const ok = await sendSignals(getSettings(), pending);
  if (ok) {
    pending.forEach((s) => db.markNotified(s.id));
    log(`补偿推送成功：${pending.length} 条`);
  }
}

/** 当日涨幅推送阈值（%） */
const DAY_SURGE_THRESHOLD = 7;
/** 当日跌幅推送阈值（%） */
const DAY_PLUNGE_THRESHOLD = -6;

/** 记录当天已触发过当日涨跌推送的股票（代码 -> `${日期}:${type}`），每天每类型最多推送一次 */
const dayMoveFired = new Map<string, Set<string>>();

function todayStr(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }); // YYYY-MM-DD
}

async function checkStockPeriod(code: string, name: string, market: string, period: Period): Promise<void> {
  try {
    const klines: Kline[] = await fetchKlines(code, market as "SH" | "SZ" | "BJ", period);
    const detection = detectSignals(klines);
    const updatedAt = new Date().toISOString();

    // 更新快照缓存（按周期）
    let cache = quoteCache.get(code);
    if (!cache) {
      cache = { byPeriod: new Map(), error: null, updatedAt, dayChangePct: null };
      quoteCache.set(code, cache);
    }
    cache.updatedAt = updatedAt;
    if (detection) {
      const last = klines[klines.length - 1];
      const prev = klines[klines.length - 2];
      const quote: Quote = {
        code,
        name,
        period,
        price: detection.price,
        changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : 0,
        ma30: detection.ma30,
        ma60: detection.ma60,
        priceAboveMa60: detection.price > detection.ma60,
        ma30AboveMa60: detection.ma30 > detection.ma60,
        updatedAt,
      };
      cache.byPeriod.set(String(period), quote);
      cache.error = null;
    } else {
      cache.byPeriod.delete(String(period));
      cache.error = `${period}分钟K线数据不足（需至少61根）`;
    }

    // 策略2：仅 30 分钟周期产生微信推送（金叉/突破）；其余周期只更新页面状态
    if (period !== 30 || !detection) return;
    if (!(detection.goldenCross || detection.breakout)) return;

    const inserted: string[] = [];
    if (detection.goldenCross) {
      const ok = db.insertSignal({
        stockCode: code,
        stockName: name,
        period,
        type: "golden_cross",
        price: detection.price,
        ma30: detection.ma30,
        ma60: detection.ma60,
        klineTime: detection.klineTime,
      });
      if (ok) inserted.push("golden_cross");
    }
    if (detection.breakout) {
      const ok = db.insertSignal({
        stockCode: code,
        stockName: name,
        period,
        type: "breakout",
        price: detection.price,
        ma30: detection.ma30,
        ma60: detection.ma60,
        klineTime: detection.klineTime,
      });
      if (ok) inserted.push("breakout");
    }
    if (inserted.length > 0) {
      log(`${name}(${code}) 30分钟触发推送信号：${inserted.join(" + ")} @ ${detection.klineTime}`);
      await pushPending();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let cache = quoteCache.get(code);
    if (!cache) {
      cache = { byPeriod: new Map(), error: null, updatedAt: new Date().toISOString(), dayChangePct: null };
      quoteCache.set(code, cache);
    }
    cache.error = `${period}分钟：${message}`;
  }
}

/**
 * 策略1/策略3：当日涨幅 > 7% 或跌幅 < -6% 时推送（每天每只股票每类最多一次）
 * 依赖 refreshDayChangePct 先行更新缓存。
 */
async function checkDaySurge(stocks: { code: string; name: string }[]): Promise<void> {
  const today = todayStr();
  for (const s of stocks) {
    const pct = quoteCache.get(s.code)?.dayChangePct;
    if (pct == null) continue;

    const types: SignalType[] = [];
    if (pct > DAY_SURGE_THRESHOLD) types.push("day_surge");
    if (pct < DAY_PLUNGE_THRESHOLD) types.push("day_plunge");
    if (types.length === 0) continue;

    let fired = dayMoveFired.get(s.code);
    if (!fired || fired.size === 0 || !fired.has(today)) fired = new Set([today]);
    const newTypes = types.filter((t) => !fired!.has(t));
    if (newTypes.length === 0) continue; // 今日该类已推送过
    newTypes.forEach((t) => fired!.add(t));
    dayMoveFired.set(s.code, fired);

    for (const type of newTypes) {
      const ok = db.insertSignal({
        stockCode: s.code,
        stockName: s.name,
        period: 1440, // 日级别事件，仅用于展示分类
        type,
        price: quoteCache.get(s.code)?.byPeriod.get("30")?.price ?? 0,
        changePct: pct,
        ma30: 0,
        ma60: 0,
        klineTime: today,
      });
      if (ok) {
        const desc =
          type === "day_surge"
            ? `当日涨幅 ${pct.toFixed(2)}% > ${DAY_SURGE_THRESHOLD}%`
            : `当日跌幅 ${pct.toFixed(2)}% < ${DAY_PLUNGE_THRESHOLD}%`;
        log(`${s.name}(${s.code}) ${desc}，触发推送`);
        await pushPending();
      }
    }
  }
}

async function pushPending(): Promise<void> {
  const pending = db.getUnnotifiedSignals();
  if (pending.length === 0) return;
  const ok = await sendSignals(getSettings(), pending);
  if (ok) {
    pending.forEach((s) => db.markNotified(s.id));
    log(`微信推送成功：${pending.length} 条信号`);
  }
}

/** 批量轮询一组股票的所有周期 */
async function pollStocks(stocks: { code: string; name: string; market: string }[]): Promise<void> {
  await refreshDayChangePct(stocks);
  await Promise.all(
    stocks.flatMap((s) => PERIODS.map((p) => checkStockPeriod(s.code, s.name, s.market, p)))
  );
  // 策略1：涨幅超阈值检查（在快照刷新之后）
  await checkDaySurge(stocks);
}

async function runOnce(): Promise<void> {
  lastRunAt = new Date().toISOString();
  const phase = tradingPhase();
  // 指数行情轻量，每轮都刷新（与个股监控同频）
  refreshIndices().catch(() => {});
  const stocks = db.listStocks();
  if (stocks.length === 0) return;

  // 仅在开盘时段（含午休前后的连续交易时间）轮询监控列表；ETF 池仅在手动刷新时更新
  if (phase !== "trading") {
    // 非开盘时段不拉行情，仅对未推送信号补偿推送
    await retryUnnotified();
    return;
  }
  log(`轮询 ${stocks.length} 只股票 × ${PERIODS.length} 个周期（${phase}）`);
  await pollStocks(stocks);
}

export function startEngine(): void {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => log(`轮询异常：${err instanceof Error ? err.message : String(err)}`));
  }, POLL_INTERVAL_MS);
  // 启动时立即拉取一轮（不受交易时段限制），避免收盘期间页面一直显示"等待引擎首次轮询"
  pollMonitorList().catch((err) => log(`启动首次轮询异常：${err instanceof Error ? err.message : String(err)}`));
  log(`监控引擎已启动，轮询间隔 ${POLL_INTERVAL_MS / 1000}s，周期 ${PERIODS.join("/")}分钟（仅开盘时段轮询）`);
}

export function stopEngine(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log("监控引擎已停止");
  }
}

export function getEngineStatus(): EngineStatus {
  return {
    running: timer != null,
    phase: tradingPhase(),
    nextRunInMs: POLL_INTERVAL_MS,
    lastRunAt,
    todayPushed: db.countTodayPushed(),
    monitoredCount: db.listStocks().length,
  };
}

export function getQuoteCache(): Map<string, StockQuoteCache> {
  return quoteCache;
}

/** 立即轮询 ETF 池一轮（供 ETF 池页面手动刷新），完成后返回 */
export async function pollEtfPool(): Promise<void> {
  const etfStocks = db.listEtfPool();
  if (etfStocks.length === 0) return;
  log(`手动刷新 ETF 池：${etfStocks.length} 只 × ${PERIODS.length} 个周期`);
  await pollStocks(etfStocks);
}

/** 立即轮询监控列表一轮（供监控页手动刷新，不受交易时段限制），完成后返回 */
export async function pollMonitorList(): Promise<void> {
  const stocks = db.listStocks();
  // 手动刷新时同步刷新指数
  refreshIndices().catch(() => {});
  if (stocks.length === 0) return;
  log(`手动刷新监控列表：${stocks.length} 只 × ${PERIODS.length} 个周期`);
  await pollStocks(stocks);
}
