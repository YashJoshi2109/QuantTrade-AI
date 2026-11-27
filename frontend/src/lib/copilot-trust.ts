/**
 * Trust and presentation helpers for copilot answers (desktop + mobile).
 *
 * - citation freshness ("4 min ago", stale flags) so every source shows its age
 * - a per-answer trust summary built from the backend `done` event
 * - risky-request detection, so a refusal reads as support, not as an error
 * - HTTP error classification, so 429/503 become a calm inline notice
 * - progressive disclosure: a short answer first, the detail behind a toggle
 */
import type { CitationData, CopilotDone } from './copilot-engine'
import { CITATION_RE } from './copilot-handoff'

// ─── Freshness ───────────────────────────────────────────────────────────────

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** How old a source may get before we flag it, per kind. */
export const STALE_AFTER_MS: Record<string, number> = {
  quote: DAY,          // a quote older than a trading day is not "today's price"
  technicals: 3 * DAY,
  movers: DAY,
  news: 7 * DAY,
  forecast: 3 * DAY,
  fundamentals: 30 * DAY,
  macro: 60 * DAY,
  statement: 200 * DAY, // more than two quarters without a new filing
  filing: 400 * DAY,
}

export interface Freshness {
  /** Date the source describes or was published ("as of"). */
  asOf: Date | null
  /** "4 min ago", "3 h ago", "Nov 19, 2026". */
  label: string
  stale: boolean
  /** Plain-language reason, shown when stale. */
  staleReason: string | null
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatAge(d: Date, now: number): string {
  const ms = now - d.getTime()
  if (ms < MIN) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)} d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** The date a citation speaks for: publication for news, filing for filings, else as_of. */
export function citationDate(c: Pick<CitationData, 'kind' | 'as_of' | 'published_at' | 'filed_date'>): Date | null {
  if (c.kind === 'news') return toDate(c.published_at ?? c.as_of)
  if (c.kind === 'filing' || c.kind === 'statement') return toDate(c.filed_date ?? c.as_of)
  return toDate(c.as_of)
}

export function citationFreshness(
  c: Pick<CitationData, 'kind' | 'as_of' | 'published_at' | 'filed_date'>,
  now: number = Date.now(),
): Freshness {
  const asOf = citationDate(c)
  if (!asOf) return { asOf: null, label: 'date not provided', stale: false, staleReason: null }
  const limit = STALE_AFTER_MS[c.kind] ?? 30 * DAY
  const age = now - asOf.getTime()
  const stale = age > limit
  let staleReason: string | null = null
  if (stale) {
    staleReason = c.kind === 'quote'
      ? 'Price is more than a day old'
      : c.kind === 'news'
        ? 'News is more than a week old'
        : c.kind === 'forecast'
          ? 'Forecast was made several days ago'
          : 'Newer data may exist'
  }
  return { asOf, label: formatAge(asOf, now), stale, staleReason }
}

/** Ledger title without a date (the freshness line carries the date). */
export function citationTitle(c: Pick<CitationData, 'kind' | 'label' | 'title' | 'period' | 'filing_type' | 'fiscal_year' | 'section' | 'ticker'>): string {
  switch (c.kind) {
    case 'news':
      return c.title || c.label
    case 'statement':
      return [c.ticker, c.period, c.filing_type].filter(Boolean).join(' ') || c.label
    case 'filing':
      return [[c.ticker, c.filing_type, c.fiscal_year ? `FY${c.fiscal_year}` : null].filter(Boolean).join(' '), c.section].filter(Boolean).join(', ') || c.label
    default:
      return c.label
  }
}

// ─── Trust summary ───────────────────────────────────────────────────────────

export interface TrustSummary {
  sourceCount: number
  staleCount: number
  unverifiedNumbers: string[]
  /** "Quote as of 9:18 AM" when the answer used a live quote. */
  quoteAsOf: Date | null
  hasForecast: boolean
  /** Answer gave no sources at all (refusals, general explanations). */
  unsourced: boolean
}

export function summarizeTrust(
  citations: CitationData[] | undefined,
  done: Pick<CopilotDone, 'postcheck'> | null | undefined,
  now: number = Date.now(),
): TrustSummary {
  const cs = citations ?? []
  const quote = cs.find((c) => c.kind === 'quote')
  return {
    sourceCount: cs.length,
    staleCount: cs.filter((c) => citationFreshness(c, now).stale).length,
    unverifiedNumbers: [...(done?.postcheck?.unverified_numbers ?? [])],
    quoteAsOf: quote ? citationDate(quote) : null,
    hasForecast: cs.some((c) => c.kind === 'forecast'),
    unsourced: cs.length === 0,
  }
}

// ─── Tone: risky requests and refusals ───────────────────────────────────────

const RISKY_RE = new RegExp(
  [
    String.raw`\b(life|my|our|all (?:of )?(?:my|our))\s+savings\b`,
    String.raw`\bemergency fund\b`,
    String.raw`\bretirement (?:money|savings|fund|account)\b`,
    String.raw`\b401\(?k\)?\b`,
    String.raw`\bmortgage\b`,
    String.raw`\b(?:borrow|loan|credit card)\b.*\b(?:invest|buy|stock|options?|calls?|puts?)\b`,
    String.raw`\b(?:on|use|using) margin\b`,
    String.raw`\b(?:go|going|went) all[- ]in\b`,
    String.raw`\byolo\b`,
    String.raw`\bguarantee(?:d)?\b.*\b(?:return|profit|money)\b`,
    String.raw`\b(?:put|invest|throw|dump|bet)\s+(?:my|our|all|everything|\$\s?\d|\d)[^.?!]*\b(?:calls|puts|options|0dte)\b`,
    String.raw`\bdouble my money\b`,
  ].join('|'),
  'i',
)

/** A question that risks real money in a way we should slow down on. */
export function isRiskyQuestion(q: string | null | undefined): boolean {
  return !!q && RISKY_RE.test(q)
}

export type AnswerTone = 'normal' | 'supportive' | 'info'

/**
 * - supportive: the user asked something financially risky, or the post-check
 *   removed advice language. Style it as a calm, educational card.
 * - info: a canned reply (off-topic, unknown ticker, no data). Neutral card.
 */
export function answerTone(
  question: string | null | undefined,
  done: Pick<CopilotDone, 'refusal' | 'postcheck'> | null | undefined,
): AnswerTone {
  if (isRiskyQuestion(question) || (done?.postcheck?.policy_flags?.length ?? 0) > 0) return 'supportive'
  if (done?.refusal) return 'info'
  return 'normal'
}

// ─── HTTP errors (429 / 503 / 401 …) ─────────────────────────────────────────

export type LimitKind = 'per_minute' | 'daily' | 'paused' | 'auth' | 'too_long' | 'other'

export interface CopilotLimitNotice {
  kind: LimitKind
  title: string
  body: string
  /** Seconds until asking again makes sense (per_minute / Retry-After). */
  retryAfterS: number | null
}

export function classifyCopilotError(
  status: number,
  detail: string | null | undefined,
  retryAfter?: string | number | null,
): CopilotLimitNotice {
  const d = (detail || '').trim()
  const ra = retryAfter == null || retryAfter === '' ? null : Number(retryAfter)
  const retryAfterS = ra != null && Number.isFinite(ra) && ra > 0 ? ra : null
  if (status === 401) {
    return { kind: 'auth', title: 'Sign in to keep asking', body: 'Your session ended. Sign in again and your question will still be here.', retryAfterS: null }
  }
  if (status === 403) {
    return { kind: 'auth', title: 'Verify your email to use Copilot', body: d || 'Check your inbox for the verification link.', retryAfterS: null }
  }
  if (status === 413) {
    return { kind: 'too_long', title: 'That question is too long', body: d || 'Shorten it a little and send it again.', retryAfterS: null }
  }
  if (status === 503 && /paused|budget/i.test(d)) {
    return { kind: 'paused', title: 'AI answers are paused for today', body: 'The service-wide AI budget is used up. Market data, research pages and your history still work.', retryAfterS: null }
  }
  if (status === 429) {
    if (/minute|slow down|burst/i.test(d) || (retryAfterS != null && retryAfterS <= 120)) {
      return { kind: 'per_minute', title: 'A short pause before the next question', body: 'You asked several questions in a row. You can ask again in about a minute.', retryAfterS: retryAfterS ?? 60 }
    }
    return { kind: 'daily', title: "You've used today's AI allowance", body: 'Your question is still in the box below, so you can send it when your allowance resets.', retryAfterS }
  }
  return { kind: 'other', title: 'Copilot could not answer', body: d || `The request failed (HTTP ${status}). Try again in a moment.`, retryAfterS: null }
}

// ─── Text shaping ────────────────────────────────────────────────────────────

const DISCLAIMER_RE = /\n*\s*[*_]\s*Informational only,? not financial advice\.?\s*[*_]\s*$/i

/** Remove the backend's trailing disclaimer; the UI shows it once, quietly. */
export function stripDisclaimer(text: string): { body: string; hadDisclaimer: boolean } {
  const body = text.replace(DISCLAIMER_RE, '')
  return { body: body.trimEnd(), hadDisclaimer: body.length !== text.length }
}

/** Plain text for copying: no `[quote:AAPL]` markers, no markdown emphasis. */
export function toPlainText(text: string): string {
  return stripDisclaimer(text).body
    .replace(new RegExp(CITATION_RE.source, 'g'), '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$|[.,;:])/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export interface AnswerParts {
  /** The short answer (everything before the first `##` section). */
  summary: string
  /** Remaining sections, collapsed by default. Empty when the answer is short. */
  details: string
  /** Section titles inside `details`, used as a preview on the toggle. */
  sectionTitles: string[]
}

/** Answers shorter than this are shown whole. */
export const DISCLOSURE_MIN_DETAIL_CHARS = 280

export function splitAnswer(text: string): AnswerParts {
  const m = /^##\s+/m.exec(text)
  if (!m || m.index === 0) return { summary: text, details: '', sectionTitles: [] }
  const summary = text.slice(0, m.index).trimEnd()
  const details = text.slice(m.index)
  if (!summary.trim() || details.length < DISCLOSURE_MIN_DETAIL_CHARS) return { summary: text, details: '', sectionTitles: [] }
  const sectionTitles = Array.from(details.matchAll(/^##\s+(.+)$/gm)).map((x) => x[1].trim())
  return { summary, details, sectionTitles }
}

/** Mark postcheck's "(unverified)" tags as links so the renderer can style them. */
export function markUnverified(text: string): string {
  return text.replace(/\s\(unverified\)/g, ' [unverified](#unverified)')
}
