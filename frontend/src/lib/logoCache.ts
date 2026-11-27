/**
 * Client-side logo bookkeeping shared by every <TickerLogo>.
 *
 * One strategy: logos come only from the same-origin `/api/logo` proxy (or an explicit
 * `logoSrc` the API already returned). This module remembers which symbols resolved and
 * which missed, so a symbol that 404'd is never requested again this session (and for a
 * day across visits via localStorage), and caps how many logo images load at once so a
 * long table cannot open hundreds of connections in one burst.
 */

export const LOGO_MISS_TTL_MS = 24 * 60 * 60 * 1000
export const LOGO_MAX_CONCURRENT = 6
const STORAGE_KEY = 'qt:logo-miss:v1'
const MAX_STORED = 2000

type State = 'ok' | 'miss'
const state = new Map<string, State>()
let missExpiry: Record<string, number> | null = null

function loadMisses(): Record<string, number> {
  if (missExpiry) return missExpiry
  missExpiry = {}
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, number>
      const now = Date.now()
      for (const [k, exp] of Object.entries(parsed)) {
        if (typeof exp === 'number' && exp > now) missExpiry[k] = exp
      }
    }
  } catch {
    /* storage blocked or corrupt: in-memory only */
  }
  return missExpiry
}

function persistMisses() {
  if (!missExpiry) return
  try {
    let entries = Object.entries(missExpiry)
    if (entries.length > MAX_STORED) {
      entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_STORED)
      missExpiry = Object.fromEntries(entries)
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(missExpiry))
  } catch {
    /* ignore */
  }
}

/** Same-origin logo proxy URL (server caches hits and misses; see app/api/logo). */
export function logoProxyUrl(ticker: string): string {
  return `/api/logo?symbol=${encodeURIComponent(ticker)}`
}

/** Keys are image URLs; proxy URLs are one per symbol. */
export function isLogoMiss(url: string): boolean {
  if (state.get(url) === 'miss') return true
  const exp = loadMisses()[url]
  if (exp && exp > Date.now()) {
    state.set(url, 'miss')
    return true
  }
  return false
}

export function isLogoOk(url: string): boolean {
  return state.get(url) === 'ok'
}

export function markLogoOk(url: string) {
  state.set(url, 'ok')
}

export function markLogoMiss(url: string) {
  state.set(url, 'miss')
  loadMisses()[url] = Date.now() + LOGO_MISS_TTL_MS
  persistMisses()
}

// ── concurrency limiter ──────────────────────────────────────────────────────

let active = 0
const waiting: Array<() => boolean> = []

/**
 * Ask for a load slot. `onGrant` runs once a slot is free (synchronously if one is free
 * now). Returns a `release` function: call it when the image settles or the component
 * unmounts. Releasing before the grant just leaves the queue.
 */
export function acquireLogoSlot(onGrant: () => void): () => void {
  let granted = false
  let done = false
  const grant = (): boolean => {
    if (done) return false
    granted = true
    active++
    onGrant()
    return true
  }
  if (active < LOGO_MAX_CONCURRENT) grant()
  else waiting.push(grant)
  return () => {
    if (done) return
    done = true
    if (granted) {
      active = Math.max(0, active - 1)
      while (waiting.length && active < LOGO_MAX_CONCURRENT) {
        const next = waiting.shift()!
        if (next()) break
      }
    } else {
      const i = waiting.indexOf(grant)
      if (i >= 0) waiting.splice(i, 1)
    }
  }
}

/** Test helper. */
export function __resetLogoCache() {
  state.clear()
  missExpiry = null
  active = 0
  waiting.length = 0
}

export function __logoSlotStats() {
  return { active, waiting: waiting.length }
}
