import { useEffect, useState } from 'react'
import { Send, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { api } from '../utils/api'
import { useEngine } from '../hooks/useData'
import type { NotifyChannel } from '../../shared/types'

const CHANNELS: { id: NotifyChannel; name: string; hint: string; url: string }[] = [
  {
    id: 'serverchan',
    name: 'Server酱',
    hint: '微信扫码登录 sct.ftqq.com，复制 SendKey 粘贴到下方',
    url: 'https://sct.ftqq.com/',
  },
  {
    id: 'pushplus',
    name: 'PushPlus',
    hint: '微信登录 pushplus.plus，复制 Token 粘贴到下方',
    url: 'https://www.pushplus.plus/',
  },
]

const PHASE_TEXT: Record<string, string> = {
  trading: '交易时段 · 每30秒轮询',
  lunch: '午间休市 · 暂停轮询',
  closed: '已收盘 · 仅补偿推送',
}

/** 通知设置页 */
export default function SettingsPage() {
  const engine = useEngine()
  const [channel, setChannel] = useState<NotifyChannel>('serverchan')
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => {
      setChannel(s.channel)
      setKey(s.key)
    }).catch(() => undefined)
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.saveSettings({ channel, key })
      setToast({ ok: true, msg: '设置已保存' })
    } catch (e) {
      setToast({ ok: false, msg: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setSaving(false)
      setTimeout(() => setToast(null), 3000)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const r = await api.testNotify(channel, key)
      setToast({ ok: true, msg: r.message ?? '测试消息已发送，请查看微信' })
    } catch (e) {
      setToast({ ok: false, msg: e instanceof Error ? e.message : '测试失败' })
    } finally {
      setTesting(false)
      setTimeout(() => setToast(null), 5000)
    }
  }

  const active = CHANNELS.find((c) => c.id === channel)!

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* 通知设置 */}
      <div className="panel rounded-sm p-5 lg:col-span-3">
        <h2 className="mb-4 text-sm font-bold tracking-wide">微信推送设置</h2>

        <div className="mb-4 grid grid-cols-2 gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => setChannel(c.id)}
              className={`border p-3 text-left transition-colors ${
                channel === c.id ? 'border-gold bg-gold/10' : 'border-edge hover:border-edgebright'
              }`}
            >
              <div className={`text-sm font-bold ${channel === c.id ? 'text-gold' : ''}`}>{c.name}</div>
              <div className="mt-0.5 text-[11px] text-dim">
                {c.id === 'serverchan' ? '免费 · 配置最简单' : '免费 · 支持更多渠道'}
              </div>
            </button>
          ))}
        </div>

        <p className="mb-1 text-xs text-dim">
          {active.hint} ·{' '}
          <a href={active.url} target="_blank" rel="noreferrer" className="text-gold underline underline-offset-2">
            打开 {active.name} 官网 ↗
          </a>
        </p>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value.trim())}
          placeholder={channel === 'serverchan' ? 'SCT…（SendKey）' : 'PushPlus Token'}
          className="mb-4 w-full font-mono text-xs"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 border border-gold bg-gold px-4 py-2 text-sm font-bold text-base transition-colors hover:bg-gold/85 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            保存设置
          </button>
          <button
            onClick={test}
            disabled={testing || !key}
            className="flex items-center gap-1.5 border border-edge px-4 py-2 text-sm transition-colors hover:border-edgebright disabled:opacity-40"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            发送测试消息
          </button>
        </div>

        {toast && (
          <div className={`mt-4 flex items-center gap-2 text-sm ${toast.ok ? 'text-down' : 'text-up'}`}>
            {toast.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {toast.msg}
          </div>
        )}

        <div className="mt-5 border-t border-edge pt-4 text-xs leading-relaxed text-dim">
          <p>· 同一根K线同时触发金叉和突破时，两类信号合并为一条推送</p>
          <p>· 推送失败会自动留存，引擎在下次轮询时补偿推送</p>
          <p>· Key 仅保存在本地数据库，不会上传</p>
        </div>
      </div>

      {/* 系统状态 */}
      <div className="panel h-fit rounded-sm p-5 lg:col-span-2">
        <h2 className="mb-4 text-sm font-bold tracking-wide">引擎状态</h2>
        <div className="space-y-3 font-mono text-xs tabular-nums">
          {[
            ['运行状态', engine.data?.running ? '● 运行中' : '○ 已停止'],
            ['当前时段', PHASE_TEXT[engine.data?.phase ?? 'closed']],
            ['轮询间隔', '30 秒'],
            ['监控周期', '5 / 15 / 30 分钟'],
            ['监控股票', `${engine.data?.monitoredCount ?? 0} 只`],
            ['今日已推送', `${engine.data?.todayPushed ?? 0} 条`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-edge/60 pb-2">
              <span className="text-dim">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-dim/80">
          交易时段（9:30–11:30 / 13:00–15:00）每 30 秒对每只监控股票拉取 5/15/30 分钟K线并独立检测信号；收盘后引擎休眠，仅对未推送信号补偿推送。
        </p>
      </div>
    </div>
  )
}
