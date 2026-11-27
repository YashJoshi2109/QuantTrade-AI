'use client'

/**
 * Persistent UI state: what the user had open (chart settings, filters, a
 * draft, the running backtest's id) survives navigation, reloads and closing
 * the tab.
 *
 * - Keys are scoped per user (`qt:u<id>:...`, or `qt:anon:...` signed out),
 *   so a different login on the same browser never sees another user's state.
 * - Values are stored in a versioned envelope `{ v, t, d }`. A version bump
 *   drops (or migrates) old data instead of feeding the page a stale shape.
 * - Every storage access is wrapped in try/catch (private mode, quota, blocked
 *   site data) and every parse is defensive: a corrupt value means "default".
 * - SSR-safe: nothing touches `window` during render on the server or during
 *   hydration, so server and client markup match. After hydration (client-side
 *   navigation) the value is read synchronously in the state initialiser, so
 *   the page renders restored state on its first frame. On a hard load it is
 *   restored in a layout effect, before the browser paints.
 * - Writes are debounced and flushed on `pagehide` / unmount.
 * - Instances sharing a key (the desktop and mobile trees are both mounted)
 *   stay in sync in-process.
 *
 * Use it for per-device view state. Anything that must follow the user across
 * devices (backtest jobs and results) lives on the server.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

const PREFIX = 'qt'
const USER_HINT_KEY = 'auth_user'

// ── Scope (which user's state) ───────────────────────────────────────────────

let scopeOverride: string | null | undefined
const scopeListeners = new Set<() => void>()

function hintedScope(): string {
  if (typeof window === 'undefined') return 'anon'
  try {
    const raw = window.localStorage.getItem(USER_HINT_KEY)
    if (!raw) return 'anon'
    const id = (JSON.parse(raw) as { id?: unknown })?.id
    return typeof id === 'number' || (typeof id === 'string' && id) ? `u${id}` : 'anon'
  } catch {
    return 'anon'
  }
}

/** Current user scope, e.g. "u42" or "anon". */
export function getPersistScope(): string {
  return scopeOverride !== undefined && scopeOverride !== null ? scopeOverride : hintedScope()
}

/**
 * Called by the auth provider once the session is known. `undefined` while
 * loading keeps the synchronous hint from the last login.
 */
export function setPersistUser(userId: number | string | null | undefined): void {
  const next = userId === undefined ? undefined : userId === null ? 'anon' : `u${userId}`
  if (next === scopeOverride) return
  const before = getPersistScope()
  scopeOverride = next
  if (getPersistScope() !== before) scopeListeners.forEach((l) => l())
}

function subscribeScope(cb: () => void) {
  scopeListeners.add(cb)
  return () => {
    scopeListeners.delete(cb)
  }
}

export function usePersistScope(): string {
  return useSyncExternalStore(subscribeScope, getPersistScope, () => 'anon')
}

// ── Low-level storage ────────────────────────────────────────────────────────

export type PersistScope = 'user' | 'global'
export type PersistStorage = 'local' | 'session'

export interface PersistOptions<T> {
  /** Schema version. Bump it when the stored shape changes. Default 1. */
  version?: number
  /** 'user' (default) keys per signed-in user; 'global' shares across users. */
  scope?: PersistScope
  /** 'local' (default) survives closing the tab; 'session' does not. */
  storage?: PersistStorage
  /** Reject or repair a parsed value. Return undefined to fall back to the default. */
  validate?: (value: unknown) => T | undefined
  /** Upgrade data written by an older version. Return undefined to drop it. */
  migrate?: (value: unknown, fromVersion: number) => T | undefined
  /** Ignore values older than this. */
  maxAgeMs?: number
  /** Write debounce. Default 250 ms. */
  debounceMs?: number
}

interface Envelope {
  v: number
  t: number
  d: unknown
}

function store(kind: PersistStorage = 'local'): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

export function persistKey(key: string, opts: Pick<PersistOptions<unknown>, 'scope'> = {}, scope?: string): string {
  const s = opts.scope === 'global' ? 'g' : scope ?? getPersistScope()
  return `${PREFIX}:${s}:${key}`
}

/** Parse a stored envelope. Never throws. */
export function decodePersisted<T>(raw: string | null, opts: PersistOptions<T> = {}, now = Date.now()): T | undefined {
  if (raw == null) return undefined
  let env: Envelope
  try {
    env = JSON.parse(raw) as Envelope
  } catch {
    return undefined
  }
  if (!env || typeof env !== 'object' || typeof env.v !== 'number' || !('d' in env)) return undefined
  if (opts.maxAgeMs != null && typeof env.t === 'number' && now - env.t > opts.maxAgeMs) return undefined
  const version = opts.version ?? 1
  let value: unknown = env.d
  try {
    if (env.v !== version) {
      if (!opts.migrate) return undefined
      value = opts.migrate(env.d, env.v)
      if (value === undefined) return undefined
    }
    return opts.validate ? opts.validate(value) : (value as T)
  } catch {
    return undefined
  }
}

export function readPersisted<T>(key: string, opts: PersistOptions<T> = {}, scope?: string): T | undefined {
  const s = store(opts.storage)
  if (!s) return undefined
  try {
    return decodePersisted<T>(s.getItem(persistKey(key, opts, scope)), opts)
  } catch {
    return undefined
  }
}

/** Returns false when the value could not be stored (quota, blocked storage). */
export function writePersisted<T>(key: string, value: T, opts: PersistOptions<T> = {}, scope?: string): boolean {
  const s = store(opts.storage)
  if (!s) return false
  try {
    const env: Envelope = { v: opts.version ?? 1, t: Date.now(), d: value }
    s.setItem(persistKey(key, opts, scope), JSON.stringify(env))
    return true
  } catch {
    return false
  }
}

export function clearPersisted(key: string, opts: Pick<PersistOptions<unknown>, 'scope' | 'storage'> = {}, scope?: string): void {
  const s = store(opts.storage)
  if (!s) return
  try {
    s.removeItem(persistKey(key, opts, scope))
  } catch {
    /* storage unavailable */
  }
}

// ── In-process sync between instances sharing a key ─────────────────────────

type Listener = (value: unknown, source: symbol) => void
const keyListeners = new Map<string, Set<Listener>>()

function emit(fullKey: string, value: unknown, source: symbol) {
  keyListeners.get(fullKey)?.forEach((l) => l(value, source))
}

function listen(fullKey: string, l: Listener) {
  let set = keyListeners.get(fullKey)
  if (!set) keyListeners.set(fullKey, (set = new Set()))
  set.add(l)
  return () => {
    set!.delete(l)
    if (!set!.size) keyListeners.delete(fullKey)
  }
}

// ── Hydration tracking ───────────────────────────────────────────────────────

let hydrated = false
/** True once any persistent-state hook has committed on the client. */
export function isHydrated(): boolean {
  return hydrated
}
/** Test helper. */
export function __resetPersistentStateForTests(): void {
  hydrated = false
  scopeOverride = undefined
  keyListeners.clear()
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const noopSubscribe = () => () => {}
const clientSnapshot = () => false
const serverSnapshot = () => true

// ── The hook ─────────────────────────────────────────────────────────────────

export interface PersistControls {
  /** Restore the default and forget the stored value. */
  reset: () => void
  /** True once the stored value (if any) has been applied. */
  restored: boolean
}

type SetValue<T> = (next: T | ((prev: T) => T)) => void

/**
 * `useState` that survives navigation and reloads.
 *
 *   const [period, setPeriod, { reset }] = usePersistentState('research.period', '1Y', { version: 1 })
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  opts: PersistOptions<T> = {},
): [T, SetValue<T>, PersistControls] {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const defaultRef = useRef(defaultValue)
  defaultRef.current = defaultValue

  const scope = usePersistScope()
  const fullKey = persistKey(key, opts, scope)
  const id = useRef(Symbol(key)).current

  // True only while THIS component is hydrating server HTML. The old global
  // `hydrated` flag flipped as soon as any hook committed, so a subtree that
  // hydrates later (inside <Suspense>, e.g. MobileResearch) read the saved
  // value during hydration: "Hydration failed ... aria-selected" and a full
  // client re-render of the Research page.
  const isHydrating = useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot)

  // After hydration we can read synchronously: no default-then-restore frame.
  const [state, setState] = useState<{ key: string; value: T; restored: boolean }>(() => {
    if (!isHydrating && hydrated && typeof window !== 'undefined') {
      const saved = readPersisted<T>(key, opts, scope)
      return { key: fullKey, value: saved === undefined ? defaultValue : saved, restored: true }
    }
    return { key: '', value: defaultValue, restored: false }
  })

  const pending = useRef<{ key: string; value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const p = pending.current
    if (!p) return
    pending.current = null
    const o = optsRef.current
    const s = store(o.storage)
    if (!s) return
    try {
      s.setItem(p.key, JSON.stringify({ v: o.version ?? 1, t: Date.now(), d: p.value } satisfies Envelope))
    } catch {
      /* quota or blocked: keep the in-memory value */
    }
  }, [])

  // Restore (hard load) or re-read when the user scope changes. Runs before paint.
  useIsoLayoutEffect(() => {
    hydrated = true
    if (state.key === fullKey) return
    flush()
    const saved = readPersisted<T>(key, optsRef.current, scope)
    setState({ key: fullKey, value: saved === undefined ? defaultRef.current : saved, restored: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  useEffect(
    () =>
      listen(fullKey, (value, source) => {
        if (source !== id) setState((s) => (s.key === fullKey ? { ...s, value: value as T } : s))
      }),
    [fullKey, id],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const value = state.key === fullKey || !state.restored ? state.value : defaultValue
  const valueRef = useRef(value)
  valueRef.current = value

  const setValue = useCallback<SetValue<T>>(
    (next) => {
      const prev = valueRef.current
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      if (Object.is(v, prev)) return
      valueRef.current = v
      pending.current = { key: fullKey, value: v }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, optsRef.current.debounceMs ?? 250)
      setState({ key: fullKey, value: v, restored: true })
      emit(fullKey, v, id)
    },
    [flush, fullKey, id],
  )

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    const s = store(optsRef.current.storage)
    try {
      s?.removeItem(fullKey)
    } catch {
      /* storage unavailable */
    }
    valueRef.current = defaultRef.current
    setState({ key: fullKey, value: defaultRef.current, restored: true })
    emit(fullKey, defaultRef.current, id)
  }, [fullKey, id])

  return [value, setValue, { reset, restored: state.restored && state.key === fullKey }]
}

// ── Validators ───────────────────────────────────────────────────────────────

/** Accept only one of the allowed literals. */
export function oneOf<T extends string>(allowed: readonly T[]) {
  return (v: unknown): T | undefined => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined)
}

export function isBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

export function isStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** Keep the elements of an array that are allowed, dropping the rest. */
export function arrayOf<T extends string>(allowed: readonly T[]) {
  return (v: unknown): T[] | undefined =>
    Array.isArray(v) ? (v.filter((x) => typeof x === 'string' && (allowed as readonly string[]).includes(x)) as T[]) : undefined
}

/**
 * Restore every known field of a stored object over the defaults, keeping
 * defaults for missing or invalid fields.
 */
export function objectOf<T extends object>(defaults: T, fields: { [K in keyof T]?: (v: unknown) => T[K] | undefined }) {
  return (v: unknown): T | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
    const out = { ...defaults }
    for (const k of Object.keys(fields) as (keyof T)[]) {
      const parsed = fields[k]!((v as Record<string, unknown>)[k as string])
      if (parsed !== undefined) out[k] = parsed
    }
    return out
  }
}
