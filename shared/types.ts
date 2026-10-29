// 前后端共享类型定义

export type Market = "SH" | "SZ" | "BJ";

export interface Stock {
  code: string; // 6位代码，如 "600519"
  name: string; // 如 "贵州茅台"
  market: Market;
  createdAt: string;
  pinned?: boolean; // 是否置顶
}

// K线周期（分钟），引擎对六种周期独立检测
// 5/15/30/60 为分钟级，1440=日线，10080=周线
export type Period = 5 | 15 | 30 | 60 | 1440 | 10080;
export const PERIODS: Period[] = [5, 15, 30, 60, 1440, 10080];

/** 周期显示标签 */
export const PERIOD_LABELS: Record<Period, string> = {
  5: '5分',
  15: '15分',
  30: '30分',
  60: '1时',
  1440: '日',
  10080: '周',
};

/** 排序优先级（高→低）：周 > 日 > 时 > 30分 > 15分 > 5分 */
export const PERIOD_PRIORITY: Period[] = [10080, 1440, 60, 30, 15, 5];

export type SignalType = "golden_cross" | "breakout";

export interface Signal {
  id: number;
  stockCode: string;
  stockName: string;
  period: Period; // K线周期
  type: SignalType; // golden_cross=金叉, breakout=突破
  price: number; // 触发时收盘价
  ma30: number;
  ma60: number;
  klineTime: string; // 触发的K线时间（已收盘）
  createdAt: string; // 检测到信号的时间
  notified: 0 | 1; // 是否已推送
}

export type NotifyChannel = "serverchan" | "pushplus";

export interface Settings {
  channel: NotifyChannel;
  key: string;
}

export interface Quote {
  code: string;
  name: string;
  period: Period;
  price: number;
  changePct: number;
  ma30: number;
  ma60: number;
  priceAboveMa60: boolean;
  ma30AboveMa60: boolean;
  updatedAt: string;
}

export interface EngineStatus {
  running: boolean;
  phase: "trading" | "lunch" | "closed";
  nextRunInMs: number;
  lastRunAt: string | null;
  todayPushed: number;
  monitoredCount: number;
}

// 添加股票请求
export interface AddStockRequest {
  code: string;
}

// 保存设置请求
export interface PutSettingsRequest {
  channel: NotifyChannel;
  key: string;
}

// 测试推送请求
export interface TestNotifyRequest {
  channel: NotifyChannel;
  key: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
