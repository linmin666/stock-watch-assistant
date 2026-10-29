import type { Kline } from "./eastmoney.js";

export interface MaValues {
  ma30: number;
  ma60: number;
}

export interface DetectionResult {
  goldenCross: boolean;
  breakout: boolean;
  price: number;
  ma30: number;
  ma60: number;
  klineTime: string;
}

/** 简单移动平均：取 closes 末尾 period 个的平均值，不足返回 null */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

/** 计算整条均线序列（与 K 线对齐，前 period-1 个为 null） */
export function smaSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

/**
 * 信号检测：只看最后一根已收盘 K 线相对前一根的上穿动作
 * - 突破：前一根 close <= 前一根 MA60 且 当前根 close > 当前根 MA60
 * - 金叉：前一根 MA30 <= 前一根 MA60 且 当前根 MA30 > 当前根 MA60
 * 至少需要 61 根 K 线（MA60 需要 60 根 + 前一根对比）
 */
export function detectSignals(klines: Kline[]): DetectionResult | null {
  if (klines.length < 61) return null;
  const closes = klines.map((k) => k.close);
  const ma30s = smaSeries(closes, 30);
  const ma60s = smaSeries(closes, 60);
  const i = klines.length - 1; // 最后一根已收盘
  const prev = i - 1;
  const ma30 = ma30s[i];
  const ma60 = ma60s[i];
  const pMa30 = ma30s[prev];
  const pMa60 = ma60s[prev];
  if (ma30 == null || ma60 == null || pMa30 == null || pMa60 == null) return null;

  const price = klines[i].close;
  const goldenCross = pMa30 <= pMa60 && ma30 > ma60;
  const breakout = klines[prev].close <= pMa60 && price > ma60;

  return { goldenCross, breakout, price, ma30, ma60, klineTime: klines[i].time };
}

/** 当前快照（供前端展示） */
export function quoteFromKlines(klines: Kline[]): { price: number; ma30: number; ma60: number; priceAboveMa60: boolean; ma30AboveMa60: boolean } | null {
  if (klines.length < 60) return null;
  const closes = klines.map((k) => k.close);
  const ma30 = sma(closes, 30);
  const ma60 = sma(closes, 60);
  if (ma30 == null || ma60 == null) return null;
  const price = closes[closes.length - 1];
  return {
    price,
    ma30,
    ma60,
    priceAboveMa60: price > ma60,
    ma30AboveMa60: ma30 > ma60,
  };
}
