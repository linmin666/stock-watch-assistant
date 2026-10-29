import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Period, Settings, Signal, SignalType, Stock } from "../shared/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "stock-watch.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// 初始化表结构
db.exec(`
CREATE TABLE IF NOT EXISTS stocks (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  market     TEXT NOT NULL CHECK (market IN ('SH','SZ','BJ')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS signals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_code TEXT NOT NULL REFERENCES stocks(code) ON DELETE CASCADE,
  stock_name TEXT NOT NULL,
  period     INTEGER NOT NULL DEFAULT 5 CHECK (period IN (5,15,30,60,1440,10080)),
  type       TEXT NOT NULL CHECK (type IN ('golden_cross','breakout')),
  price      REAL NOT NULL,
  ma30       REAL NOT NULL,
  ma60       REAL NOT NULL,
  kline_time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  notified   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_code    ON signals (stock_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_dedup
  ON signals (stock_code, period, type, kline_time);

CREATE TABLE IF NOT EXISTS settings (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  channel TEXT NOT NULL DEFAULT 'serverchan' CHECK (channel IN ('serverchan','pushplus')),
  key     TEXT NOT NULL DEFAULT ''
);
INSERT INTO settings (id, channel, key) SELECT 1, 'serverchan', ''
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1);

CREATE TABLE IF NOT EXISTS etf_pool (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  market     TEXT NOT NULL CHECK (market IN ('SH','SZ','BJ')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

// 旧库迁移（1.0 版无 period 列）：新增列并将唯一索引升级为含 period
{
  const cols = db.prepare("PRAGMA table_info(signals)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "period")) {
    db.exec(`
      ALTER TABLE signals ADD COLUMN period INTEGER NOT NULL DEFAULT 5 CHECK (period IN (5,15,30,60,1440,10080));
      DROP INDEX IF EXISTS idx_signals_dedup;
      CREATE UNIQUE INDEX idx_signals_dedup ON signals (stock_code, period, type, kline_time);
    `);
  }
}

// 旧库迁移：扩展 signals 表 period 约束以支持 60/1440/10080
{
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='signals'").get() as { sql: string } | undefined;
  if (tableInfo && tableInfo.sql.includes("CHECK (period IN (5,15,30))")) {
    db.exec(`
      DROP TABLE IF EXISTS signals_new;
      CREATE TABLE signals_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_code TEXT NOT NULL REFERENCES stocks(code) ON DELETE CASCADE,
        stock_name TEXT NOT NULL,
        period     INTEGER NOT NULL DEFAULT 5 CHECK (period IN (5,15,30,60,1440,10080)),
        type       TEXT NOT NULL CHECK (type IN ('golden_cross','breakout')),
        price      REAL NOT NULL,
        ma30       REAL NOT NULL,
        ma60       REAL NOT NULL,
        kline_time TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        notified   INTEGER NOT NULL DEFAULT 0
      );
      -- 显式按列名插入，避免旧库 ALTER TABLE 追加列导致物理列顺序不一致
      INSERT INTO signals_new (id, stock_code, stock_name, period, type, price, ma30, ma60, kline_time, created_at, notified)
        SELECT id, stock_code, stock_name, period, type, price, ma30, ma60, kline_time, created_at, notified FROM signals;
      DROP TABLE signals;
      ALTER TABLE signals_new RENAME TO signals;
      CREATE INDEX IF NOT EXISTS idx_signals_created ON signals (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_signals_code    ON signals (stock_code);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_dedup
        ON signals (stock_code, period, type, kline_time);
    `);
  }
}

// 旧库迁移：stocks 表补 sort_order 列（默认按创建顺序），置顶用 pinned 标记
{
  const cols = db.prepare("PRAGMA table_info(stocks)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "sort_order")) {
    db.exec(`
      ALTER TABLE stocks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE stocks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
      -- 初始化：按创建时间先后赋值
      UPDATE stocks SET sort_order = (SELECT COUNT(*) FROM stocks s2 WHERE s2.created_at <= stocks.created_at);
    `);
  }
}

// ---------- 股票 ----------
type SignalRow = {
  id: number;
  stock_code: string;
  stock_name: string;
  period: number;
  type: string;
  price: number;
  ma30: number;
  ma60: number;
  kline_time: string;
  created_at?: string;
  notified?: number;
};

const stmts = {
  listStocks: db.prepare<
    [],
    { code: string; name: string; market: string; created_at: string; sort_order: number; pinned: number }
  >("SELECT code, name, market, created_at, sort_order, pinned FROM stocks ORDER BY pinned DESC, sort_order ASC, created_at ASC"),
  getStock: db.prepare<[string], { code: string; name: string; market: string }>(
    "SELECT code, name, market FROM stocks WHERE code = ?"
  ),
  addStock: db.prepare<[string, string, string]>(
    "INSERT INTO stocks (code, name, market, sort_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM stocks))"
  ),
  delStock: db.prepare<[string]>("DELETE FROM stocks WHERE code = ?"),
  updateOrder: db.prepare<[number, string]>("UPDATE stocks SET sort_order = ? WHERE code = ?"),
  setPinned: db.prepare<[number, string]>("UPDATE stocks SET pinned = ? WHERE code = ?"),
  maxSort: db.prepare<[], { max: number | null }>("SELECT MAX(sort_order) AS max FROM stocks"),
  insertSignal: db.prepare<[string, string, number, string, number, number, number, string]>(
    `INSERT OR IGNORE INTO signals (stock_code, stock_name, period, type, price, ma30, ma60, kline_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  unnotifiedSignals: db.prepare<[], SignalRow>(
    "SELECT id, stock_code, stock_name, period, type, price, ma30, ma60, kline_time FROM signals WHERE notified = 0 ORDER BY id ASC"
  ),
  markNotified: db.prepare<[number]>("UPDATE signals SET notified = 1 WHERE id = ?"),
  listSignals: db.prepare<[number], SignalRow>(
    "SELECT * FROM signals ORDER BY created_at DESC, id DESC LIMIT ?"
  ),
  settings: db.prepare<[], { channel: string; key: string }>("SELECT channel, key FROM settings WHERE id = 1"),
  updateSettings: db.prepare<[string, string]>("UPDATE settings SET channel = ?, key = ? WHERE id = 1"),
  todayPushed: db.prepare<[], { cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM signals WHERE notified = 1 AND date(created_at,'localtime') = date('now','localtime')"
  ),
  // ETF 池（独立列表）
  listEtf: db.prepare<[], { code: string; name: string; market: string; created_at: string }>(
    "SELECT code, name, market, created_at FROM etf_pool ORDER BY created_at ASC"
  ),
  getEtf: db.prepare<[string], { code: string; name: string; market: string }>(
    "SELECT code, name, market FROM etf_pool WHERE code = ?"
  ),
  addEtf: db.prepare<[string, string, string]>("INSERT INTO etf_pool (code, name, market) VALUES (?, ?, ?)"),
  delEtf: db.prepare<[string]>("DELETE FROM etf_pool WHERE code = ?"),
};

export function listStocks(): Stock[] {
  return stmts.listStocks.all().map((r) => ({
    code: r.code,
    name: r.name,
    market: r.market as Stock["market"],
    createdAt: r.created_at,
    pinned: Boolean(r.pinned),
  }));
}

/**
 * 保存整个监控列表的顺序（拖拽排序），并重置置顶标记
 */
export function saveStockOrder(codes: string[]): void {
  const setAll = db.transaction((list: string[]) => {
    list.forEach((code, i) => stmts.updateOrder.run(i + 1, code));
    db.exec("UPDATE stocks SET pinned = 0");
  });
  setAll(codes);
}

/**
 * 置顶/取消置顶：置顶时 pinned=1 且排到所有非置顶之前
 */
export function setStockPinned(code: string, pinned: boolean): void {
  const tx = db.transaction(() => {
    if (pinned) {
      // 置顶项排到最前：sort_order 取当前最小值减 1
      const minRow = db.prepare<[], { min: number | null }>("SELECT MIN(sort_order) AS min FROM stocks").get();
      stmts.updateOrder.run((minRow?.min ?? 1) - 1, code);
    }
    stmts.setPinned.run(pinned ? 1 : 0, code);
  });
  tx();
}

export function getStock(code: string): Stock | null {
  const r = stmts.getStock.get(code);
  return r ? { code: r.code, name: r.name, market: r.market as Stock["market"], createdAt: "" } : null;
}

export function addStock(stock: Stock): void {
  stmts.addStock.run(stock.code, stock.name, stock.market);
}

export function deleteStock(code: string): void {
  stmts.delStock.run(code);
}

/**
 * 写入信号（幂等，重复返回 false）
 */
export function insertSignal(s: Omit<Signal, "id" | "createdAt" | "notified">): boolean {
  const r = stmts.insertSignal.run(s.stockCode, s.stockName, s.period, s.type, s.price, s.ma30, s.ma60, s.klineTime);
  return r.changes > 0;
}

export function getUnnotifiedSignals(): Signal[] {
  return stmts.unnotifiedSignals.all().map((r) => ({
    id: r.id,
    stockCode: r.stock_code,
    stockName: r.stock_name,
    period: r.period as Period,
    type: r.type as SignalType,
    price: r.price,
    ma30: r.ma30,
    ma60: r.ma60,
    klineTime: r.kline_time,
    createdAt: "",
    notified: 0,
  }));
}

export function markNotified(id: number): void {
  stmts.markNotified.run(id);
}

export function listSignals(limit = 200): Signal[] {
  return stmts.listSignals.all(limit).map((r) => ({
    id: r.id,
    stockCode: r.stock_code,
    stockName: r.stock_name,
    period: r.period as Period,
    type: r.type as SignalType,
    price: r.price,
    ma30: r.ma30,
    ma60: r.ma60,
    klineTime: r.kline_time,
    createdAt: r.created_at ?? "",
    notified: r.notified ? 1 : 0,
  }));
}

export function getSettings(): Settings {
  const r = stmts.settings.get();
  return { channel: (r?.channel ?? "serverchan") as Settings["channel"], key: r?.key ?? "" };
}

export function saveSettings(s: Settings): void {
  stmts.updateSettings.run(s.channel, s.key);
}

export function countTodayPushed(): number {
  return stmts.todayPushed.get()?.cnt ?? 0;
}

// ---------- ETF 池（独立列表） ----------
export function listEtfPool(): Stock[] {
  return stmts.listEtf.all().map((r) => ({
    code: r.code,
    name: r.name,
    market: r.market as Stock["market"],
    createdAt: r.created_at,
  }));
}

export function getEtf(code: string): Stock | null {
  const r = stmts.getEtf.get(code);
  return r ? { code: r.code, name: r.name, market: r.market as Stock["market"], createdAt: "" } : null;
}

export function addEtf(stock: Stock): void {
  stmts.addEtf.run(stock.code, stock.name, stock.market);
}

export function deleteEtf(code: string): void {
  stmts.delEtf.run(code);
}

export default db;
