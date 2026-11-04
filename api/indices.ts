/** A 股主要指数行情与多周期均线状态 */

import { fetchKlines } from "./eastmoney.js";
import { quoteFromKlines } from "./detector.js";
import type { Period } from "../shared/types.js";

export interface IndexQuote {
  code: string; // 指数代码，如 sh000001
  name: string; // 如 上证指数
  price: number; // 最新点位
  change: number; // 涨跌额
  changePct: number; // 涨跌幅 %
  updatedAt: string;
  /** 各分钟周期是否站上 MA60（与个股监控一致的快照），数据不足为 null */
  periods: Record<string, { above: boolean; price: number; ma60: number; pctFromMa60: number } | null>;
}

/** 固定监控的四大指数（新浪 symbol，含市场前缀） */
export const INDEX_SYMBOLS: { code: string; name: string }[] = [
  { code: "sh000001", name: "上证指数" },
  { code: "sz399001", name: "深证成指" },
  { code: "sz399006", name: "创业板指" },
  { code: "sh000688", name: "科创50" },
];

/** 从新浪 symbol 解析市场与纯代码（fetchKlines 需要分开传入） */
function parseSymbol(symbol: string): { code: string; market: "SH" | "SZ" | "BJ" } {
  const prefix = symbol.slice(0, 2).toUpperCase();
  const market = prefix === "SH" ? "SH" : prefix === "BJ" ? "BJ" : "SZ";
  return { code: symbol.slice(2), market };
}

/** 指数监控的分钟周期（与个股监控页一致） */
export const INDEX_PERIODS: Period[] = [5, 15, 30];

/** 拉取指数简版快照（点位/涨跌额/涨跌幅），格式：名称,点位,涨跌额,涨跌幅,成交量,成交额 */
async function fetchIndexSnapshots(): Promise<Map<string, { price: number; change: number; changePct: number }>> {
  const url = `https://hq.sinajs.cn/list=${INDEX_SYMBOLS.map((i) => `s_${i.code}`).join(",")}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://finance.sina.com.cn/",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`新浪指数接口 HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const text = new TextDecoder("gbk").decode(buf);
  const result = new Map<string, { price: number; change: number; changePct: number }>();
  for (const m of text.matchAll(/hq_str_s_(\w+)="([^"]*)"/g)) {
    const [, symbol, body] = m;
    if (!symbol || !body) continue;
    const f = body.split(",");
    const price = Number(f[1]);
    const change = Number(f[2]);
    const changePct = Number(f[3]);
    if (!Number.isFinite(price) || price <= 0) continue;
    result.set(symbol, { price, change, changePct });
  }
  return result;
}

/** 拉取单个指数的多周期均线状态（复用个股 K 线接口与检测逻辑） */
async function fetchIndexPeriods(symbol: string): Promise<IndexQuote["periods"]> {
  const { code, market } = parseSymbol(symbol);
  const periods: IndexQuote["periods"] = {};
  const results = await Promise.allSettled(
    INDEX_PERIODS.map(async (p) => {
      const klines = await fetchKlines(code, market, p, 150);
      return { p, snapshot: quoteFromKlines(klines) };
    })
  );
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { p, snapshot } = r.value;
    if (!snapshot) {
      periods[p] = null;
      continue;
    }
    periods[p] = {
      above: snapshot.priceAboveMa60,
      price: snapshot.price,
      ma60: snapshot.ma60,
      pctFromMa60: snapshot.ma60 > 0 ? ((snapshot.price - snapshot.ma60) / snapshot.ma60) * 100 : 0,
    };
  }
  return periods;
}

/**
 * 拉取全部指数：简版快照（点位/涨跌幅）+ 各分钟周期 MA60 状态。
 * 任一部分失败不影响其余数据。
 */
export async function fetchIndices(): Promise<IndexQuote[]> {
  const updatedAt = new Date().toISOString();
  const [snaps, ...rest] = await Promise.all([
    fetchIndexSnapshots(),
    ...INDEX_SYMBOLS.map(async (idx) => {
      const periods = await fetchIndexPeriods(idx.code).catch(() => ({}));
      return { code: idx.code, periods };
    }),
  ]);

  return INDEX_SYMBOLS.map((meta) => {
    const snap = snaps.get(meta.code);
    const periods = rest.find((r) => r.code === meta.code)?.periods ?? {};
    return {
      code: meta.code,
      name: meta.name,
      price: snap?.price ?? 0,
      change: snap?.change ?? 0,
      changePct: snap?.changePct ?? 0,
      updatedAt,
      periods,
    };
  });
}
