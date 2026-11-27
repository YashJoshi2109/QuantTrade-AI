import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOKENS_PER_QUESTION,
  computeUsageMeter,
  formatResetsIn,
  normalizeUsage,
  tokensPerQuestion,
} from './copilot-usage'

// The prod payload that motivated this: 15 requests left, token budget spent.
const PROD_ME = {
  tier: 'free', paused: false, paused_message: null,
  requests_used: 5, requests_limit: 20, requests_remaining: 15,
  tokens_used: 50000, tokens_limit: 50000, tokens_remaining: 0,
  resets_in_seconds: 8 * 3600 + 49 * 60,
}

describe('normalizeUsage', () => {
  it('returns null when nothing was fetched', () => {
    expect(normalizeUsage(null, null)).toBeNull()
  })

  it('prefers /me/ai-usage and falls back to the legacy shape', () => {
    const u = normalizeUsage({ requests_remaining: 3 }, { free_limit: 20, free_remaining: 9, today_requests: 11, is_pro: false } as never)
    expect(u?.requestsRemaining).toBe(3)
    expect(u?.requestsLimit).toBe(20)
    expect(u?.requestsUsed).toBe(11)
  })

  it('reads numbers defensively (strings, null, NaN, negatives)', () => {
    const u = normalizeUsage({ requests_limit: '20' as never, requests_used: 4, tokens_limit: NaN, tokens_remaining: -5 }, null)
    expect(u?.requestsLimit).toBe(20)
    expect(u?.requestsRemaining).toBe(16) // derived from limit - used
    expect(u?.tokensLimit).toBeNull()
    expect(u?.tokensRemaining).toBe(0)
  })

  it('derives tokens used from legacy input + output counts', () => {
    const u = normalizeUsage(null, { today_input_tokens: 1000, today_output_tokens: 500, tokens_limit: 10000 } as never)
    expect(u?.tokensUsed).toBe(1500)
    expect(u?.tokensRemaining).toBe(8500)
  })

  it('treats admin and pro tiers as pro', () => {
    expect(normalizeUsage({ tier: 'admin' }, null)?.isPro).toBe(true)
    expect(normalizeUsage(null, { is_pro: true } as never)?.isPro).toBe(true)
  })
})

describe('computeUsageMeter', () => {
  it('shows the binding token limit, not the request count (prod bug)', () => {
    const m = computeUsageMeter(normalizeUsage(PROD_ME, null))
    expect(m.state).toBe('exhausted')
    expect(m.binding).toBe('tokens')
    expect(m.questionsLeft).toBe(0)
    expect(m.headline).toBe('Daily AI limit reached')
    expect(m.detail).toContain('15 requests remain')
    expect(m.detail).toContain('resets in 8h 49m')
  })

  it('estimates questions left from tokens using today\'s average', () => {
    // 5 questions used 25k tokens -> 5k per question; 12k left -> 2 questions.
    const m = computeUsageMeter(normalizeUsage({ ...PROD_ME, tokens_used: 25000, tokens_remaining: 12000 }, null))
    expect(m.binding).toBe('tokens')
    expect(m.questionsLeft).toBe(2)
    expect(m.estimated).toBe(true)
    expect(m.state).toBe('low')
    expect(m.headline).toBe('About 2 questions left today')
  })

  it('uses the request cap when it is the smaller one', () => {
    const m = computeUsageMeter(normalizeUsage({ ...PROD_ME, requests_remaining: 4, tokens_used: 1000, tokens_remaining: 49000 }, null))
    expect(m.binding).toBe('requests')
    expect(m.questionsLeft).toBe(4)
    expect(m.estimated).toBe(false)
    expect(m.headline).toBe('4 questions left today')
    expect(m.fractionLeft).toBeCloseTo(4 / 20)
  })

  it('warns but does not block when less than one typical answer is left', () => {
    const m = computeUsageMeter(normalizeUsage({ ...PROD_ME, tokens_used: 25000, tokens_remaining: 2000 }, null))
    expect(m.state).toBe('low')
    expect(m.questionsLeft).toBe(0)
    expect(m.headline).toBe('Allowance almost used up')
  })

  it('says "1 question" in the singular', () => {
    const m = computeUsageMeter(normalizeUsage({ requests_limit: 20, requests_remaining: 1 }, null))
    expect(m.headline).toBe('1 question left today')
  })

  it('reports request exhaustion with the limit', () => {
    const m = computeUsageMeter(normalizeUsage({ requests_limit: 20, requests_remaining: 0, resets_in_seconds: 600 }, null))
    expect(m.state).toBe('exhausted')
    expect(m.binding).toBe('requests')
    expect(m.detail).toContain('all 20 questions')
    expect(m.detail).toContain('resets in 10m')
  })

  it('handles the global pause first', () => {
    const m = computeUsageMeter(normalizeUsage({ ...PROD_ME, paused: true, paused_message: 'AI features are paused for today (budget reached).' }, null))
    expect(m.state).toBe('paused')
    expect(m.questionsLeft).toBe(0)
  })

  it('is unlimited when no cap is reported, and unknown without data', () => {
    expect(computeUsageMeter(normalizeUsage({ tier: 'admin' }, null)).headline).toBe('Unlimited questions today')
    expect(computeUsageMeter(null).state).toBe('unknown')
  })
})

describe('tokensPerQuestion / formatResetsIn', () => {
  it('clamps the per-question average and defaults without history', () => {
    expect(tokensPerQuestion({ tokensUsed: null, requestsUsed: null })).toBe(DEFAULT_TOKENS_PER_QUESTION)
    expect(tokensPerQuestion({ tokensUsed: 100, requestsUsed: 1 })).toBe(1500)
    expect(tokensPerQuestion({ tokensUsed: 1_000_000, requestsUsed: 1 })).toBe(30000)
  })

  it('formats reset times', () => {
    expect(formatResetsIn(8 * 3600 + 49 * 60)).toBe('resets in 8h 49m')
    expect(formatResetsIn(7200)).toBe('resets in 2h')
    expect(formatResetsIn(30)).toBe('resets in under a minute')
    expect(formatResetsIn(null)).toBe('resets at midnight UTC')
  })
})
