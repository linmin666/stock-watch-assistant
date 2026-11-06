/**
 * A股板块热点（东方财富行业板块）
 * 列表接口一次返回全部板块的多周期涨幅字段，无需逐板块拉K线
 */

import { guessMarket } from "./eastmoney.js";

export interface SectorHot {
  /** 板块代码，如 BK1316 */
  code: string;
  /** 板块名称，如 光伏辅材 */
  name: string;
  /** 当日涨跌幅 % */
  changePct: number;
  /** 近一周（5交易日）涨跌幅 % */
  weekPct: number;
  /** 近两周（10交易日）涨跌幅 % */
  twoWeekPct: number;
  /** 近一月（20交易日）涨跌幅 % */
  monthPct: number;
  /** 上涨家数 */
  upCount: number;
  /** 下跌家数 */
  downCount: number;
  /** 领涨股名称 */
  leaderName: string;
  /** 领涨股代码 */
  leaderCode: string;
  /** 领涨股涨跌幅 % */
  leaderPct: number;
  /** 板块点位 */
  index: number;
  /** 主力资金净流入额（元），-为净流出 */
  mainInflow: number;
  /** 主力净流入占比 %（净流入/成交额） */
  mainInflowPct: number;
}

interface RawRow {
  f2?: number | string; // 板块点位
  f3?: number | string; // 当日涨跌幅
  f12?: string; // 板块代码
  f14?: string; // 板块名称
  f62?: number | string; // 主力净流入额（元）
  f104?: number; // 上涨家数
  f105?: number; // 下跌家数
  f109?: number | string; // 5日涨跌幅
  f110?: number | string; // 20日涨跌幅
  f128?: string; // 领涨股名称
  f136?: number | string; // 领涨股涨跌幅
  f140?: string; // 领涨股代码
  f160?: number | string; // 10日涨跌幅
  f184?: number | string; // 主力净流入占比 %
}

const LIST_URL =
  "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=600&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2" +
  "&fields=f2,f3,f12,f14,f62,f104,f105,f109,f110,f128,f136,f140,f160,f184";

function num(v: number | string | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 拉取全部行业板块的多周期涨幅（东方财富一次请求） */
export async function fetchSectorHot(): Promise<SectorHot[]> {
  const resp = await fetch(LIST_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`东财板块接口 HTTP ${resp.status}`);
  const body = (await resp.json()) as { data?: { diff?: RawRow[] } | null };
  const rows = body.data?.diff ?? [];
  return rows
    .filter((r) => typeof r.f12 === "string" && typeof r.f14 === "string")
    .map((r) => ({
      code: r.f12!,
      name: r.f14!,
      changePct: num(r.f3),
      weekPct: num(r.f109),
      twoWeekPct: num(r.f160),
      monthPct: num(r.f110),
      upCount: num(r.f104),
      downCount: num(r.f105),
      leaderName: r.f128 ?? "—",
      leaderCode: r.f140 ?? "",
      leaderPct: num(r.f136),
      index: num(r.f2),
      mainInflow: num(r.f62),
      mainInflowPct: num(r.f184),
    }));
}

/** 股票所属板块查询结果 */
export interface StockSectorLookup {
  /** 股票代码 */
  stockCode: string;
  /** 股票名称（东财返回，可能为空） */
  stockName: string;
  /** 所属行业板块（东财行业分类，m:90+t:2 内的板块） */
  sectors: Array<{ code: string; name: string }>;
}

/**
 * 查询股票所属板块（东方财富 slist 接口）
 * 支持 6 位数字代码或股票名称（名称经东财 suggest 解析为代码）
 * 返回股票隶属的全部板块，前端负责与行业板块 Top5 求交集
 */
export async function fetchStockSectors(input: string): Promise<StockSectorLookup> {
  let stockCode: string;
  let stockName: string;
  if (/^\d{6}$/.test(input)) {
    // 代码直查
    stockCode = input;
    stockName = "";
  } else {
    // 名称 → suggest 搜索解析为 A 股代码
    const resolved = await resolveStockBySuggest(input);
    stockCode = resolved.code;
    stockName = resolved.name;
  }

  const market = guessMarket(stockCode);
  // 东财 secid：沪 1.、深 0.、北 0.
  const secid = `${market === "SH" ? "1" : "0"}.${stockCode}`;
  const url =
    `https://push2.eastmoney.com/api/qt/slist/get?spt=3&secid=${secid}` +
    `&fields=f12,f14&pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fs=m:90+t:2`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`东财板块归属接口 HTTP ${resp.status}`);
  const body = (await resp.json()) as {
    data?: { diff?: Array<{ f12?: string; f14?: string }> } | null;
  };
  const rows = body.data?.diff ?? [];
  const sectors = rows
    .filter((r) => typeof r.f12 === "string" && typeof r.f14 === "string")
    .map((r) => ({ code: r.f12!, name: r.f14! }));
  return { stockCode, stockName, sectors };
}

/**
 * 东财 suggest 接口：名称/拼音 → A股代码
 * Classify 值域：沪深主板/创业板=AStock、科创板=23、北交所=NEEQ
 * （Fund=基金、Index=指数、HKStock/US 等，均排除）
 */
async function resolveStockBySuggest(name: string): Promise<{ code: string; name: string }> {
  const url =
    `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(name)}` +
    `&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`东财搜索接口 HTTP ${resp.status}`);
  const body = (await resp.json()) as {
    QuotationCodeTable?: {
      Data?: Array<{ Code?: string; Name?: string; Classify?: string; MktNum?: string } | null> | null;
    } | null;
  };
  const rows = (body.QuotationCodeTable?.Data ?? []).filter(
    (d): d is { Code: string; Name: string; Classify: string; MktNum: string } =>
      d != null &&
      typeof d.Code === "string" &&
      /^\d{6}$/.test(d.Code) &&
      (d.Classify === "AStock" || d.Classify === "23" || d.Classify === "NEEQ"),
  );
  if (rows.length === 0) throw new Error(`未找到与「${name}」匹配的 A 股股票`);
  // 多条匹配时优先全名精确相等的，其次取第一条
  const exact = rows.find((r) => r.Name === name) ?? rows[0];
  return { code: exact.Code, name: exact.Name };
}
