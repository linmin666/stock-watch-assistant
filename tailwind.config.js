/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 颜色走 CSS 变量（:root=黑夜，html.light=白天），支持 Tailwind 透明度修饰符
        base: 'rgb(var(--c-base) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        edge: 'rgb(var(--c-edge) / <alpha-value>)',
        edgebright: 'rgb(var(--c-edgebright) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        dim: 'rgb(var(--c-dim) / <alpha-value>)',
        gold: 'rgb(var(--c-gold) / <alpha-value>)',
        cyan: 'rgb(var(--c-cyan) / <alpha-value>)',
        up: 'rgb(var(--c-up) / <alpha-value>)',
        down: 'rgb(var(--c-down) / <alpha-value>)',
        ongold: 'rgb(var(--c-ongold) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        pulseEdge: {
          '0%, 100%': { borderColor: 'rgba(245,185,74,0.9)' },
          '50%': { borderColor: 'rgba(245,185,74,0.25)' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        breathe: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        pulseEdge: 'pulseEdge 1.6s ease-in-out infinite',
        sweep: 'sweep 1.8s ease-in-out infinite',
        breathe: 'breathe 1.4s ease-in-out infinite',
        riseIn: 'riseIn 0.5s ease-out both',
      },
    },
  },
  plugins: [],
}
