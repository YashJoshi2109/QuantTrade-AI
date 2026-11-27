import { describe, expect, it } from 'vitest'
import type { CitationData } from './copilot-engine'
import {
  answerTone,
  citationFreshness,
  citationTitle,
  classifyCopilotError,
  isRiskyQuestion,
  markUnverified,
  splitAnswer,
  stripDisclaimer,
  summarizeTrust,
  toPlainText,
} from './copilot-trust'

const NOW = Date.parse('2026-11-26T15:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const DAY = 86_400_000

const cite = (over: Partial<CitationData>): CitationData => ({ id: 'x', n: 1, kind: 'quote', source: 's', label: 'l', ...over })

describe('citationFreshness', () => {
  it('labels a recent quote by minutes and keeps it fresh', () => {
    const f = citationFreshness(cite({ kind: 'quote', as_of: ago(4 * MIN) }), NOW)
    expect(f.label).toBe('4 min ago')
    expect(f.stale).toBe(false)
  })

  it('flags a quote older than a day as stale with a reason', () => {
    const f = citationFreshness(cite({ kind: 'quote', as_of: ago(2 * DAY) }), NOW)
    expect(f.stale).toBe(true)
    expect(f.staleReason).toMatch(/more than a day/)
  })

  it('uses published_at for news and filed_date for statements', () => {
    expect(citationFreshness(cite({ kind: 'news', published_at: ago(8 * DAY), as_of: ago(MIN) }), NOW).stale).toBe(true)
    const st = citationFreshness(cite({ kind: 'statement', filed_date: '2026-11-22', as_of: '2026-10-26' }), NOW)
    expect(st.label).toBe('4 d ago')
    expect(st.stale).toBe(false)
  })

  it('shows a calendar date beyond a week and handles missing dates', () => {
    expect(citationFreshness(cite({ kind: 'filing', filed_date: '2026-02-20' }), NOW).label).toBe('Feb 20, 2026')
    const none = citationFreshness(cite({ kind: 'macro' }), NOW)
    expect(none.label).toBe('date not provided')
    expect(none.stale).toBe(false)
  })
})

describe('citationTitle', () => {
  it('names the source without repeating its date', () => {
    expect(citationTitle(cite({ kind: 'statement', ticker: 'NVDA', period: 'Q3 FY2026', filing_type: '10-Q' }))).toBe('NVDA Q3 FY2026 10-Q')
    expect(citationTitle(cite({ kind: 'filing', ticker: 'TSLA', filing_type: '10-K', fiscal_year: 2025, section: 'Risk Factors' }))).toBe('TSLA 10-K FY2025, Risk Factors')
    expect(citationTitle(cite({ kind: 'news', title: 'Headline', label: 'Reuters' }))).toBe('Headline')
    expect(citationTitle(cite({ kind: 'quote', label: 'NVDA quote' }))).toBe('NVDA quote')
  })
})

describe('summarizeTrust', () => {
  it('counts sources, stale sources and unverified numbers', () => {
    const t = summarizeTrust(
      [cite({ kind: 'quote', as_of: ago(5 * MIN) }), cite({ id: 'n', kind: 'news', published_at: ago(10 * DAY) }), cite({ id: 'f', kind: 'forecast', as_of: ago(DAY) })],
      { postcheck: { unverified_numbers: ['40%'] } },
      NOW,
    )
    expect(t.sourceCount).toBe(3)
    expect(t.staleCount).toBe(1)
    expect(t.unverifiedNumbers).toEqual(['40%'])
    expect(t.quoteAsOf?.toISOString()).toBe(ago(5 * MIN))
    expect(t.hasForecast).toBe(true)
    expect(t.unsourced).toBe(false)
  })

  it('handles no citations and no done event', () => {
    const t = summarizeTrust(undefined, null, NOW)
    expect(t.unsourced).toBe(true)
    expect(t.unverifiedNumbers).toEqual([])
  })
})

describe('risky questions and tone', () => {
  it.each([
    'Should I put my savings into NVDA calls?',
    'is it smart to go all-in on TSLA',
    'can I use my 401k to buy bitcoin',
    'I want to borrow money to buy options',
    'invest my emergency fund in AMD?',
    'yolo 0dte puts',
  ])('flags %s', (q) => expect(isRiskyQuestion(q)).toBe(true))

  it.each([
    'What did NVDA say on its earnings call?',
    'How is AAPL doing?',
    'Explain how put options work',
    'What are the risks in TSLA 10-K?',
  ])('does not flag %s', (q) => expect(isRiskyQuestion(q)).toBe(false))

  it('chooses supportive / info / normal tones', () => {
    expect(answerTone('put my savings into calls', null)).toBe('supportive')
    expect(answerTone('How is AAPL?', { refusal: null, postcheck: { policy_flags: ['personal_advice'] } })).toBe('supportive')
    expect(answerTone('what is the weather', { refusal: 'off_topic', postcheck: null })).toBe('info')
    expect(answerTone('How is AAPL?', { refusal: null, postcheck: { policy_flags: [] } })).toBe('normal')
  })
})

describe('classifyCopilotError', () => {
  it('maps the per-minute 429 to a short pause', () => {
    const n = classifyCopilotError(429, 'Too many AI requests. Please wait a minute and try again.', '60')
    expect(n.kind).toBe('per_minute')
    expect(n.retryAfterS).toBe(60)
  })

  it('maps other 429s to the daily allowance', () => {
    const n = classifyCopilotError(429, 'Daily AI token limit reached.', null)
    expect(n.kind).toBe('daily')
    expect(n.body).toMatch(/still in the box/)
  })

  it('maps the budget 503 to paused, and auth / length errors', () => {
    expect(classifyCopilotError(503, 'AI features are paused for today (budget reached).').kind).toBe('paused')
    expect(classifyCopilotError(401, '').kind).toBe('auth')
    expect(classifyCopilotError(413, 'Message too long (max 4000 characters).').body).toContain('4000')
    expect(classifyCopilotError(500, '').body).toContain('HTTP 500')
  })
})

describe('text shaping', () => {
  const ANSWER = `NVDA trades at $181 [quote:NVDA]. Revenue rose 62% [fs:NVDA:2026-Q3].

## What the numbers say
- **Growth:** data center demand is still the main driver of revenue and margins this year, by a wide margin.
- **Valuation:** about 51x trailing earnings, which prices in continued growth for several more years.

## Risks to watch
- Customer concentration: a few hyperscalers are roughly 40% (unverified) of revenue in the latest quarter.

*Informational only, not financial advice.*`

  it('strips the trailing disclaimer once', () => {
    const { body, hadDisclaimer } = stripDisclaimer(ANSWER)
    expect(hadDisclaimer).toBe(true)
    expect(body.endsWith('latest quarter.')).toBe(true)
    expect(stripDisclaimer('plain').hadDisclaimer).toBe(false)
  })

  it('splits a long answer into summary + collapsible sections', () => {
    const parts = splitAnswer(stripDisclaimer(ANSWER).body)
    expect(parts.summary).toMatch(/^NVDA trades/)
    expect(parts.summary).not.toContain('##')
    expect(parts.sectionTitles).toEqual(['What the numbers say', 'Risks to watch'])
  })

  it('keeps short answers whole', () => {
    const short = 'Intro.\n\n## Detail\nOne line.'
    expect(splitAnswer(short)).toEqual({ summary: short, details: '', sectionTitles: [] })
    expect(splitAnswer('## Starts with a heading\nbody').details).toBe('')
  })

  it('produces clean plain text for copying', () => {
    const t = toPlainText(ANSWER)
    expect(t).not.toMatch(/\[quote:|\[fs:|\*\*|##|financial advice/)
    expect(t).toContain('NVDA trades at $181.')
    expect(t).toContain('Growth: data center')
  })

  it('turns (unverified) tags into styled links', () => {
    expect(markUnverified('roughly 40% (unverified) of')).toBe('roughly 40% [unverified](#unverified) of')
  })
})
