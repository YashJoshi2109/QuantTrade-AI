/**
 * Copilot usage meter math, shared by the desktop and mobile copilot.
 *
 * The backend enforces two daily caps per user: a request count and a token
 * budget (the token budget may become cost-weighted; the maths here does not
 * care what a "token" costs, only how many are left).  Whichever runs out
 * first is the binding limit, so the meter must show that one.  Showing only
 * `requests_remaining` told users "15 left" while the token budget was already
 * spent and the next question failed with 429.
 *
 * Every field is read defensively: the usage endpoints are changing shape and
 * any of them may be missing, null or a string.
 */
import type { CopilotUsage } from './api'

/** `/api/v1/me/ai-usage` (ai_guard.usage_summary). All optional on purpose. */
export interface MyAiUsage {
  tier?: string | null
  paused?: boolean | null
  paused_message?: string | null
  requests_used?: number | null
  requests_limit?: number | null
  requests_remaining?: number | null
  tokens_used?: number | null
  tokens_limit?: number | null
  tokens_remaining?: number | null
  resets_in_seconds?: number | null
  [key: string]: unknown
}

/** One normalised view of whichever usage payloads we managed to fetch. */
export interface NormalizedUsage {
  tier: string | null
  isPro: boolean
  paused: boolean
  pausedMessage: string | null
  requestsUsed: number | null
  requestsLimit: number | null
  requestsRemaining: number | null
  tokensUsed: number | null
  tokensLimit: number | null
  tokensRemaining: number | null
  resetsInSeconds: number | null
}

export type UsageState = 'unknown' | 'ok' | 'low' | 'exhausted' | 'paused'

export interface UsageMeter {
  state: UsageState
  /** Which cap decides how many questions are left. */
  binding: 'requests' | 'tokens' | null
  /** Questions the user can still ask today (null when unknown / unlimited). */
  questionsLeft: number | null
  /** True when questionsLeft is an estimate from the token budget. */
  estimated: boolean
  /** 0..1 share of today's binding allowance still available (for a bar). */
  fractionLeft: number | null
  resetsInSeconds: number | null
  /** "15 questions left today", "About 3 questions left today", "Daily AI limit reached". */
  headline: string
  /** Short explanation for the popover / screen readers. */
  detail: string
}

/** Typical tokens one copilot answer uses when we have no history to average. */
export const DEFAULT_TOKENS_PER_QUESTION = 6000
const MIN_TOKENS_PER_QUESTION = 1500
const MAX_TOKENS_PER_QUESTION = 30000
/** At or below this many questions the meter switches to the "low" state. */
export const LOW_QUESTIONS_THRESHOLD = 3

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function nonNeg(v: unknown): number | null {
  const n = num(v)
  return n == null ? null : Math.max(0, n)
}

/** Merge `/me/ai-usage` (preferred) with the legacy `/copilot/usage` shape. */
export function normalizeUsage(
  me: MyAiUsage | null | undefined,
  legacy: Partial<CopilotUsage> | null | undefined,
): NormalizedUsage | null {
  if (!me && !legacy) return null
  const m = me ?? {}
  const l = (legacy ?? {}) as Partial<CopilotUsage> & Record<string, unknown>
  const pick = (...vals: unknown[]) => {
    for (const v of vals) {
      const n = nonNeg(v)
      if (n != null) return n
    }
    return null
  }
  const tier = (typeof m.tier === 'string' && m.tier) || (typeof l.tier === 'string' && l.tier) || null
  const requestsLimit = pick(m.requests_limit, l.free_limit)
  let requestsRemaining = pick(m.requests_remaining, l.free_remaining)
  const requestsUsed = pick(m.requests_used, l.today_requests)
  if (requestsRemaining == null && requestsLimit != null && requestsUsed != null) {
    requestsRemaining = Math.max(0, requestsLimit - requestsUsed)
  }
  const tokensLimit = pick(m.tokens_limit, l.tokens_limit)
  let tokensRemaining = pick(m.tokens_remaining, l.tokens_remaining)
  const tokensUsed = pick(
    m.tokens_used,
    num(l.today_input_tokens) != null || num(l.today_output_tokens) != null
      ? (num(l.today_input_tokens) ?? 0) + (num(l.today_output_tokens) ?? 0)
      : null,
  )
  if (tokensRemaining == null && tokensLimit != null && tokensUsed != null) {
    tokensRemaining = Math.max(0, tokensLimit - tokensUsed)
  }
  const paused = Boolean(m.paused ?? l.paused)
  return {
    tier,
    isPro: tier === 'pro' || tier === 'admin' || Boolean(l.is_pro),
    paused,
    pausedMessage: (m.paused_message as string | null | undefined) ?? (l.paused_message as string | null | undefined) ?? null,
    requestsUsed,
    requestsLimit,
    requestsRemaining,
    tokensUsed,
    tokensLimit,
    tokensRemaining,
    resetsInSeconds: pick(m.resets_in_seconds, (l as Record<string, unknown>).resets_in_seconds),
  }
}

/** Average tokens per question so far today, clamped; default when unknown. */
export function tokensPerQuestion(u: Pick<NormalizedUsage, 'tokensUsed' | 'requestsUsed'>): number {
  if (u.tokensUsed && u.requestsUsed && u.tokensUsed > 0 && u.requestsUsed > 0) {
    const avg = u.tokensUsed / u.requestsUsed
    return Math.min(MAX_TOKENS_PER_QUESTION, Math.max(MIN_TOKENS_PER_QUESTION, avg))
  }
  return DEFAULT_TOKENS_PER_QUESTION
}

/** "resets in 8h 49m", "resets in 12m", "resets in under a minute". */
export function formatResetsIn(seconds: number | null | undefined): string {
  const s = num(seconds)
  if (s == null) return 'resets at midnight UTC'
  if (s < 60) return 'resets in under a minute'
  const totalMin = Math.round(s / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `resets in ${m}m`
  if (m === 0) return `resets in ${h}h`
  return `resets in ${h}h ${m}m`
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** Turn usage into what the meter shows. The binding limit always wins. */
export function computeUsageMeter(u: NormalizedUsage | null | undefined): UsageMeter {
  if (!u) {
    return { state: 'unknown', binding: null, questionsLeft: null, estimated: false, fractionLeft: null,
      resetsInSeconds: null, headline: 'Checking your AI allowance', detail: '' }
  }
  const resets = formatResetsIn(u.resetsInSeconds)
  if (u.paused) {
    return { state: 'paused', binding: null, questionsLeft: 0, estimated: false, fractionLeft: 0,
      resetsInSeconds: u.resetsInSeconds, headline: 'AI answers paused for today',
      detail: `${u.pausedMessage || 'The service-wide AI budget for today is used up.'} It ${resets}.` }
  }

  const reqLimited = u.requestsLimit != null && u.requestsLimit > 0 && u.requestsRemaining != null
  const tokLimited = u.tokensLimit != null && u.tokensLimit > 0 && u.tokensRemaining != null
  const perQ = tokensPerQuestion(u)
  const fromRequests = reqLimited ? Math.floor(u.requestsRemaining as number) : null
  const fromTokens = tokLimited ? Math.floor((u.tokensRemaining as number) / perQ) : null

  let binding: UsageMeter['binding'] = null
  let left: number | null = null
  if (fromRequests != null && fromTokens != null) {
    binding = fromTokens < fromRequests ? 'tokens' : 'requests'
    left = Math.min(fromRequests, fromTokens)
  } else if (fromRequests != null) {
    binding = 'requests'
    left = fromRequests
  } else if (fromTokens != null) {
    binding = 'tokens'
    left = fromTokens
  }

  if (left == null) {
    return { state: 'ok', binding: null, questionsLeft: null, estimated: false, fractionLeft: null,
      resetsInSeconds: u.resetsInSeconds, headline: 'Unlimited questions today', detail: '' }
  }

  const estimated = binding === 'tokens'
  const fractionLeft = binding === 'tokens'
    ? Math.min(1, (u.tokensRemaining as number) / (u.tokensLimit as number))
    : Math.min(1, (u.requestsRemaining as number) / (u.requestsLimit as number))

  // Some budget left, but less than a typical answer: warn, do not block.
  if (left <= 0 && binding === 'tokens' && (u.tokensRemaining as number) > 0) {
    return { state: 'low', binding, questionsLeft: 0, estimated: true, fractionLeft, resetsInSeconds: u.resetsInSeconds,
      headline: 'Allowance almost used up',
      detail: `There may be enough left for one short question, but not a long answer. Your allowance ${resets}.` }
  }

  if (left <= 0) {
    const why = binding === 'tokens'
      ? `You have used today's AI reading budget${reqLimited ? `, even though ${u.requestsRemaining} ${plural(u.requestsRemaining as number, 'request', 'requests')} remain` : ''}. Long answers use more of it.`
      : `You have asked all ${u.requestsLimit} questions included today.`
    return { state: 'exhausted', binding, questionsLeft: 0, estimated, fractionLeft: 0,
      resetsInSeconds: u.resetsInSeconds, headline: 'Daily AI limit reached', detail: `${why} It ${resets}.` }
  }

  const headline = `${estimated ? 'About ' : ''}${left} ${plural(left, 'question', 'questions')} left today`
  const detail = estimated
    ? `Estimated from your remaining AI budget (about ${Math.round(perQ).toLocaleString('en-US')} tokens per answer). Your allowance ${resets}.`
    : `${u.requestsRemaining} of ${u.requestsLimit} daily questions left. Your allowance ${resets}.`
  return { state: left <= LOW_QUESTIONS_THRESHOLD ? 'low' : 'ok', binding, questionsLeft: left, estimated,
    fractionLeft, resetsInSeconds: u.resetsInSeconds, headline, detail }
}
