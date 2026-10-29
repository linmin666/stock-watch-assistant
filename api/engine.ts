import * as db from "./db.js";
import { fetchKlines, type Kline } from "./eastmoney.js";
import { detectSignals } from "./detector.js";
import { sendSignals } from "./notifier.js";
import { getSettings } from "./db.js";
import { tradingPhase } from "./trading-time.js";
import { PERIODS, type EngineStatus, type Period, type Quote } from "../shared/types.js";

const POLL_INTERVAL_MS = 30_000;

interface StockQuoteCache {
  /** key: `${code}-${period}` */
  byPeriod: Map<string, Quote>;
  error: string | null;
  updatedAt: string;
}

const quoteCache = new Map<string, StockQuoteCache>();

let lastRunAt: string | null = null;
let timer: NodeJS.Timeout | null = null;

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

async function checkStockPeriod(code: string, name: string, market: string, period: Period): Promise<void> {
  try {
    const klines: Kline[] = await fetchKlines(code, market as "SH" | "SZ" | "BJ", period);
    const detection = detectSignals(klines);
    const updatedAt = new Date().toISOString();

    // 更新快照缓存（按周期）
    let cache = quoteCache.get(code);
    if (!cache) {
      cache = { byPeriod: new Map(), error: null, updatedAt };
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

    if (detection && (detection.goldenCross || detection.breakout)) {
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
        log(`${name}(${code}) ${period}分钟触发信号：${inserted.join(" + ")} @ ${detection.klineTime}`);
        await pushPending();
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let cache = quoteCache.get(code);
    if (!cache) {
      cache = { byPeriod: new Map(), error: null, updatedAt: new Date().toISOString() };
      quoteCache.set(code, cache);
    }
    cache.error = `${period}分钟：${message}`;
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
  await Promise.all(
    stocks.flatMap((s) => PERIODS.map((p) => checkStockPeriod(s.code, s.name, s.market, p)))
  );
}

async function runOnce(): Promise<void> {
  lastRunAt = new Date().toISOString();
  const phase = tradingPhase();
  const stocks = db.listStocks();
  if (stocks.length === 0) return;

  // 定时轮询只处理监控列表；ETF 池仅在手动刷新时更新
  log(`轮询 ${stocks.length} 只股票 × ${PERIODS.length} 个周期（${phase}）`);
  await pollStocks(stocks);
  if (phase === "closed") await retryUnnotified();
}

export function startEngine(): void {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => log(`轮询异常：${err instanceof Error ? err.message : String(err)}`));
  }, POLL_INTERVAL_MS);
  // 启动即跑一次（非交易时段仅补偿推送）
  runOnce().catch((err) => log(`首次运行异常：${err instanceof Error ? err.message : String(err)}`));
  log(`监控引擎已启动，轮询间隔 ${POLL_INTERVAL_MS / 1000}s，周期 ${PERIODS.join("/")}分钟`);
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
