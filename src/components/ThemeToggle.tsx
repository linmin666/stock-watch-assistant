import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'swa-theme'

/** 读取当前主题（html.light class 决定） */
export function getTheme(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

/** 切换主题并持久化 */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light')
  localStorage.setItem(STORAGE_KEY, theme)
}

/** 主题切换按钮（顶栏用） */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getTheme())

  useEffect(() => {
    const sync = () => setTheme(getTheme())
    // 其他窗口切换时同步
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
      className="flex h-8 w-8 items-center justify-center border border-edge text-dim transition-colors hover:border-edgebright hover:text-gold"
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}
