import { NavLink, useLocation } from 'react-router-dom'
import { Activity, Database, Settings2, Zap } from 'lucide-react'
import { useEngine } from '../hooks/useData'
import ThemeToggle from './ThemeToggle'
import { useEffect, useState } from 'react'

const PHASE_TEXT: Record<string, string> = {
  trading: '交易时段',
  lunch: '午间休市',
  closed: '已收盘',
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="font-mono text-xs text-dim tabular-nums">
      {now.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}
    </span>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { data: engine } = useEngine()
  const phase = engine?.phase ?? 'closed'
  const location = useLocation()

  const tabs = [
    { to: '/', label: '监控', icon: Activity },
    { to: '/etf', label: 'ETF 池', icon: Database },
    { to: '/settings', label: '设置', icon: Settings2 },
  ]

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 border-b border-edge bg-base/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center bg-gold text-base">
              <Zap size={16} strokeWidth={2.5} />
            </span>
            <div className="leading-none">
              <div className="text-sm font-bold tracking-wide">股票盯盘助手</div>
              <div className="font-mono text-[10px] text-dim">MA30×MA60 · 5M WATCHER</div>
            </div>
          </div>

          <nav className="flex items-center gap-1">
            {tabs.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm transition-colors ${
                    isActive || (to === '/' && location.pathname === '/')
                      ? 'border-gold text-gold'
                      : 'border-transparent text-dim hover:text-ink'
                  }`
                }
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-1.5" title={`监控引擎状态：${engine?.running ? '运行中' : '已停止'}`}>
              <span
                className={`h-2 w-2 rounded-full ${
                  engine?.running ? 'bg-down animate-breathe' : 'bg-dim'
                }`}
              />
              <span className="text-xs text-dim">
                {engine?.running ? '引擎运行中' : '引擎已停止'} · {PHASE_TEXT[phase]}
              </span>
            </div>
            <Clock />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {children}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-2">
        <p className="font-mono text-[10px] text-dim/70">
          信号检测基于 5/15/30 分钟K线收盘价 · MA30 上穿 MA60 为金叉 · 收盘价上穿 MA60 为突破 · 数据源：新浪财经
        </p>
      </footer>
    </div>
  )
}
