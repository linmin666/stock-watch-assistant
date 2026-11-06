import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddStockRequest, PutSettingsRequest, TestNotifyRequest } from "../shared/types.js";
import * as db from "./db.js";
import { guessMarket, fetchStockName } from "./eastmoney.js";
import { fetchStockSectors } from "./sectors.js";
import { sendTest } from "./notifier.js";
import { getEngineStatus, getQuoteCache, getIndices, getSectorHot, startEngine, pollEtfPool, pollMonitorList } from "./engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// ---------- 股票监控 ----------
app.get("/api/stocks", (_req, res) => {
  res.json({ ok: true, data: db.listStocks() });
});

app.post("/api/stocks", async (req, res) => {
  const { code } = req.body as AddStockRequest;
  if (!/^\d{6}$/.test(code ?? "")) {
    res.status(400).json({ ok: false, error: "请输入6位数字股票代码" });
    return;
  }
  if (db.getStock(code)) {
    res.status(409).json({ ok: false, error: "该股票已在监控列表中" });
    return;
  }
  const market = guessMarket(code);
  try {
    const name = await fetchStockName(code, market);
    db.addStock({ code, name, market, createdAt: "" });
    res.json({ ok: true, data: { code, name, market } });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "添加失败" });
  }
});

app.delete("/api/stocks/:code", (req, res) => {
  if (!db.getStock(req.params.code)) {
    res.status(404).json({ ok: false, error: "监控不存在" });
    return;
  }
  db.deleteStock(req.params.code);
  res.json({ ok: true });
});

// 保存监控列表顺序（拖拽排序）
app.put("/api/stocks/order", (req, res) => {
  const { codes } = req.body as { codes?: string[] };
  if (!Array.isArray(codes) || codes.length === 0) {
    res.status(400).json({ ok: false, error: "codes 不能为空" });
    return;
  }
  const existing = new Set(db.listStocks().map((s) => s.code));
  if (codes.some((c) => !existing.has(c))) {
    res.status(400).json({ ok: false, error: "包含未知股票代码" });
    return;
  }
  db.saveStockOrder(codes);
  res.json({ ok: true });
});

// 置顶 / 取消置顶
app.put("/api/stocks/:code/pin", (req, res) => {
  if (!db.getStock(req.params.code)) {
    res.status(404).json({ ok: false, error: "监控不存在" });
    return;
  }
  const { pinned } = req.body as { pinned?: boolean };
  db.setStockPinned(req.params.code, Boolean(pinned));
  res.json({ ok: true });
});

// ---------- 行情快照 ----------
app.get("/api/stocks/:code/quote", async (req, res) => {
  const stock = db.getStock(req.params.code);
  if (!stock) {
    res.status(404).json({ ok: false, error: "监控不存在" });
    return;
  }
  const cached = getQuoteCache().get(stock.code);
  res.json({ ok: true, data: cached ?? null });
});

// ---------- 信号历史 ----------
app.get("/api/signals", (req, res) => {
  let signals = db.listSignals(300);
  const { code, type, period } = req.query;
  if (typeof code === "string" && code) signals = signals.filter((s) => s.stockCode === code);
  if (typeof type === "string" && type) signals = signals.filter((s) => s.type === type);
  if (typeof period === "string" && period) {
    const p = Number(period);
    if ([5, 15, 30, 60, 1440, 10080].includes(p)) signals = signals.filter((s) => s.period === p);
  }
  res.json({ ok: true, data: signals });
});

// ---------- 设置 ----------
app.get("/api/settings", (_req, res) => {
  res.json({ ok: true, data: db.getSettings() });
});

app.put("/api/settings", (req, res) => {
  const { channel, key } = req.body as PutSettingsRequest;
  if (channel !== "serverchan" && channel !== "pushplus") {
    res.status(400).json({ ok: false, error: "无效的推送渠道" });
    return;
  }
  db.saveSettings({ channel, key: key ?? "" });
  res.json({ ok: true });
});

app.post("/api/settings/test", async (req, res) => {
  const { channel, key } = req.body as TestNotifyRequest;
  if (channel !== "serverchan" && channel !== "pushplus") {
    res.status(400).json({ ok: false, error: "无效的推送渠道" });
    return;
  }
  const result = await sendTest({ channel, key });
  res.json({ ok: result.ok, error: result.ok ? undefined : result.message, data: result.ok ? { message: result.message } : undefined });
});

// ---------- 引擎状态 ----------
app.get("/api/engine/status", (_req, res) => {
  res.json({ ok: true, data: getEngineStatus() });
});

// 手动刷新：立即轮询 ETF 池一轮（ETF 池刷新按钮用）
app.post("/api/engine/refresh", async (_req, res) => {
  try {
    await pollEtfPool();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "轮询失败" });
  }
});

// 手动刷新：立即轮询监控列表一轮（监控页刷新按钮用，不受交易时段限制）
app.post("/api/quotes/refresh", async (_req, res) => {
  try {
    await pollMonitorList();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "轮询失败" });
  }
});

// ---------- 实时快照（引擎轮询缓存，按周期） ----------
app.get("/api/quotes", (_req, res) => {
  const cache = getQuoteCache();
  const result = db.listStocks().map((s) => {
    const c = cache.get(s.code);
    return {
      code: s.code,
      name: s.name,
      error: c ? c.error : "数据加载中…",
      updatedAt: c?.updatedAt ?? "",
      dayChangePct: c?.dayChangePct ?? null,
      quotes: c ? [...c.byPeriod.values()] : [],
    };
  });
  res.json({ ok: true, data: result });
});

// ---------- ETF 池（独立列表：添加 / 删除 / 列表） ----------
app.get("/api/etf-pool/stocks", (_req, res) => {
  res.json({ ok: true, data: db.listEtfPool() });
});

app.post("/api/etf-pool/stocks", async (req, res) => {
  const { code } = req.body as AddStockRequest;
  if (!/^\d{6}$/.test(code ?? "")) {
    res.status(400).json({ ok: false, error: "请输入6位数字代码" });
    return;
  }
  if (db.getEtf(code)) {
    res.status(409).json({ ok: false, error: "该代码已在 ETF 池中" });
    return;
  }
  const market = guessMarket(code);
  try {
    const name = await fetchStockName(code, market);
    db.addEtf({ code, name, market, createdAt: "" });
    res.json({ ok: true, data: { code, name, market } });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "添加失败" });
  }
});

app.delete("/api/etf-pool/stocks/:code", (req, res) => {
  if (!db.getEtf(req.params.code)) {
    res.status(404).json({ ok: false, error: "该代码不在 ETF 池中" });
    return;
  }
  db.deleteEtf(req.params.code);
  res.json({ ok: true });
});

// ---------- ETF 池（所有股票 × 6 周期均线状态） ----------
app.get("/api/etf-pool", (_req, res) => {
  const cache = getQuoteCache();
  const stocks = db.listEtfPool();

  const data = stocks.map((s) => {
    const c = cache.get(s.code);
    const periods: Record<string, { above: boolean; price: number; ma60: number; pctFromMa60: number } | null> = {};
    for (const p of [5, 15, 30, 60, 1440, 10080]) {
      const q = c?.byPeriod.get(String(p));
      if (q) {
        periods[p] = {
          above: q.priceAboveMa60,
          price: q.price,
          ma60: q.ma60,
          pctFromMa60: q.ma60 > 0 ? ((q.price - q.ma60) / q.ma60) * 100 : 0,
        };
      } else {
        periods[p] = null;
      }
    }
    return { code: s.code, name: s.name, periods };
  });

  res.json({ ok: true, data });
});

// ---------- 指数行情（上证/深证/创业板/科创50） ----------
app.get("/api/indices", (_req, res) => {
  const { indices, error } = getIndices();
  res.json({ ok: true, data: { indices, error } });
});

// ---------- 板块热点（行业板块多周期涨幅 Top） ----------
app.get("/api/sectors", (_req, res) => {
  const { sectors, error, updatedAt } = getSectorHot();
  res.json({ ok: true, data: { sectors, error, updatedAt } });
});

// 股票所属板块查询（用于与板块热榜求交集高亮；支持 6 位代码或股票名称）
app.get("/api/sectors/lookup/:input", async (req, res) => {
  const input = (req.params.input ?? "").trim();
  if (!/^\d{6}$/.test(input) && input.length === 0) {
    res.status(400).json({ ok: false, error: "请输入股票代码或名称" });
    return;
  }
  if (input.length > 12) {
    res.status(400).json({ ok: false, error: "名称过长" });
    return;
  }
  try {
    const lookup = await fetchStockSectors(input);
    res.json({ ok: true, data: lookup });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "查询失败" });
  }
});

// ---------- 生产模式托管前端 ----------
const distDir = path.resolve(__dirname, "../dist");
app.use(express.static(distDir));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`[server] 股票盯盘助手已启动: http://localhost:${PORT}`);
  startEngine();
});
