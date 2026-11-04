import { useEffect } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { usePolling } from '../hooks/useData'
import { api, type IndexQuote } from '../utils/api'
import { priceColor } from '../utils/format'

/** 指数监控的周期列（与个股卡片一致） */
const INDEX_PERIODS = [5, 15, 30] as const

/** 单个指数项：名称/点位/涨跌幅 + 各分钟周期 MA60 状态徽标 */
function IndexItem({ idx }: { idx: IndexQuote }) {
  const color = priceColor(idx.changePct)
  return (
    <div className="flex min-w-[13rem] flex-1 flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-dim">{idx.name}</span>
        <span className={`font-mono text-xl font-bold tabular-nums ${color}`}>
          {idx.price.toFixed(2)}
        </span>
        <span className={`font-mono text-sm font-semibold tabular-nums ${color}`}>
          {idx.changePct >= 0 ? '+' : ''}
          {idx.changePct.toFixed(2)}%
        </span>
      </div>
      <div className="flex gap-1">
        {INDEX_PERIODS.map((p) => {
          const st = idx.periods[String(p)]
          if (!st) {
            return (
              <span key={p} className="bg-edge px-1.5 py-0.5 font-mono text-[10px] text-dim">
                {p}分 --
              </span>
            )
          }
          return (
            <span
              key={p}
              title={`MA60 ${st.ma60.toFixed(2)}（偏离 ${st.pctFromMa60 >= 0 ? '+' : ''}${st.pctFromMa60.toFixed(2)}%）`}
              className={`px-1.5 py-0.5 font-mono text-[10px] ${
                st.above ? 'bg-gold/15 text-gold' : 'bg-edge text-dim'
              }`}
            >
              {p}分 {st.above ? '线上' : '线下'}
            </span>
          )
        })}
      </div>
    </div>
  )
}

interface Props {
  /** 整页刷新状态（由父组件控制）：按钮回调 + 是否刷新中 */
  onRefresh: () => void
  refreshing: boolean
  /** 父组件刷新完成后递增的令牌，触发指数条立即重拉 */
  refreshToken?: number
}

/** 指数行情条：上证指数 / 深证成指 / 创业板指 / 科创50 + 整页刷新按钮 */
export default function IndexBar({ onRefresh, refreshing, refreshToken = 0 }: Props) {
  const { data, refresh } = usePolling(api.indices, 15000)
  const { indices, error } = data ?? { indices: [], error: null }

  // 父组件整页刷新完成后，指数条同步重拉
  useEffect(() => {
    if (refreshToken > 0) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  return (
    <div className="panel mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-sm px-4 py-3">
      {indices.map((idx) => (
        <IndexItem key={idx.code} idx={idx} />
      ))}

      <button
        onClick={onRefresh}
        disabled={refreshing}
        title="刷新全部行情（指数 + 监控列表）"
        className="ml-auto flex items-center gap-1 rounded border border-edge px-2.5 py-1 text-xs text-dim transition hover:border-edgebright hover:text-ink disabled:opacity-50"
      >
        {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {refreshing ? '刷新中…' : '刷新行情'}
      </button>

      {error && indices.length === 0 && <span className="text-xs text-up">{error}</span>}
    </div>
  )
}
