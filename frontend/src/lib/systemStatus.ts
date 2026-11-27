/**
 * Live system status (GET /api/v1/system/status): types + pure helpers shared by
 * the top-bar pill, the desktop popover, the mobile bottom sheet, the /status
 * page and the Copilot banner. Every value shown comes from a real probe result;
 * nothing here invents data.
 */
import { apiUrl } from '@/lib/api'

export type ServiceState = 'ok' | 'degraded' | 'down' | 'not_configured' | 'pending'
export type OverallState = 'ok' | 'degraded' | 'down'
export type ServiceGroup = 'core' | 'market_data' | 'intelligence'

export interface ServiceQuota {
  used: number
  limit: number
  remaining: number
  resets_at: string | null
  window: string | null
}

export interface ServiceStatus {
  id: string
  name: string
  group: ServiceGroup | string
  critical?: boolean
  interval_s?: number
  status: ServiceState
  latency_ms: number | null
  last_ok_at: string | null
  last_checked_at: string | null
  detail: string
  quota: ServiceQuota | null
  meta?: Record<string, unknown>
}

export interface SystemStatus {
  generated_at: string
  overall: OverallState
  counts?: Partial<Record<ServiceState, number>>
  issues?: string[]
  services: ServiceStatus[]
  collector?: { running: boolean; started_at: string | null; leader: boolean }
}

export const STATUS_PATH = '/api/v1/system/status'
export const POLL_MS = 1_000
export const ERROR_POLL_MS = 10_000
export const HISTORY_WINDOW_MS = 5 * 60_000

export const GROUPS: { id: ServiceGroup; label: string }[] = [
  { id: 'core', label: 'Core' },
  { id: 'market_data', label: 'Market data' },
  { id: 'intelligence', label: 'Intelligence' },
]

export async function fetchSystemStatus(signal?: AbortSignal): Promise<SystemStatus> {
  const res = await fetch(apiUrl(STATUS_PATH).toString(), { cache: 'no-store', signal })
  if (!res.ok) throw new Error(`System status HTTP ${res.status}`)
  const body = (await res.json()) as SystemStatus
  if (!body || !Array.isArray(body.services)) throw new Error('System status: malformed response')
  return body
}

/** Poll cadence: 1 s normally, 10 s after a failed request. */
export function pollInterval(failed: boolean): number {
  return failed ? ERROR_POLL_MS : POLL_MS
}

/** Configured services that are degraded or down. */
export function issueServices(s: SystemStatus | undefined | null): ServiceStatus[] {
  if (!s) return []
  return s.services.filter((x) => x.status === 'degraded' || x.status === 'down')
}

export interface PillView {
  tone: 'ok' | 'degraded' | 'down' | 'unknown'
  label: string
  short: string
}

/**
 * What the pill says. `unreachable` = the status endpoint itself failed (with
 * no earlier snapshot), which is an outage from the user's point of view.
 */
export function pillView(s: SystemStatus | undefined | null, unreachable: boolean): PillView {
  if (!s) {
    if (unreachable) return { tone: 'down', label: 'Outage: status API unreachable', short: 'Outage' }
    return { tone: 'unknown', label: 'Checking systems…', short: 'Checking' }
  }
  const n = issueServices(s).length
  if (s.overall === 'down') return { tone: 'down', label: n > 1 ? `Outage · ${n} services affected` : 'Outage', short: 'Outage' }
  if (s.overall === 'degraded' || n > 0) return { tone: 'degraded', label: `Degraded: ${n}`, short: `Degraded: ${n}` }
  return { tone: 'ok', label: 'All systems normal', short: 'Normal' }
}

export function groupServices(s: SystemStatus | undefined | null) {
  const services = s?.services ?? []
  const known = new Set<string>(GROUPS.map((g) => g.id))
  const out = GROUPS.map((g) => ({ ...g, services: services.filter((x) => x.group === g.id) }))
  const other = services.filter((x) => !known.has(String(x.group)))
  if (other.length) out.push({ id: 'core', label: 'Other', services: other })
  return out.filter((g) => g.services.length > 0)
}

/**
 * Seconds since `iso`, measured on the server clock: (generated_at - iso) plus
 * the time since this snapshot arrived. Immune to client clock skew.
 */
export function secondsSince(
  iso: string | null | undefined,
  generatedAt: string | undefined,
  receivedAtMs: number,
  nowMs: number,
): number | null {
  if (!iso || !generatedAt) return null
  const t = Date.parse(iso)
  const g = Date.parse(generatedAt)
  if (!Number.isFinite(t) || !Number.isFinite(g)) return null
  return Math.max(0, (g - t) / 1000 + (nowMs - receivedAtMs) / 1000)
}

export function formatAge(sec: number | null): string {
  if (sec == null) return '—'
  const s = Math.floor(sec)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 10) return `${ms.toFixed(1)} ms`
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export const STATE_LABEL: Record<ServiceState, string> = {
  ok: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  not_configured: 'Not configured',
  pending: 'Checking',
}

/** Tailwind classes per state; opaque colours that read in light and dark. */
export const STATE_DOT: Record<ServiceState | 'unknown', string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-rose-500',
  not_configured: 'bg-slate-400',
  pending: 'bg-slate-400',
  unknown: 'bg-slate-400',
}

export const STATE_TEXT: Record<ServiceState, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  degraded: 'text-amber-700 dark:text-amber-400',
  down: 'text-rose-700 dark:text-rose-400',
  not_configured: 'text-slate-500 dark:text-slate-400',
  pending: 'text-slate-500 dark:text-slate-400',
}

export function quotaPercent(q: ServiceQuota | null | undefined): number | null {
  if (!q || !q.limit) return null
  return Math.min(100, Math.max(0, (q.used / q.limit) * 100))
}

// ── client-side latency history (sparklines on /status) ────────────────────

export interface HistoryPoint {
  t: number
  latency: number | null
  status: ServiceState
}

export type History = Record<string, HistoryPoint[]>

/**
 * Append one snapshot to the per-service history, dropping points older than
 * the window. A point is added only when that service was re-checked, so a
 * 1 s poll of a 30 s probe does not pad the line with duplicates.
 */
export function appendHistory(
  prev: History,
  s: SystemStatus,
  nowMs: number,
  windowMs: number = HISTORY_WINDOW_MS,
): History {
  const out: History = {}
  const cutoff = nowMs - windowMs
  for (const svc of s.services) {
    const pts = (prev[svc.id] ?? []).filter((p) => p.t >= cutoff)
    const checked = svc.last_checked_at ? Date.parse(svc.last_checked_at) : NaN
    const last = pts[pts.length - 1]
    if (Number.isFinite(checked) && (!last || checked > last.t)) {
      pts.push({ t: checked, latency: svc.latency_ms, status: svc.status })
    }
    out[svc.id] = pts
  }
  return out
}

/** SVG polyline points for a sparkline (null latencies leave gaps). */
export function sparklinePath(points: HistoryPoint[], width: number, height: number, windowMs = HISTORY_WINDOW_MS): string {
  const vals = points.filter((p) => p.latency != null) as (HistoryPoint & { latency: number })[]
  if (vals.length < 2) return ''
  const end = vals[vals.length - 1].t
  // x spans the samples we have (up to the window), so a young history fills the width
  const start = Math.max(vals[0].t, end - windowMs)
  const span = Math.max(1, end - start)
  const max = Math.max(...vals.map((p) => p.latency), 1)
  return vals
    .filter((p) => p.t >= start)
    .map((p) => {
      const x = ((p.t - start) / span) * width
      const y = height - (p.latency / max) * (height - 2) - 1
      return `${Math.max(0, x).toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export function serviceById(s: SystemStatus | undefined | null, id: string): ServiceStatus | undefined {
  return s?.services.find((x) => x.id === id)
}

export const COPILOT_SERVICE_ID = 'copilot_llm'

/** Copilot page banner, or null when the LLM service is fine / unknown. */
export function copilotBanner(
  s: SystemStatus | undefined | null,
): { tone: 'degraded' | 'down'; title: string; body: string } | null {
  const svc = serviceById(s, COPILOT_SERVICE_ID)
  if (!svc || (svc.status !== 'degraded' && svc.status !== 'down')) return null
  const detail = svc.detail.replace(/[.\s]+$/, '')
  if (svc.status === 'down') {
    return { tone: 'down', title: 'The AI model is not answering right now.', body: `${detail}. Answers may fail until it recovers.` }
  }
  return { tone: 'degraded', title: 'The AI model is degraded.', body: `${detail}. Answers may be slower or fail.` }
}
