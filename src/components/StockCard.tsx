import { Trash2, Pin, PinOff, GripVertical } from 'lucide-react'
import type { StockQuoteGroup, PeriodQuote } from '../utils/api'
import { fmtPrice, priceColor } from '../utils/format'

// 监控卡片展示的周期（保持原有三周期）
const CARD_PERIODS = [5, 15, 30] as const

interface Props {
  quote: StockQuoteGroup
  onRemove: (code: string) => void
  onTogglePin: (code: string, pinned: boolean) => void
  pinned: boolean
  dragHandleProps?: Record<string, unknown> | null
}

function Badge({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={`px-1.5 py-0.5 font-mono text-[10px] ${active ? 'bg-gold/15 text-gold' : 'bg-edge text-dim'}`}>
      {children}
    </span>
  )
}

/** 单个周期行：价格是否在60线上方 + 是否已金叉 */
function PeriodRow({ q }: { q: PeriodQuote }) {
  return (
    <div className="flex items-center gap-2 border-t border-edge/60 py-1.5">
      <span className="w-9 shrink-0 border-r border-edge/60 pr-2 text-right font-mono text-[11px] font-bold text-gold">
        {q.period}分
      </span>
      <Badge active={q.priceAboveMa60}>{q.priceAboveMa60 ? '价格在60线上方' : '价格在60线下方'}</Badge>
      <Badge active={q.ma30AboveMa60}>{q.ma30AboveMa60 ? '均线已金叉' : '均线待金叉'}</Badge>
    </div>
  )
}

/** 单只监控股票卡片：三周期状态同屏 + 拖拽把手 + 置顶 */
export default function StockCard({ quote, onRemove, onTogglePin, pinned, dragHandleProps }: Props) {
  // 最新价取 5 分钟周期的（最及时），无则回退任一周期
  const price = quote.quotes.find((q) => q.period === 5)?.price ?? quote.quotes[0]?.price

  return (
    <div
      className={`panel group relative h-full rounded-sm p-4 transition-colors hover:border-edgebright ${
        pinned ? 'border-gold/50' : ''
      }`}
    >
      {/* 左上角：拖拽把手（cursor-grab） */}
      <div
        title="拖动调整位置"
        className="absolute left-1 top-1 cursor-grab p-1 text-dim/60 opacity-0 transition-opacity hover:text-ink active:cursor-grabbing group-hover:opacity-100"
        {...(dragHandleProps ?? {})}
      >
        <GripVertical size={14} />
      </div>

      {/* 右上角操作：置顶 / 取消置顶、移除 */}
      <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => onTogglePin(quote.code, !pinned)}
          title={pinned ? '取消置顶' : '置顶'}
          className={`p-1 transition-colors ${pinned ? 'text-gold' : 'text-dim hover:text-gold'}`}
        >
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        <button
          onClick={() => onRemove(quote.code)}
          title="移除监控"
          className="p-1 text-dim transition-colors hover:text-up"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mb-2 flex items-baseline gap-2 pl-5">
        <span className="text-sm font-bold">{quote.name}</span>
        <span className="font-mono text-xs text-dim">{quote.code}</span>
        {pinned && <Pin size={11} className="shrink-0 text-gold" />}
      </div>

      {price != null ? (
        <div className="flex items-baseline gap-3">
          <span className={`font-mono text-3xl font-semibold tracking-tight tabular-nums ${quote.dayChangePct != null ? priceColor(quote.dayChangePct) : 'text-ink'}`}>
            {fmtPrice(price)}
          </span>
          {quote.dayChangePct != null && (
            <span className={`font-mono text-lg font-bold ${priceColor(quote.dayChangePct)}`}>
              {quote.dayChangePct >= 0 ? '+' : ''}
              {quote.dayChangePct.toFixed(2)}%
            </span>
          )}
        </div>
      ) : (
        <div className="py-1 text-xs text-dim">{quote.error ?? '等待数据…'}</div>
      )}

      <div className="mt-2">
        {CARD_PERIODS.map((p) => {
          const q = quote.quotes.find((x) => x.period === p)
          return q ? (
            <PeriodRow key={p} q={q} />
          ) : (
            <div key={p} className="flex items-center border-t border-edge/60 py-1.5">
              <span className="w-9 shrink-0 border-r border-edge/60 pr-2 text-right font-mono text-[11px] font-bold text-gold">
                {p}分
              </span>
              <span className="text-[11px] text-dim/80">{quote.error ?? '该周期暂无数据'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
