import { useMemo, useState } from 'react'
import { Plus, Loader2, Trash2, X, RefreshCw, Database, TrendingUp, ListOrdered } from 'lucide-react'
import { useManual } from '../hooks/useData'
import { api } from '../utils/api'
import { fmtPrice } from '../utils/format'
import type { EtfPoolItem } from '../utils/api'
import type { Stock } from '../../shared/types'

// 表头顺序：周线、日线、小时、半小时、15分钟、5分钟（按优先级从高到低）
const PERIOD_COLUMNS = [
  { key: '10080', label: '周线' },
  { key: '1440', label: '日线' },
  { key: '60', label: '小时' },
  { key: '30', label: '半小时' },
  { key: '15', label: '15分钟' },
  { key: '5', label: '5分钟' },
]

/**
 * ETF 池排序逻辑
 * 按优先级逐列比较：周 > 日 > 时 > 30分 > 15分 > 5分
 * 在均线上的排前面
 */
function compareEtf(a: EtfPoolItem, b: EtfPoolItem): number {
  for (const col of PERIOD_COLUMNS) {
    const pa = a.periods[col.key]
    const pb = b.periods[col.key]
    const aOk = pa != null
    const bOk = pb != null

    // 有数据的优先
    if (aOk && !bOk) return -1
    if (!aOk && bOk) return 1
    if (aOk && bOk) {
      // 在均线上的排前面
      if (pa.above && !pb.above) return -1
      if (!pa.above && pb.above) return 1
      // 状态相同则继续比较下一列
    }
  }
  // 所有周期状态都相同，按代码排序
  return a.code.localeCompare(b.code)
}

/** 统计全部周期均在均线上的数量 */
function countAllAbove(item: EtfPoolItem): boolean {
  return PERIOD_COLUMNS.every((col) => item.periods[col.key]?.above === true)
}

/** 添加 ETF 表单 */
function AddEtfForm({ stocks, onChanged }: { stocks: Stock[]; onChanged: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('请输入 6 位数字代码')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.addEtfStock(code)
      setCode('')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel mb-5 rounded-sm border-l-2 border-l-gold p-4 animate-riseIn">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm font-medium text-dim">
          <Plus size={14} className="text-gold" />
          添加 ETF
        </label>
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="如 513120 / 588200"
          className="w-52 font-mono tracking-widest placeholder:text-dim/40"
          inputMode="numeric"
          autoFocus
        />
        <button
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-1.5 border border-gold bg-gold px-4 py-2 text-sm font-bold text-base transition-colors hover:border-gold/80 hover:bg-gold/85 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={2.5} />}
          加入 ETF 池
        </button>
        {error && <span className="text-xs text-up">{error}</span>}
        <span className="ml-auto font-mono text-xs text-dim">共 {stocks.length} 只</span>
      </div>
    </div>
  )
}

/** ETF 池页面 */
export default function EtfPool() {
  // ETF 池数据不自动轮询，仅在手动刷新时拉取
  const etf = useManual<EtfPoolItem[]>(api.etfPool)
  const etfStocks = useManual<Stock[]>(api.listEtfStocks)
  const [showAdd, setShowAdd] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const sorted = useMemo(() => {
    if (!etf.data) return []
    return [...etf.data].sort(compareEtf)
  }, [etf.data])

  // 汇总统计
  const stats = useMemo(() => {
    // 周线在均线上 / 日线在均上的数量
    const weeklyAbove = sorted.filter((i) => i.periods['10080']?.above === true).length
    const dailyAbove = sorted.filter((i) => i.periods['1440']?.above === true).length
    return { weeklyAbove, dailyAbove }
  }, [sorted])

  const remove = async (code: string) => {
    await api.deleteEtfStock(code)
    etfStocks.refresh()
    etf.refresh()
  }

  /** 手动刷新：先让引擎立即轮询 ETF 池 K 线，再拉取最新快照 */
  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.engineRefresh()
    } catch {
      // 引擎刷新失败也不影响拉取现有快照
    }
    etf.refresh()
    etfStocks.refresh()
    setRefreshing(false)
  }

  return (
    <div>
      {showAdd ? (
        <AddEtfForm stocks={etfStocks.data ?? []} onChanged={() => { etfStocks.refresh(); etf.refresh() }} />
      ) : null}

      {/* 页头：标题 + 统计卡片 + 操作按钮 */}
      <div className="panel mb-5 rounded-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center bg-gold/15 text-gold">
              <Database size={15} />
            </span>
            <span className="text-sm font-bold tracking-wide">ETF 池</span>
          </span>
          <span className="hidden font-mono text-[11px] text-dim md:inline">
            周→日→时→30分→15分→5分 优先级排序
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-1 rounded border border-gold bg-gold px-2.5 py-1 text-xs font-bold text-base transition hover:bg-gold/85"
            >
              {showAdd ? <X size={12} /> : <Plus size={12} strokeWidth={2.5} />}
              {showAdd ? '收起' : '添加'}
            </button>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="flex items-center gap-1 rounded border border-edge px-2.5 py-1 text-xs text-dim transition hover:border-edgebright hover:text-ink disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>

        {/* 统计行 */}
        {sorted.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-edge/60 pt-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/10 px-2.5 py-1 text-xs text-gold">
              <ListOrdered size={12} />
              共 {sorted.length} 只
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-up/10 px-2.5 py-1 text-xs text-up">
              <TrendingUp size={12} />
              周线上 {stats.weeklyAbove} 只
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-up/10 px-2.5 py-1 text-xs text-up">
              <TrendingUp size={12} />
              日线上 {stats.dailyAbove} 只
            </span>
          </div>
        )}
      </div>

      {etf.loading ? (
        <div className="panel h-40 animate-pulse rounded-sm" />
      ) : sorted.length === 0 ? (
        <div className="panel flex flex-col items-center py-16 text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-gold/10 text-gold">
            <Database size={22} />
          </span>
          <p className="text-sm text-dim">ETF 池为空</p>
          <p className="mt-1 text-xs text-dim/70">点击右上角"添加"按钮，输入 6 位代码加入 ETF 池</p>
        </div>
      ) : (
        <div className="panel overflow-hidden rounded-sm shadow-sm">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-edge bg-panel text-xs text-dim">
                  <th className="bg-panel px-4 py-3 text-center font-medium">序号</th>
                  <th className="bg-panel px-4 py-3 font-medium">股票名称</th>
                  {PERIOD_COLUMNS.map((col) => (
                    <th key={col.key} className="bg-panel px-3 py-3 text-center font-medium">
                      {col.label}
                    </th>
                  ))}
                  <th className="bg-panel px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((item, idx) => {
                  const all = countAllAbove(item)
                  return (
                    <tr
                      key={item.code}
                      className={`group border-b border-edge/50 transition-colors last:border-b-0 hover:bg-white/40 dark:hover:bg-black/25 ${
                        all ? 'bg-gold/[0.04]' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-grid h-6 w-6 place-items-center rounded-full font-mono text-xs ${
                            all
                              ? 'bg-gold text-base font-bold'
                              : 'bg-edge/50 text-dim'
                          }`}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex flex-col">
                            <span className="font-medium text-ink">{item.name}</span>
                            <span className="font-mono text-[11px] text-dim">{item.code}</span>
                          </div>
                        </div>
                      </td>
                      {PERIOD_COLUMNS.map((col) => {
                        const d = item.periods[col.key]
                        return (
                          <td key={col.key} className="px-3 py-3 text-center">
                            {d == null ? (
                              <span className="text-dim/50">—</span>
                            ) : (
                              <span
                                className={`inline-flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-transform hover:scale-105 ${
                                  d.above
                                    ? 'border-up/30 bg-up/10 text-up'
                                    : 'border-down/30 bg-down/10 text-down'
                                }`}
                                title={`${fmtPrice(d.price)} ${d.above ? '>' : '<'} MA60 ${fmtPrice(d.ma60)}（${d.pctFromMa60 >= 0 ? '+' : ''}${d.pctFromMa60.toFixed(2)}%）`}
                              >
                                <span
                                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                                    d.above ? 'bg-up' : 'bg-down'
                                  } ${d.above ? 'animate-breathe' : 'opacity-60'}`}
                                />
                                {d.above ? '上' : '下'}
                              </span>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-2 py-3 text-right">
                        <button
                          onClick={() => remove(item.code)}
                          title="从 ETF 池移除"
                          className="rounded p-1 text-dim opacity-0 transition group-hover:opacity-100 hover:bg-down/10 hover:text-down"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* 底部图例 */}
          <div className="flex items-center gap-4 border-t border-edge/60 px-4 py-2.5 text-[11px] text-dim">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-up" /> 上 = 收盘价在 MA60 上方
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-down opacity-60" /> 下 = 收盘价在 MA60 下方
            </span>
            <span>悬停徽标查看具体价格与偏离度</span>
          </div>
        </div>
      )}
    </div>
  )
}
