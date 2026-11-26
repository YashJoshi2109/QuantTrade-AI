import { describe, expect, it } from 'vitest'
import {
  EMPTY_STATE, PAGE_SIZE, activeFilterCount, applyPreset, filterChips, fmtMarketCap, fmtPct, fmtRatio, nextSort,
  parseScreenerParams, removeChip, setRange, toApiParams, toSearchParams, validateRangeInput,
} from './screener'

describe('screener query params', () => {
  it('round-trips a full screen through the URL', () => {
    const qs = 'preset=value&mcap_min=10&pe_max=15&rsi_min=20&rsi_max=40&sector=Technology|Healthcare&sma50=above&q=app&include_etfs=true&sort=pe&order=asc&page=3'
    const s = parseScreenerParams(qs)
    expect(s).toEqual({
      ranges: { mcap: { min: 10 }, pe: { max: 15 }, rsi: { min: 20, max: 40 } },
      sectors: ['Healthcare', 'Technology'],
      sma: { sma50: 'above' },
      q: 'app',
      includeEtfs: true,
      preset: 'value',
      sort: 'pe',
      order: 'asc',
      page: 3,
    })
    expect(parseScreenerParams(toSearchParams(s))).toEqual(s)
  })

  it('writes canonical, minimal URLs', () => {
    expect(toSearchParams(EMPTY_STATE).toString()).toBe('')
    const s = parseScreenerParams('sort=rsi&pe_max=15&sector=B|A')
    expect(toSearchParams(s).toString()).toBe('pe_max=15&sector=A%7CB&sort=rsi')
  })

  it('drops invalid, out-of-range and unknown values instead of guessing', () => {
    const s = parseScreenerParams('pe_max=abc&rsi_min=-5&roe_max=99999&sort=password&order=up&preset=moon&sma200=near&page=0&q=<script>&sector=Tech;DROP')
    expect(s).toEqual(EMPTY_STATE)
    expect(parseScreenerParams('page=99999').page).toBe(1)
  })

  it('swaps an inverted range', () => {
    expect(parseScreenerParams('pe_min=30&pe_max=10').ranges.pe).toEqual({ min: 10, max: 30 })
  })

  it('maps page to limit/offset for the API', () => {
    const p = toApiParams({ ...EMPTY_STATE, page: 3 })
    expect(p.get('limit')).toBe(String(PAGE_SIZE))
    expect(p.get('offset')).toBe(String(2 * PAGE_SIZE))
    expect(p.has('page')).toBe(false)
    expect(toApiParams(EMPTY_STATE).has('offset')).toBe(false)
  })
})

describe('screener state helpers', () => {
  it('sets and clears range bounds and resets the page', () => {
    let s = setRange({ ...EMPTY_STATE, page: 4 }, 'pe', 'max', 20)
    expect(s.ranges.pe).toEqual({ max: 20 })
    expect(s.page).toBe(1)
    s = setRange(s, 'pe', 'max', undefined)
    expect(s.ranges.pe).toBeUndefined()
  })

  it('sorts numeric columns high-first and flips on a second click', () => {
    const a = nextSort(EMPTY_STATE, 'pe', 'market_cap', 'desc')
    expect([a.sort, a.order]).toEqual(['pe', 'desc'])
    const b = nextSort(a, 'pe', 'pe', 'desc')
    expect(b.order).toBe('asc')
    expect(nextSort(EMPTY_STATE, 'symbol', 'market_cap', 'desc').order).toBe('asc')
  })

  it('presets replace the current filters', () => {
    expect(applyPreset('oversold')).toEqual({ ...EMPTY_STATE, preset: 'oversold' })
  })

  it('describes and removes filter chips', () => {
    const s = parseScreenerParams('mcap_min=2&mcap_max=2000&div_yield_min=3&sma200=below&sector=Energy')
    const chips = filterChips(s)
    expect(chips.map((c) => c.label)).toEqual([
      'Market cap $2B–$2T', 'Dividend yield ≥ 3%', 'Energy', 'Below 200-day SMA',
    ])
    expect(activeFilterCount(s)).toBe(4)
    const t = removeChip(removeChip(s, 'range:mcap'), 'sector')
    expect(filterChips(t).map((c) => c.id)).toEqual(['range:div_yield', 'sma:sma200'])
  })

  it('validates inputs with the backend bounds', () => {
    expect(validateRangeInput('rsi', '150')).toMatch(/Between 0 and 100/)
    expect(validateRangeInput('pe', 'x')).toBe('Enter a number')
    expect(validateRangeInput('roe', '')).toBeNull()
    expect(validateRangeInput('rev_growth', '-50')).toBeNull()
  })
})

describe('screener formatting', () => {
  it('shows a dash for missing values, never 0', () => {
    expect(fmtPct(null)).toBe('—')
    expect(fmtRatio(undefined)).toBe('—')
    expect(fmtMarketCap(null)).toBe('—')
    expect(fmtPct(0)).toBe('0.0%')
  })

  it('formats market cap and signed percents', () => {
    expect(fmtMarketCap(5.17e12)).toBe('$5.17T')
    expect(fmtMarketCap(42e9)).toBe('$42.0B')
    expect(fmtMarketCap(250e6)).toBe('$250M')
    expect(fmtPct(3.456, true)).toBe('+3.5%')
    expect(fmtPct(-1.2, true, 2)).toBe('-1.20%')
  })
})
