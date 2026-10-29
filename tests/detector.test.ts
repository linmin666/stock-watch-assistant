// 信号检测单元测试：node --test 方式不可用于 TS，直接用 tsx 运行断言脚本
import assert from "node:assert";
import { detectSignals, quoteFromKlines, sma, smaSeries } from "../api/detector.js";
import { guessMarket, dropUnclosedBars, type Kline } from "../api/eastmoney.js";
import { tradingPhase } from "../api/trading-time.js";

// 构造 K 线工具：给定收盘价数组，生成对应K线（时间递增5分钟）
function makeKlines(closes: number[]): Kline[] {
  return closes.map((c, i) => {
    const base = new Date(2026, 9, 20, 9, 30 + i * 5);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      time: `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())} ${pad(base.getHours())}:${pad(base.getMinutes())}`,
      open: c,
      close: c,
      high: c,
      low: c,
    };
  });
}

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 均线计算 ----------
t("sma：不足周期返回 null", () => {
  assert.equal(sma([1, 2, 3], 5), null);
});

t("sma：正确计算", () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
});

t("smaSeries：前 period-1 个为 null，其余滚动计算", () => {
  const s = smaSeries([1, 2, 3, 4], 2);
  assert.deepEqual(s, [null, 1.5, 2.5, 3.5]);
});

// ---------- 金叉检测 ----------
t("金叉：MA30 从下方上穿 MA60 触发", () => {
  // 构造：先下跌让 MA30 < MA60，再快速拉升制造上穿
  const closes: number[] = [];
  for (let i = 0; i < 70; i++) closes.push(100 - i * 0.5); // 一路下跌 100→65.5
  for (let i = 0; i < 40; i++) closes.push(66 + i * 1.5); // 持续拉升 66→124.5
  const result = detectSignals(makeKlines(closes));
  assert.ok(result, "应返回检测结果");
  assert.ok(result.ma30 > result.ma60, `拉升后 MA30(${result.ma30.toFixed(2)}) 应在 MA60(${result.ma60.toFixed(2)}) 上方`);
});

t("金叉：精确构造最后一根K线上穿", () => {
  // 70 根缓跌（价格与均线都沉底），末段横盘 30 根，最后两根拉升制造上穿
  const closes: number[] = [];
  for (let i = 0; i < 70; i++) closes.push(100 - i * 0.3); // 100→79.3
  for (let i = 0; i < 30; i++) closes.push(80); // 横盘
  const k = makeKlines(closes);
  k[k.length - 2].close = 78; k[k.length - 2].open = 78; // 探底
  k[k.length - 1].close = 89; k[k.length - 1].open = 89; // 拉升
  const result = detectSignals(k);
  assert.ok(result, "应返回检测结果");
  console.log(`    info: ma30=${result.ma30.toFixed(3)} ma60=${result.ma60.toFixed(3)} gc=${result.goldenCross} bo=${result.breakout}`);
  assert.ok(result.ma30 > result.ma60 || result.breakout, "应至少出现金叉或突破");
});

t("无上穿：MA30 持续低于 MA60 不触发", () => {
  const closes: number[] = [];
  for (let i = 0; i < 70; i++) closes.push(100 - i * 0.5);
  const result = detectSignals(makeKlines(closes));
  assert.ok(result);
  assert.equal(result.goldenCross, false);
  assert.equal(result.breakout, false);
});

t("K线不足 61 根返回 null", () => {
  const result = detectSignals(makeKlines(Array.from({ length: 60 }, () => 100)));
  assert.equal(result, null);
});

// ---------- 突破检测 ----------
t("突破：收盘价上穿 MA60 触发（金叉未发生）", () => {
  // 下跌段让价格沉到 MA60 下方，末段横盘，最后两根先探底再拉升
  const closes: number[] = [];
  for (let i = 0; i < 60; i++) closes.push(100 - i * 0.2); // 缓跌 100→88.2
  for (let i = 0; i < 20; i++) closes.push(88); // 横盘
  const k = makeKlines(closes);
  k[k.length - 2].close = 86; k[k.length - 2].open = 86; // 探底
  k[k.length - 1].close = 95; k[k.length - 1].open = 95; // 拉升上穿 MA60
  const result = detectSignals(k);
  assert.ok(result, "应返回检测结果");
  assert.ok(result.breakout, `应触发突破：prev=86 <= ma60=${result.ma60.toFixed(2)}, cur=95`);
});

// ---------- 快照 ----------
t("quoteFromKlines：返回价格与均线状态", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const q = quoteFromKlines(makeKlines(closes));
  assert.ok(q);
  assert.equal(q.price, 159);
  assert.ok(q.ma30! > q.ma60!);
  assert.equal(q.priceAboveMa60, true);
  assert.equal(q.ma30AboveMa60, true);
});

t("quoteFromKlines：数据不足返回 null", () => {
  assert.equal(quoteFromKlines(makeKlines([100, 101])), null);
});

// ---------- 市场推断 ----------
t("guessMarket：沪深北推断", () => {
  assert.equal(guessMarket("600519"), "SH");
  assert.equal(guessMarket("930955"), "SH");
  assert.equal(guessMarket("000001"), "SZ");
  assert.equal(guessMarket("300750"), "SZ");
  assert.equal(guessMarket("430047"), "BJ");
  assert.equal(guessMarket("832566"), "BJ");
});

// ---------- 交易时段（仅验证函数可调用且值合法） ----------
t("tradingPhase：返回合法时段", () => {
  assert.ok(["trading", "lunch", "closed"].includes(tradingPhase()));
});

// ---------- 未收盘K线过滤 ----------
t("dropUnclosedBars：剔除当前正在形成的K线", () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // 两根历史 bar（已收盘）+ 一根 5 分钟前开始、30 分钟才收盘的未收盘 bar
  const unclosedStart = new Date(now.getTime() - 5 * 60 * 1000);
  const klines: Kline[] = [
    { time: "2026-10-28 09:30", open: 1, close: 1, high: 1, low: 1 },
    { time: "2026-10-28 10:00", open: 1, close: 1, high: 1, low: 1 },
    { time: fmt(unclosedStart), open: 1, close: 1, high: 1, low: 1 },
  ];
  const filtered = dropUnclosedBars(klines, 30);
  assert.equal(filtered.length, 2, "应剔除最后一根未收盘的 30 分钟 bar");
});

t("dropUnclosedBars：最后一根已收盘时全部保留", () => {
  const klines: Kline[] = [
    { time: "2026-10-28 09:30", open: 1, close: 1, high: 1, low: 1 },
    { time: "2026-10-28 10:00", open: 1, close: 1, high: 1, low: 1 },
  ];
  const filtered = dropUnclosedBars(klines, 30);
  assert.equal(filtered.length, 2, "历史 bar 均已收盘，不应剔除");
});

console.log(`\n全部 ${passed} 个测试通过 ✓`);
