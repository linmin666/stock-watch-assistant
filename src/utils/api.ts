import type { ApiResponse, EngineStatus, Period, Settings, Signal, Stock } from '../../shared/types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const json = (await resp.json()) as ApiResponse<T>
  if (!resp.ok || !json.ok) throw new Error(json.error ?? `请求失败 HTTP ${resp.status}`)
  return json.data as T
}

export const api = {
  listStocks: () => request<Stock[]>('/api/stocks'),
  addStock: (code: string) =>
    request<{ code: string; name: string; market: string }>('/api/stocks', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  deleteStock: (code: string) => request<void>(`/api/stocks/${code}`, { method: 'DELETE' }),
  saveOrder: (codes: string[]) =>
    request<void>('/api/stocks/order', { method: 'PUT', body: JSON.stringify({ codes }) }),
  setPinned: (code: string, pinned: boolean) =>
    request<void>(`/api/stocks/${code}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) }),
  listSignals: (params?: { code?: string; type?: string; period?: Period }) => {
    const qs = new URLSearchParams()
    if (params?.code) qs.set('code', params.code)
    if (params?.type) qs.set('type', params.type)
    if (params?.period) qs.set('period', String(params.period))
    const s = qs.toString()
    return request<Signal[]>(`/api/signals${s ? `?${s}` : ''}`)
  },
  /** ETF 池（所有股票 × 6 周期均线状态） */
  etfPool: () => request<EtfPoolItem[]>('/api/etf-pool'),
  /** ETF 池独立列表 */
  listEtfStocks: () => request<Stock[]>('/api/etf-pool/stocks'),
  addEtfStock: (code: string) =>
    request<{ code: string; name: string; market: string }>('/api/etf-pool/stocks', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  deleteEtfStock: (code: string) =>
    request<void>(`/api/etf-pool/stocks/${code}`, { method: 'DELETE' }),
  getSettings: () => request<Settings>('/api/settings'),
  saveSettings: (s: Settings) =>
    request<void>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  testNotify: (channel: string, key: string) =>
    request<{ message: string }>('/api/settings/test', {
      method: 'POST',
      body: JSON.stringify({ channel, key }),
    }),
  engineStatus: () => request<EngineStatus>('/api/engine/status'),
  /** 触发引擎立即轮询一轮 */
  engineRefresh: () => request<void>('/api/engine/refresh', { method: 'POST' }),
  quotes: () => request<StockQuoteGroup[]>('/api/quotes'),
}

export interface StockQuoteGroup {
  code: string
  name: string
  error: string | null
  updatedAt: string
  quotes: PeriodQuote[]
}

/** 单只股票在一个周期上的行情快照 */
export interface PeriodQuote {
  period: Period
  price: number
  changePct: number
  ma30: number
  ma60: number
  priceAboveMa60: boolean
  ma30AboveMa60: boolean
  updatedAt: string
}

/** ETF 池：单只股票 × 6 周期均线状态 */
export interface EtfPoolItem {
  code: string
  name: string
  periods: Record<string, { above: boolean; price: number; ma60: number; pctFromMa60: number } | null>
}
