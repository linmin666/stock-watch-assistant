import { useMemo, useState } from 'react'
import { Flame, RefreshCw, TrendingUp, TrendingDown, Search, Loader2, X, CheckCircle2, XCircle } from 'lucide-react'
import { usePolling } from '../hooks/useData'
import { api } from '../utils/api'
import { priceColor } from '../utils/format'
import type { SectorHot, StockSectorLookup } from '../utils/api'

/** 主力净流入额格式化：元 → 亿/万 */
function fmtInflow(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(0)}万`
  return value.toFixed(0)
}

/** 热点周期定义 */
const HOT_WINDOWS = [
  { key: 'day', label: '当日', sub: '今日涨幅', get: (s: SectorHot) => s.changePct },
  { key: 'week', label: '近一周', sub: '5日涨幅', get: (s: SectorHot) => s.weekPct },
  { key: 'twoWeek', label: '近两周', sub: '10日涨幅', get: (s: SectorHot) => s.twoWeekPct },
  { key: 'month', label: '近一月', sub: '20日涨幅', get: (s: SectorHot) => s.monthPct },
] as const

type HotKey = (typeof HOT_WINDOWS)[number]['key']

/** 单块热点面板：某周期 Top5 板块 */
function HotPanel({
  label,
  sub,
  items,
  get,
  highlightCode,
  stockLabel,
}: {
  label: string
  sub: string
  items: SectorHot[]
  get: (s: SectorHot) => number
  highlightCode: string | null
  /** 筛选的股票名称+代码（命中时展示在卡片上） */
  stockLabel: string | null
}) {
  return (
    <div className="panel rounded-sm p-4 animate-riseIn">
      {/* 面板头 */}
      <div className="mb-3 flex items-center gap-2 border-b border-edge/60 pb-2.5">
        <span className="grid h-6 w-6 place-items-center bg-gold/15 text-gold">
          <Flame size={13} />
        </span>
        <span className="text-sm font-bold">{label}</span>
        <span className="font-mono text-[10px] text-dim">{sub}</span>
        <span className="ml-auto font-mono text-[10px] text-dim">TOP 5</span>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-xs text-dim">暂无数据</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((s, i) => {
            const pct = get(s)
            const hit = highlightCode != null && s.code === highlightCode
            return (
              <li
                key={s.code}
                className={`rounded border px-2 py-2 transition-all ${
                  hit
                    ? 'border-gold bg-gold/10 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]'
                    : 'border-transparent hover:border-edge hover:bg-white/40 dark:hover:bg-black/25'
                }`}
              >
                {/* 排名 + 名称 + 涨幅 */}
                <div className="flex items-center gap-2.5">
                  <span
                    className={`inline-grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[11px] ${
                      hit
                        ? 'bg-gold text-base font-bold'
                        : i === 0
                          ? 'bg-gold text-base font-bold'
                          : i === 1
                            ? 'bg-edgebright text-base'
                            : 'bg-edge/60 text-dim'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate text-sm font-medium text-ink">
                    {hit && <span className="mr-1 text-gold">★</span>}
                    {s.name}
                  </span>
                  <span className={`ml-auto shrink-0 font-mono text-sm font-bold ${priceColor(pct)}`}>
                    {pct > 0 ? '+' : ''}
                    {pct.toFixed(2)}%
                  </span>
                </div>
                {/* 涨跌家数 + 主力净流入 + 领涨股 */}
                <div className="mt-1 flex items-center gap-2 pl-7.5 text-[11px] text-dim">
                  {hit && stockLabel ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold/15 px-1.5 py-0.5 font-bold text-gold"
                      title={`筛选股票：${stockLabel}`}
                    >
                      <Search size={10} />
                      {stockLabel}
                    </span>
                  ) : (
                    <>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <TrendingUp size={11} className="text-up" />
                        {s.upCount}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <TrendingDown size={11} className="text-down" />
                        {s.downCount}
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 font-mono ${priceColor(s.mainInflow)}`}
                        title={`主力净流入占比 ${s.mainInflowPct > 0 ? '+' : ''}${s.mainInflowPct.toFixed(2)}%`}
                      >
                        净流入 {s.mainInflow > 0 ? '+' : ''}
                        {fmtInflow(s.mainInflow)}
                      </span>
                    </>
                  )}
                  {s.leaderName ? (
                    <span className="ml-auto truncate">
                      领涨：<span className="text-ink/80">{s.leaderName}</span>
                      <span className={`ml-1 font-mono ${priceColor(s.leaderPct)}`}>
                        {s.leaderPct > 0 ? '+' : ''}
                        {s.leaderPct.toFixed(2)}%
                      </span>
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** 股票筛选框：输入代码或名称查询所属板块，与四个 Top5 求交集 */
function StockFilter({
  top5,
  onHighlight,
}: {
  top5: Record<HotKey, SectorHot[]>
  onHighlight: (hitCodes: Set<string>, windows: HotKey[], lookup: StockSectorLookup | null) => void
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    lookup: StockSectorLookup
    /** 命中的热榜板块代码 */
    hits: Set<string>
    /** 命中的周期（板块属于哪些 Top5） */
    windows: HotKey[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    const q = input.trim()
    if (/^\d{6}$/.test(q)) {
      // 代码
    } else if (/^[\u4e00-\u9fa5A-Za-z0-9]{2,12}$/.test(q)) {
      // 名称/拼音
    } else {
      setError('请输入 6 位股票代码或股票名称')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const lookup = await api.stockSectors(q)
      // 求交集：股票所属板块 × 四个周期的 Top5
      const hits = new Set<string>()
      const windows: HotKey[] = []
      const owned = new Set(lookup.sectors.map((s) => s.code))
      for (const w of HOT_WINDOWS) {
        for (const sec of top5[w.key] ?? []) {
          if (owned.has(sec.code)) {
            hits.add(sec.code)
            windows.push(w.key)
            break // 该周期命中一个板块即可
          }
        }
      }
      setResult({ lookup, hits, windows })
      onHighlight(hits, windows, lookup)
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : '查询失败')
      onHighlight(new Set(), [], null)
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    setInput('')
    setResult(null)
    setError(null)
    onHighlight(new Set(), [], null)
  }

  // 结果提示
  const hitLabel =
    result && result.windows.length > 0
      ? HOT_WINDOWS.filter((w) => result.windows.includes(w.key))
          .map((w) => w.label)
          .join('、')
      : ''

  return (
    <div className="mt-3 border-t border-edge/60 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-dim">
          <Search size={13} className="text-gold" />
          股票查板块
        </label>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 12))}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="代码或名称，如 603381 / 永臻股份"
          className="w-52 placeholder:text-dim/40"
        />
        <button
          onClick={search}
          disabled={busy}
          className="flex items-center gap-1 rounded border border-gold bg-gold px-3 py-1 text-xs font-bold text-base transition hover:bg-gold/85 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} strokeWidth={2.5} />}
          查询
        </button>
        {result && (
          <button
            onClick={clear}
            title="清除筛选"
            className="rounded p-1 text-dim transition hover:text-ink"
          >
            <X size={14} />
          </button>
        )}

        {/* 结果提示 */}
        {result && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
              result.windows.length > 0 ? 'bg-gold/10 text-gold' : 'bg-down/10 text-down'
            }`}
          >
            {result.windows.length > 0 ? (
              <>
                <CheckCircle2 size={12} />
                <span className="font-bold">
                  {result.lookup.stockName || result.lookup.stockCode}
                </span>
                <span className="font-mono text-dim">{result.lookup.stockCode}</span>
                所在板块命中 {hitLabel}，已高亮
              </>
            ) : (
              <>
                <XCircle size={12} />
                <span className="font-bold">
                  {result.lookup.stockName || result.lookup.stockCode}
                </span>
                <span className="font-mono">{result.lookup.stockCode}</span>
                的板块「{result.lookup.sectors.map((s) => s.name).join(' / ')}」不在热门板块内
              </>
            )}
          </span>
        )}
        {error && <span className="text-xs text-down">{error}</span>}
      </div>
    </div>
  )
}

/** 板块热点页面 */
export default function Sectors() {
  // 板块数据引擎每轮已刷新，前端 60s 轮询展示缓存即可
  const { data, loading, error, refresh } = usePolling(api.sectors, 60000)
  const [refreshing, setRefreshing] = useState(false)

  // 筛选命中的板块代码与股票名称（跨四个面板高亮）
  const [highlightCode, setHighlightCode] = useState<string | null>(null)
  const [stockLabel, setStockLabel] = useState<string | null>(null)

  // 四个周期各自的 Top5
  const top5 = useMemo(() => {
    const list = data?.sectors ?? []
    return Object.fromEntries(
      HOT_WINDOWS.map((w) => [w.key, [...list].sort((a, b) => w.get(b) - w.get(a)).slice(0, 5)]),
    ) as Record<HotKey, SectorHot[]>
  }, [data])

  const handleHighlight = (hits: Set<string>, _windows: HotKey[], lookup: StockSectorLookup | null) => {
    setHighlightCode(hits.size > 0 ? [...hits][0] : null)
    setStockLabel(lookup ? `${lookup.stockName || lookup.stockCode} ${lookup.stockCode}` : null)
  }

  const updatedAt = data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : ''

  const handleRefresh = () => {
    setRefreshing(true)
    refresh()
    setTimeout(() => setRefreshing(false), 500)
  }

  return (
    <div>
      {/* 页头 */}
      <div className="panel mb-5 rounded-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center bg-gold/15 text-gold">
              <Flame size={15} />
            </span>
            <span className="text-sm font-bold tracking-wide">板块热点</span>
          </span>
          <span className="hidden font-mono text-[11px] text-dim md:inline">
            A股各板块 · 当日/周/两周/月 涨幅 Top5 · 共 {data?.sectors.length ?? 0} 个板块
          </span>
          <div className="ml-auto flex items-center gap-2">
            {updatedAt && <span className="font-mono text-[11px] text-dim">更新于 {updatedAt}</span>}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1 rounded border border-edge px-2.5 py-1 text-xs text-dim transition hover:border-edgebright hover:text-ink disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>
        </div>

        {/* 股票查板块筛选 */}
        <StockFilter top5={top5} onHighlight={handleHighlight} />

        {data?.error && (
          <div className="mt-2 border-t border-edge/60 pt-2 text-xs text-down">
            板块数据拉取失败：{data.error}
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="panel h-64 animate-pulse rounded-sm" />
          ))}
        </div>
      ) : error ? (
        <div className="panel py-16 text-center">
          <p className="text-sm text-down">{error}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {HOT_WINDOWS.map((w) => (
            <HotPanel
              key={w.key}
              label={w.label}
              sub={w.sub}
              items={top5[w.key] ?? []}
              get={w.get}
              highlightCode={highlightCode}
              stockLabel={stockLabel}
            />
          ))}
        </div>
      )}

      {/* 底部说明 */}
      <p className="mt-4 font-mono text-[10px] text-dim/70">
        口径：当日=今日涨跌幅 · 近一周=5日累计 · 近两周=10日累计 · 近一月=20日累计 · 净流入=当日主力资金净流入（悬停查看占比） · 数据源：东方财富 · 领涨股为板块内当日涨幅最高个股
      </p>
    </div>
  )
}
