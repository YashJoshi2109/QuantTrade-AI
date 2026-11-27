/**
 * Admin console client helpers (shared by every /admin page, desktop + mobile).
 *
 * Authorization is decided by the backend: every /api/v1/admin/* route checks
 * admin itself, and /admin pages 404 server-side for non-admins. Nothing here
 * grants access; the `is_admin` flag only toggles the nav entry.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export type RangeKey = '24h' | '7d' | '30d' | '90d'
export const RANGES: { key: RangeKey; label: string }[] = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
]

export class AdminApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function adminFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/admin${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) },
  })
  const ct = res.headers.get('content-type') || ''
  const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : {}
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : Array.isArray(body?.detail) ? body.detail[0]?.msg : null
    throw new AdminApiError(res.status, detail || `Request failed (${res.status})`)
  }
  return body as T
}

export function adminPost<T = any>(path: string, body: unknown): Promise<T> {
  return adminFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

// ── Formatting ───────────────────────────────────────────────────────────────

export const DASH = '—'

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function fmtInt(v: unknown): string {
  return isNum(v) ? Math.round(v).toLocaleString('en-US') : DASH
}

/** Averages (e.g. avg DAU): one decimal below 10 so 0.3 is not shown as 0. */
export function fmtAvg(v: unknown): string {
  if (!isNum(v)) return DASH
  return Math.abs(v) < 10 && !Number.isInteger(v) ? v.toFixed(1) : fmtInt(v)
}

export function fmtCompact(v: unknown): string {
  if (!isNum(v)) return DASH
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`
  return Math.round(v).toLocaleString('en-US')
}

export function fmtUsd(v: unknown, digits = 2): string {
  if (!isNum(v)) return DASH
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function fmtPct(v: unknown, digits = 1): string {
  return isNum(v) ? `${(v * 100).toFixed(digits)}%` : DASH
}

export function fmtMs(v: unknown): string {
  if (!isNum(v)) return DASH
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`
}

export function fmtDelta(v: unknown): { text: string; tone: 'up' | 'down' | 'flat' | 'none' } {
  if (!isNum(v)) return { text: DASH, tone: 'none' }
  if (v === 0) return { text: '0.0%', tone: 'flat' }
  return { text: `${v > 0 ? '+' : ''}${v.toFixed(1)}%`, tone: v > 0 ? 'up' : 'down' }
}

export function fmtAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return DASH
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (!Number.isFinite(t)) return DASH
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return DASH
  return new Date(t).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtBytes(v: unknown): string {
  if (!isNum(v)) return DASH
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GB`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} KB`
  return `${v} B`
}

export type Tone = 'ok' | 'degraded' | 'down' | 'pending' | 'info'

export function statusTone(s: string | null | undefined): Tone {
  if (s === 'ok' || s === 'active') return 'ok'
  if (s === 'degraded' || s === 'warning' || s === 'unverified' || s === 'past_due') return 'degraded'
  if (s === 'down' || s === 'critical' || s === 'suspended' || s === 'failed') return 'down'
  if (s === 'pending' || s === 'not_configured') return 'pending'
  return 'info'
}

/** Services that count as an issue for the top-bar pill / sidebar badge. */
export function degradedCount(services: { status?: string }[] | null | undefined): number {
  return (services || []).filter((s) => s.status === 'degraded' || s.status === 'down').length
}

// ── Export ───────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Flatten nested objects into dotted keys so a page payload becomes rows. */
export function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    out[prefix || 'value'] = Array.isArray(obj) ? JSON.stringify(obj) : obj
    return out
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v
  }
  return out
}

/** CSV: arrays of objects become one table per section; scalars go in a key/value section. */
export function toCsv(data: Record<string, unknown>): string {
  const parts: string[] = []
  const scalars: [string, unknown][] = []
  for (const [section, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length && typeof value[0] === 'object') {
      const rows = value.map((r) => flatten(r))
      const cols = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s }, new Set<string>()))
      parts.push(`# ${section}`, cols.map(csvCell).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')), '')
    } else {
      for (const [k, v] of Object.entries(flatten(value, section))) scalars.push([k, v])
    }
  }
  const head = scalars.length ? ['# summary', 'key,value', ...scalars.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`), ''] : []
  return [...head, ...parts].join('\n')
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportReport(page: string, range: RangeKey, format: 'csv' | 'json', data: Record<string, unknown>) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const name = `quanttrade-admin-${page}-${range}-${stamp}.${format}`
  if (format === 'json') download(name, JSON.stringify(data, null, 2), 'application/json')
  else download(name, toCsv(data), 'text/csv')
  try {
    await adminPost('/export-log', { page, format, range })
  } catch {
    /* the export itself already happened; the audit call is best effort from the UI */
  }
}

export const ADMIN_PAGES: { href: string; label: string; section: string }[] = [
  { href: '/admin', label: 'Command Center', section: 'Overview' },
  { href: '/admin/users', label: 'User Intelligence', section: 'Business intelligence' },
  { href: '/admin/ai', label: 'AI Observability', section: 'Business intelligence' },
  { href: '/admin/revenue', label: 'Revenue & Plans', section: 'Business intelligence' },
  { href: '/admin/product', label: 'Product Analytics', section: 'Business intelligence' },
  { href: '/admin/traffic', label: 'Traffic', section: 'Business intelligence' },
  { href: '/admin/health', label: 'System Health', section: 'Platform operations' },
  { href: '/admin/data', label: 'Data Intelligence', section: 'Platform operations' },
  { href: '/admin/security', label: 'Security & Audit', section: 'Platform operations' },
]
