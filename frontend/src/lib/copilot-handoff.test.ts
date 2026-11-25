import { describe, expect, it } from 'vitest'
import {
  buildCopilotHref,
  citationIdFromHref,
  citationShortLabel,
  formatPercentPoints,
  citationIds,
  linkifyCitations,
  normalizeSymbol,
  parseCopilotParams,
  suggestedQuestions,
} from './copilot-handoff'
import type { CitationData } from './copilot-engine'

describe('copilot handoff', () => {
  it('normalises share classes and cashtags like the backend', () => {
    expect(normalizeSymbol('$brk-b')).toBe('BRK.B')
    expect(normalizeSymbol('BRK/B')).toBe('BRK.B')
    expect(normalizeSymbol(' nvda ')).toBe('NVDA')
    expect(normalizeSymbol('<script>')).toBeNull()
  })

  it('builds and parses the research → copilot link', () => {
    const href = buildCopilotHref('brk-b', 'What is book value?')
    expect(href).toBe('/copilot?symbol=BRK.B&q=What+is+book+value%3F')
    expect(parseCopilotParams(href.split('?')[1])).toEqual({ symbol: 'BRK.B', q: 'What is book value?' })
    expect(parseCopilotParams('')).toEqual({ symbol: null, q: null })
  })

  it('suggests ticker-aware questions', () => {
    expect(suggestedQuestions(null, 'AAPL')[0]).toContain('AAPL')
    const etf = suggestedQuestions(
      { ticker: 'SPY', asset_type: 'etf', forecast: null, news: [], latest_statement: null, identity: { status: 'ok' } },
    )
    expect(etf.join(' ')).not.toContain('10-K')
    const moved = suggestedQuestions(
      { ticker: 'PARA', asset_type: 'equity', forecast: null, news: [], latest_statement: null,
        identity: { status: 'changed', successor_symbol: 'PSKY' } },
    )
    expect(moved).toContain('Analyze PSKY')
  })
})

describe('source labels and units', () => {
  it('labels citation pills by source', () => {
    const base = { id: 'x', n: 1, source: 's', label: 'L' }
    expect(citationShortLabel({ ...base, kind: 'statement', period: 'Q3 FY2026', filing_type: '10-Q' } as CitationData)).toBe('Q3 FY2026 10-Q')
    expect(citationShortLabel({ ...base, kind: 'filing', filing_type: '10-K', fiscal_year: 2026, section: 'Risk Factors' } as CitationData)).toBe('10-K FY2026 · Risk Factors')
    expect(citationShortLabel({ ...base, kind: 'news', publisher: 'Reuters', published_at: '2026-11-23T12:00:00Z' } as CitationData)).toMatch(/^Reuters · Nov 2\d, 2026$/)
  })

  it('formats fundamentals as percentage points (never x100 again)', () => {
    expect(formatPercentPoints(142.26)).toBe('142.3%')
    expect(formatPercentPoints(0.3, 2)).toBe('0.30%')
    expect(formatPercentPoints(null)).toBeNull()
  })
})

describe('citations', () => {
  const text = 'Revenue $114.48B [fs:AAPL:2026-Q4]; price $236.48 [quote:AAPL, fs:AAPL:2026-Q4] [bogus:x]'

  it('extracts ids in first-appearance order', () => {
    expect(citationIds(text)).toEqual(['fs:AAPL:2026-Q4', 'quote:AAPL', 'bogus:x'])
  })

  it('linkifies to numbered chips and drops unconfirmed ids once known', () => {
    const known = [
      { id: 'fs:AAPL:2026-Q4', n: 1 },
      { id: 'quote:AAPL', n: 2 },
    ] as CitationData[]
    const out = linkifyCitations(text, known)
    expect(out).toContain('[1](#cite:fs%3AAAPL%3A2026-Q4)')
    expect(out).toContain('[2](#cite:quote%3AAAPL)[1](#cite:fs%3AAAPL%3A2026-Q4)')
    expect(out).not.toContain('bogus')
    expect(citationIdFromHref('#cite:fs%3ABRK.B%3A2026-Q3')).toBe('fs:BRK.B:2026-Q3')
    expect(citationIdFromHref('https://x')).toBeNull()
  })

  it('numbers by appearance while streaming (citations not known yet)', () => {
    expect(linkifyCitations('a [quote:AAPL] b [fc:AAPL] c [quote:AAPL]')).toBe(
      'a [1](#cite:quote%3AAAPL) b [2](#cite:fc%3AAAPL) c [1](#cite:quote%3AAAPL)',
    )
  })
})
