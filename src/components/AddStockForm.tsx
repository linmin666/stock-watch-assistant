import { useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { api } from '../utils/api'
import type { Stock } from '../../shared/types'

interface Props {
  stocks: Stock[]
  onChanged: () => void
}

export default function AddStockForm({ stocks, onChanged }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('请输入 6 位数字股票代码')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const added = await api.addStock(code)
      setCode('')
      onChanged()
      void added
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel mb-5 rounded-sm p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-dim">添加监控</label>
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="如 600519 / 000001 / 300750"
          className="w-52 font-mono tracking-widest placeholder:text-dim/40"
          inputMode="numeric"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-1.5 border border-gold bg-gold px-4 py-2 text-sm font-bold text-base transition-colors hover:border-gold/80 hover:bg-gold/85 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={2.5} />}
          加入监控
        </button>
        {error && <span className="text-xs text-up">{error}</span>}
        <span className="ml-auto font-mono text-xs text-dim">已监控 {stocks.length} 只</span>
      </div>
    </div>
  )
}
