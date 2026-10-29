/** "2026-10-28 14:30" → "10-28 14:30" */
export function formatKlineTime(t: string): string {
  const m = t.match(/\d{2}-\d{2} \d{2}:\d{2}/)
  return m ? m[0] : t
}

/** ISO → "MM-DD HH:mm:ss"（本地） */
export function formatDateTime(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 价格统一显示：小数点后 3 位 */
export function fmtPrice(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '-' : value.toFixed(3)
}

/** 涨跌颜色类名 */
export function priceColor(value: number): string {
  return value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-ink'
}
