import type { Market, Period } from "../shared/types.js";

export interface Kline {
  time: string; // "2026-10-28 14:30"（分钟精度）
  open: number;
  close: number;
  high: number;
  low: number;
}

/**
 * 根据代码推断市场（沪深北）
 * 规则：6/9/5 开头=沪，0/3 开头=深，4/8 开头=北交所
 */
export function guessMarket(code: string): Market {
  if (/^(6|9|5)/.test(code)) return "SH";
  if (/^(4|8)/.test(code)) return "BJ";
  return "SZ";
}

/** 新浪行情 symbol 前缀 */
function sinaSymbol(code: string, market: Market): string {
  return `${market === "SH" ? "sh" : market === "BJ" ? "bj" : "sz"}${code}`;
}

/** 对外导出：拼新浪 symbol（引擎批量快照用） */
export function sinaSymbolOf(code: string, market: Market): string {
  return sinaSymbol(code, market);
}

/**
 * 过滤未收盘 K 线：新浪盘中会返回当前正在形成的K线（仅最后一根）。
 * 判断依据：bar 开始时间 + period > 当前时刻 → 未收盘，剔除。
 * K线时间统一为 Asia/Shanghai（与系统时区一致），历史 bar 天然已收盘无需处理。
 */
export function dropUnclosedBars(klines: Kline[], period: Period): Kline[] {
  if (klines.length === 0) return klines;
  const last = klines[klines.length - 1];
  const m = last.time.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return klines;
  // 用日期+分钟构造完整时间戳比较，避免跨日误判
  const barStart = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`);
  if (Number.isNaN(barStart.getTime())) return klines;
  const barEnd = barStart.getTime() + period * 60_000;
  const isClosed = barEnd <= Date.now();
  return isClosed ? klines : klines.slice(0, -1);
}

/**
 * 拉取 K 线数据（自动根据周期选择数据源）
 * - 分钟级（5/15/30/60）：新浪财经
 * - 日线/周线：东方财富
 * 返回按时间升序、已收盘的 K 线数组
 */
export async function fetchKlines(code: string, market: Market, period: Period, limit = 150): Promise<Kline[]> {
  if (period === 1440 || period === 10080) {
    return fetchDailyWeeklyKlines(code, market, period, limit);
  }
  return fetchMinuteKlines(code, market, period, limit);
}

/** 新浪分钟级 K 线（5/15/30/60 分钟） */
async function fetchMinuteKlines(code: string, market: Market, period: Period, limit: number): Promise<Kline[]> {
  const symbol = sinaSymbol(code, market);
  const url =
    `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=/CN_MarketDataService.getKLineData` +
    `?symbol=${symbol}&scale=${period}&ma=no&datalen=${limit}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Referer: "https://finance.sina.com.cn/",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`新浪行情接口 HTTP ${resp.status}`);
  const text = await resp.text();
  // 响应为 JSONP：/*...*/ var _=([{...}]);
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("行情接口返回格式异常");
  let arr: Array<{ day: string; open: string; close: string; high: string; low: string }>;
  try {
    arr = JSON.parse(text.slice(start + 1, end));
  } catch {
    throw new Error("行情接口返回解析失败");
  }
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("接口未返回K线数据");
  const klines = arr.map((k) => ({
    time: k.day.slice(0, 16), // "2026-10-28 14:55:00" → "2026-10-28 14:55"
    open: Number(k.open),
    close: Number(k.close),
    high: Number(k.high),
    low: Number(k.low),
  }));
  return dropUnclosedBars(klines, period);
}

/**
 * 新浪日/周 K 线
 * scale: 240=日线, 1200=周线（新浪不支持自定义周期，240/1200 为其内置映射）
 * 返回格式与分钟级一致：{"day":"2026-10-28","open":...,"close":...}
 */
async function fetchDailyWeeklyKlines(code: string, market: Market, period: Period, limit: number): Promise<Kline[]> {
  const symbol = sinaSymbol(code, market);
  const scale = period === 1440 ? 240 : 1200;
  const url =
    `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=/CN_MarketDataService.getKLineData` +
    `?symbol=${symbol}&scale=${scale}&ma=no&datalen=${limit}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Referer: "https://finance.sina.com.cn/",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`新浪行情接口 HTTP ${resp.status}`);
  const text = await resp.text();
  // 响应为 JSONP：/*...*/ var _=([{...}]);
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("行情接口返回格式异常");
  let arr: Array<{ day: string; open: string; close: string; high: string; low: string }>;
  try {
    arr = JSON.parse(text.slice(start + 1, end));
  } catch {
    throw new Error("行情接口返回解析失败");
  }
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("接口未返回K线数据");
  const klines: Kline[] = arr.map((k) => ({
    time: `${k.day.slice(0, 10)} 15:00`, // 日线/周线统一用 15:00 作为时间戳
    open: Number(k.open),
    close: Number(k.close),
    high: Number(k.high),
    low: Number(k.low),
  }));
  // 日线/周线返回的都是已收盘数据，无需 dropUnclosedBars
  return klines;
}

/** 实时快照：当日涨跌幅（相对昨收） */
export interface RealtimeSnapshot {
  price: number; // 最新价
  prevClose: number; // 昨收
  changePct: number; // 当日涨跌幅 %
}

/**
 * 新浪实时快照（hq.sinajs.cn，GBK 编码），支持批量。
 * 用于获取当日涨跌幅（K线接口的单根涨跌不等于当日涨跌）。
 */
export async function fetchRealtimeSnapshots(symbols: string[]): Promise<Map<string, RealtimeSnapshot>> {
  const result = new Map<string, RealtimeSnapshot>();
  if (symbols.length === 0) return result;
  const url = `https://hq.sinajs.cn/list=${symbols.join(",")}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://finance.sina.com.cn/",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`新浪快照接口 HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const text = new TextDecoder("gbk").decode(buf);
  // 格式：var hq_str_sh513050="名称,今开,昨收,最新,最高,最低,...";
  for (const m of text.matchAll(/hq_str_(\w+)="([^"]*)"/g)) {
    const [, symbol, body] = m;
    if (!symbol || !body) continue;
    const f = body.split(",");
    const price = Number(f[3]);
    const prevClose = Number(f[2]);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(prevClose) || prevClose <= 0) continue;
    result.set(symbol, { price, prevClose, changePct: ((price - prevClose) / prevClose) * 100 });
  }
  return result;
}

/** 新浪实时快照（名称解析，用于添加监控时校验代码），GBK 编码需转码 */
export async function fetchStockName(code: string, market: Market): Promise<string> {
  const symbol = sinaSymbol(code, market);
  const url = `https://qt.gtimg.cn/q=${symbol}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`行情接口 HTTP ${resp.status}`);
  // 腾讯接口返回 GBK
  const buf = await resp.arrayBuffer();
  const text = new TextDecoder("gbk").decode(buf);
  // 格式：v_sh600519="1~贵州茅台~600519~...
  const m = text.match(/="[^~]*~([^~]+)~/);
  if (!m || !m[1]) throw new Error("未找到该股票，请确认代码是否正确");
  return m[1];
}
