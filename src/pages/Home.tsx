import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import AddStockForm from '../components/AddStockForm'
import StockCard from '../components/StockCard'
import { useQuotes, useStocks } from '../hooks/useData'
import { api } from '../utils/api'
import type { StockQuoteGroup } from '../utils/api'

/** 可拖拽的卡片包装 */
function SortableCard({
  quote,
  onRemove,
  onTogglePin,
  pinned,
}: {
  quote: StockQuoteGroup
  onRemove: (code: string) => void
  onTogglePin: (code: string, pinned: boolean) => void
  pinned: boolean
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: quote.code,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-20' : ''}
    >
      <StockCard
        quote={quote}
        onRemove={onRemove}
        onTogglePin={onTogglePin}
        pinned={pinned}
        dragHandleProps={listeners}
      />
    </div>
  )
}

/** 监控管理页（首页）：卡片支持拖拽排序与置顶 */
export default function Home() {
  const stocks = useStocks()
  const quotes = useQuotes()
  const [order, setOrder] = useState<string[] | null>(null) // 本地拖拽中的顺序覆盖

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const stockList = stocks.data ?? []
  const quoteMap = new Map((quotes.data ?? []).map((q) => [q.code, q]))
  const fallbackQuote = (code: string, name: string): StockQuoteGroup => ({
    code,
    name,
    error: '等待轮询…',
    updatedAt: '',
    quotes: [],
  })

  // 展示顺序：本地拖拽覆盖 > 服务端顺序（pinned DESC, sort_order ASC）
  const ordered = order ?? stockList.map((s) => s.code)
  const pinnedSet = new Set(stockList.filter((s) => s.pinned).map((s) => s.code))
  const items = ordered
    .map((code) => {
      const s = stockList.find((x) => x.code === code)
      return s ? (quoteMap.get(code) ?? fallbackQuote(code, s.name)) : null
    })
    .filter((x): x is StockQuoteGroup => x != null)

  const remove = async (code: string) => {
    await api.deleteStock(code)
    setOrder(null)
    stocks.refresh()
    quotes.refresh()
  }

  const togglePin = async (code: string, pinned: boolean) => {
    await api.setPinned(code, pinned)
    setOrder(null)
    stocks.refresh()
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((x) => x.code === active.id)
    const newIndex = items.findIndex((x) => x.code === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(items, oldIndex, newIndex).map((x) => x.code)
    setOrder(next) // 立即反映到 UI
    try {
      await api.saveOrder(next)
      stocks.refresh()
    } catch {
      setOrder(null) // 失败回退
    }
  }

  return (
    <div>
      <AddStockForm stocks={stockList} onChanged={() => { setOrder(null); stocks.refresh() }} />

      {stocks.loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel h-44 animate-pulse rounded-sm" />
          ))}
        </div>
      ) : stockList.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-sm py-16 text-center">
          <span className="font-mono text-4xl text-edgebright">MA</span>
          <p className="text-sm text-dim">还没有监控的股票</p>
          <p className="text-xs text-dim/70">输入上方 6 位代码开始盯盘，金叉与突破信号会自动微信推送</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((x) => x.code)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((q) => (
                <SortableCard
                  key={q.code}
                  quote={q}
                  pinned={pinnedSet.has(q.code)}
                  onRemove={remove}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {quotes.error && (
        <p className="mt-4 text-xs text-up">行情获取失败：{quotes.error}（引擎将自动重试）</p>
      )}
    </div>
  )
}
