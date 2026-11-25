/**
 * One shared `/api/v1/ws/news` connection per page, ref-counted across every
 * `useNewsFeed` instance. Reconnects with capped exponential backoff + jitter.
 */
import { newsSocketUrl, normalizeFeedResponse, type NewsFeedItem } from '@/lib/newsFeed'

export type NewsSocketStatus = 'idle' | 'connecting' | 'open' | 'closed'

type ItemListener = (item: NewsFeedItem) => void
type StatusListener = (status: NewsSocketStatus) => void

const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 60_000

let ws: WebSocket | null = null
let status: NewsSocketStatus = 'idle'
let attempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let lastMessageAt: number | null = null
const itemListeners = new Set<ItemListener>()
const statusListeners = new Set<StatusListener>()

function setStatus(next: NewsSocketStatus) {
  if (status === next) return
  status = next
  statusListeners.forEach((l) => l(next))
}

export function reconnectDelay(attempt: number, rand: () => number = Math.random): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt))
  return Math.round(exp * (0.75 + rand() * 0.5))
}

function parseMessage(data: unknown): NewsFeedItem | null {
  if (typeof data !== 'string') return null
  try {
    const msg = JSON.parse(data) as { type?: string; item?: unknown }
    if (msg?.type !== 'news' || !msg.item) return null
    const [item] = normalizeFeedResponse({ items: [msg.item] }).items
    return item?.cluster_id ? item : null
  } catch {
    return null
  }
}

function scheduleReconnect() {
  if (reconnectTimer || itemListeners.size === 0) return
  const delay = reconnectDelay(attempts)
  attempts += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

function connect() {
  if (ws || itemListeners.size === 0 || typeof WebSocket === 'undefined') return
  const url = newsSocketUrl()
  if (!url) return
  setStatus('connecting')
  let sock: WebSocket
  try {
    sock = new WebSocket(url)
  } catch {
    setStatus('closed')
    scheduleReconnect()
    return
  }
  ws = sock
  sock.onopen = () => {
    attempts = 0
    setStatus('open')
  }
  sock.onmessage = (ev: MessageEvent) => {
    const item = parseMessage(ev.data)
    if (!item) return
    lastMessageAt = Date.now()
    itemListeners.forEach((l) => l(item))
  }
  sock.onerror = () => {
    // onclose follows; reconnect handled there
  }
  sock.onclose = () => {
    if (ws === sock) ws = null
    setStatus('closed')
    scheduleReconnect()
  }
}

function teardown() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  const sock = ws
  ws = null
  attempts = 0
  if (sock) {
    sock.onclose = null
    sock.onmessage = null
    sock.onerror = null
    sock.onopen = null
    try {
      sock.close()
    } catch {
      /* noop */
    }
  }
  setStatus('idle')
}

/** Subscribe to pushed items. Returns an unsubscribe fn; last unsubscribe closes the socket. */
export function subscribeNewsSocket(onItem: ItemListener, onStatus?: StatusListener): () => void {
  itemListeners.add(onItem)
  if (onStatus) {
    statusListeners.add(onStatus)
    onStatus(status)
  }
  connect()
  return () => {
    itemListeners.delete(onItem)
    if (onStatus) statusListeners.delete(onStatus)
    if (itemListeners.size === 0) teardown()
  }
}

export function getNewsSocketStatus(): NewsSocketStatus {
  return status
}

export function getNewsSocketLastMessageAt(): number | null {
  return lastMessageAt
}

/** Test-only: hard reset of module state. */
export function __resetNewsSocketForTests() {
  itemListeners.clear()
  statusListeners.clear()
  teardown()
  lastMessageAt = null
}
