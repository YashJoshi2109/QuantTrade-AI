/**
 * CSV export helpers (Earnings and Dividends calendars, desktop + mobile).
 * Unknown values are written as empty cells, never 0.
 */

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' && !Number.isFinite(v)) return ''
  const s = String(v)
  // Quote when needed; neutralise spreadsheet formula injection (=, +, -, @ at the start of text).
  const safe = typeof v === 'string' && /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === 'undefined') return
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
