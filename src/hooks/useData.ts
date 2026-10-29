import { useEffect, useState } from 'react'
import { api, type StockQuoteGroup } from '../utils/api'
import type { Signal, Stock } from '../../shared/types'

/** 通用轮询 hook：每 intervalMs 拉取一次，返回数据/加载态/错误与手动刷新 */
export function usePolling<T>(fn: () => Promise<T>, intervalMs: number): {
  data: T | null
  loading: boolean
  error: string | null
  refresh: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    const run = () => {
      fn()
        .then((d) => {
          if (alive) {
            setData(d)
            setError(null)
          }
        })
        .catch((e: Error) => {
          if (alive) setError(e.message)
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }
    run()
    const id = setInterval(run, intervalMs)
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, intervalMs])

  return { data, loading, error, refresh: () => setTick((t) => t + 1) }
}

/** 监控列表 */
export function useStocks(intervalMs = 15000) {
  return usePolling<Stock[]>(api.listStocks, intervalMs)
}

/** 实时行情快照（每只股票含三个周期） */
export function useQuotes(intervalMs = 15000) {
  return usePolling<StockQuoteGroup[]>(api.quotes, intervalMs)
}

/** 信号历史 */
export function useSignals(intervalMs = 20000) {
  return usePolling<Signal[]>(() => api.listSignals(), intervalMs)
}

/** 引擎状态 */
export function useEngine(intervalMs = 10000) {
  return usePolling(api.engineStatus, intervalMs)
}

/** 手动拉取 hook：不自动轮询，仅在调用 refresh 时请求一次 */
export function useManual<T>(fn: () => Promise<T>): {
  data: T | null
  loading: boolean
  error: string | null
  refresh: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => {
        if (alive) {
          setData(d)
          setError(null)
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  return { data, loading, error, refresh: () => setTick((t) => t + 1) }
}
