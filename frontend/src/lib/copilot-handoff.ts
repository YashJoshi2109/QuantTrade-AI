/**
 * Research → Copilot handoff + citation helpers, shared by the desktop and
 * mobile Research views and both copilot layouts.
 */
import type { CitationData, TickerContext } from './copilot-engine'

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-/]{0,11}$/

/** Normalise a ticker the way the backend resolver does: `$brk-b` → `BRK.B`. */
export function normalizeSymbol(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim().replace(/^\$/, '').toUpperCase().replace(/[-/](?=[A-Z]{1,2}$)/, '.')
  return SYMBOL_RE.test(s) ? s : null
}

/** `/copilot?symbol=NVDA` (+ optional `&q=` prefilled question). */
export function buildCopilotHref(symbol: string, question?: string): string {
  const params = new URLSearchParams({ symbol: normalizeSymbol(symbol) ?? symbol.toUpperCase() })
  if (question && question.trim()) params.set('q', question.trim().slice(0, 500))
  return `/copilot?${params.toString()}`
}

/** Read `symbol` / `q` from a query string (`window.location.search`). */
export function parseCopilotParams(search: string): { symbol: string | null; q: string | null } {
  const p = new URLSearchParams(search)
  const q = p.get('q')
  return { symbol: normalizeSymbol(p.get('symbol')), q: q && q.trim() ? q.trim().slice(0, 500) : null }
}

/** Ticker-specific starter questions; adapts to what the context pack has. */
export function suggestedQuestions(ctx: Pick<TickerContext, 'ticker' | 'asset_type' | 'forecast' | 'news' | 'latest_statement' | 'identity'> | null, symbol?: string | null): string[] {
  const t = ctx?.ticker ?? symbol
  if (!t) return []
  if (ctx?.identity?.status === 'changed' || ctx?.identity?.status === 'mismatch') {
    return [`What happened to ${t}?`, ctx.identity.successor_symbol ? `Analyze ${ctx.identity.successor_symbol}` : `Is ${t} still the same company?`]
  }
  if (ctx && ctx.asset_type !== 'equity') {
    return [`How is ${t} doing today?`, `What's the forecast range for ${t} over the next month?`, `What news is moving ${t}?`]
  }
  const qs = [
    `What were ${t}'s revenue and margins last quarter?`,
    `What are the biggest risks in ${t}'s latest 10-K?`,
  ]
  if (!ctx || ctx.forecast) qs.push(`What's the forecast range for ${t} over the next month?`)
  if (!ctx || ctx.news.length) qs.push(`What news moved ${t} this week?`)
  qs.push(`Is ${t} expensive versus peers?`)
  return qs.slice(0, 4)
}

// ─── Citations ───────────────────────────────────────────────────────────────

/** `[quote:AAPL]`, `[fs:BRK.B:2026-Q3, news:12]` — same grammar as the backend post-check. */
export const CITATION_RE = /\[((?:[a-z]+:[^[\]\s,;]+)(?:\s*[,;]\s*[a-z]+:[^[\]\s,;]+)*)\]/g

export function citationIds(text: string): string[] {
  const out: string[] = []
  const re = new RegExp(CITATION_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    for (const id of m[1].split(/[,;]/).map((x: string) => x.trim()).filter(Boolean)) {
      if (!out.includes(id)) out.push(id)
    }
  }
  return out
}

/**
 * Rewrite `[id]` markers into markdown links `[n](#cite:<id>)` numbered by first
 * appearance, so ReactMarkdown can render them as clickable chips.  Markers for
 * ids the server did not confirm (once citations are known) are dropped.
 */
export function linkifyCitations(text: string, known?: CitationData[] | null): string {
  const order = citationIds(text)
  const allowed = known && known.length ? new Set(known.map((c) => c.id)) : null
  const numberOf = (id: string) => {
    const k = known?.find((c) => c.id === id)
    return k?.n ?? order.indexOf(id) + 1
  }
  return text.replace(CITATION_RE, (_m, group: string) =>
    group
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter((id) => id && (!allowed || allowed.has(id)))
      .map((id) => `[${numberOf(id)}](#cite:${encodeURIComponent(id)})`)
      .join(''),
  )
}

export function citationIdFromHref(href: string | undefined): string | null {
  if (!href || !href.startsWith('#cite:')) return null
  try {
    return decodeURIComponent(href.slice(6))
  } catch {
    return null
  }
}

const KIND_LABEL: Record<string, string> = {
  quote: 'Quote', fundamentals: 'Key stats', statement: 'Financial statement', forecast: 'Forecast',
  technicals: 'Technicals', news: 'News', filing: 'SEC filing', macro: 'Macro (FRED)', movers: 'Market movers',
}

export function citationKindLabel(kind: string | undefined): string {
  return (kind && KIND_LABEL[kind]) || 'Source'
}

/** Short chip text: "AAPL 10-K · Risk Factors", "Q3 FY2026 (10-Q)", news title… */
export function citationChipText(c: CitationData): string {
  if (c.kind === 'filing') return `${c.ticker ?? ''} ${c.filing_type ?? ''} · ${c.section ?? 'filing'}`.trim()
  if (c.kind === 'news') return c.title ?? c.label
  return c.label
}

export function formatCompactNumber(v: number | null | undefined, prefix = ''): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}${prefix}${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(2)}M`
  return `${sign}${prefix}${a.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}
