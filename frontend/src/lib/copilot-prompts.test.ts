import { afterEach, describe, expect, it } from 'vitest'
import {
  EVERGREEN_PROMPTS,
  RECENT_TICKERS_KEY,
  buildStarterPrompts,
  pushRecent,
  readRecentTickers,
  rememberRecentTicker,
} from './copilot-prompts'

describe('buildStarterPrompts', () => {
  it('falls back to evergreen prompts for a brand-new user', () => {
    const groups = buildStarterPrompts({})
    expect(groups).toHaveLength(1)
    expect(groups[0].source).toBe('evergreen')
    expect(groups[0].prompts.map((p) => p.text)).toEqual(EVERGREEN_PROMPTS.slice(0, 4))
  })

  it('orders context, watchlist, portfolio, recent, evergreen and dedupes tickers', () => {
    const groups = buildStarterPrompts({
      contextSymbol: 'nvda',
      watchlist: ['NVDA', 'AMD', 'COST', 'AAPL'],
      holdings: ['MSFT', 'AMD', 'VOO'],
      recent: ['$brk-b', 'MSFT'],
    })
    expect(groups.map((g) => g.source)).toEqual(['context', 'watchlist', 'portfolio', 'recent', 'evergreen'])
    const all = groups.flatMap((g) => g.prompts)
    const symbols = all.map((p) => p.symbol).filter(Boolean)
    // NVDA only in context; AMD only in watchlist; MSFT only in portfolio.
    expect(symbols.filter((s) => s === 'NVDA').length).toBe(groups[0].prompts.length)
    expect(groups[1].prompts.map((p) => p.symbol)).toEqual(['AMD', 'COST'])
    expect(groups[2].prompts.map((p) => p.symbol)).toEqual(['MSFT', 'VOO'])
    expect(groups[3].prompts.map((p) => p.symbol)).toEqual(['BRK.B'])
    expect(groups[4].prompts).toHaveLength(2)
  })

  it('writes one readable line per prompt that names the ticker', () => {
    const groups = buildStarterPrompts({ watchlist: ['AMD', 'COST'] })
    for (const p of groups[0].prompts) {
      expect(p.text).toContain(p.symbol as string)
      expect(p.text).not.toContain('\n')
      expect(p.text.length).toBeLessThanOrEqual(70)
    }
    // Two watchlist rows use different templates.
    expect(groups[0].prompts[0].text.replace('AMD', 'X')).not.toBe(groups[0].prompts[1].text.replace('COST', 'X'))
  })

  it('ignores junk symbols and respects perGroup', () => {
    const groups = buildStarterPrompts({ watchlist: ['<script>', null, '', 'aapl', 'msft', 'goog'], perGroup: 1 })
    expect(groups[0].prompts.map((p) => p.symbol)).toEqual(['AAPL'])
  })

  it('every prompt id is unique', () => {
    const ids = buildStarterPrompts({ contextSymbol: 'AAPL', watchlist: ['MSFT'], holdings: ['GOOG'], recent: ['TSLA'] })
      .flatMap((g) => g.prompts.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('recent tickers', () => {
  afterEach(() => window.localStorage.clear())

  it('pushRecent moves to front, dedupes and caps', () => {
    expect(pushRecent(['AAPL', 'MSFT'], 'msft')).toEqual(['MSFT', 'AAPL'])
    expect(pushRecent(['A', 'B', 'C'], 'D', 3)).toEqual(['D', 'A', 'B'])
    expect(pushRecent(['A'], '!!')).toEqual(['A'])
  })

  it('persists to localStorage and tolerates corrupt data', () => {
    rememberRecentTicker('nvda')
    rememberRecentTicker('AAPL')
    expect(readRecentTickers()).toEqual(['AAPL', 'NVDA'])
    window.localStorage.setItem(RECENT_TICKERS_KEY, '{not json')
    expect(readRecentTickers()).toEqual([])
  })
})
