import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_STATE, NO_FILTERS_TEXT, PRESETS, PRESET_IDS, activeCriteriaCount, cardColumns, describeScreen, effectiveState,
  missingReason, parseScreenerParams, presetFilters, presetRule, setRange, viewColumns, VIEWS,
  type ScreenerRow,
} from './screener'

const BACKEND = path.resolve(__dirname, '../../../backend/app/services/screener_service.py')

/** Parse `Preset("id", "Label", "desc", {...})` entries out of the backend source. */
function backendPresets(): { id: string; label: string; params: Record<string, string> }[] {
  const src = readFileSync(BACKEND, 'utf8')
  const out: { id: string; label: string; params: Record<string, string> }[] = []
  const re = /Preset\("([a-z]+)",\s*"([^"]+)",\s*"[^"]*",\s*\{([^}]*)\}\)/g
  for (const m of Array.from(src.matchAll(re))) {
    const params: Record<string, string> = {}
    for (const kv of Array.from(m[3].matchAll(/"([a-z0-9_]+)":\s*"([^"]+)"/g))) params[kv[1]] = kv[2]
    out.push({ id: m[1], label: m[2], params })
  }
  return out
}

describe('screener presets', () => {
  it('match the backend definitions exactly (ids, labels, params)', () => {
    const be = backendPresets()
    expect(be.length).toBe(PRESET_IDS.length)
    expect(PRESETS.map((p) => ({ id: p.id, label: p.label, params: p.params }))).toEqual(be)
  })

  it('turn into the documented filters', () => {
    expect(presetFilters('value')).toMatchObject({ ranges: { pe: { max: 15 }, ps: { max: 3 }, de: { max: 1.5 } }, sort: 'pe', order: 'asc' })
    expect(presetFilters('growth')).toMatchObject({ ranges: { rev_growth: { min: 20 } }, sort: 'revenue_growth', order: 'desc' })
    expect(presetFilters('dividend')).toMatchObject({ ranges: { div_yield: { min: 3 }, mcap: { min: 2 } }, sort: 'dividend_yield' })
    expect(presetFilters('quality')).toMatchObject({ ranges: { roe: { min: 15 }, margin: { min: 15 }, de: { max: 1 } }, sort: 'roe' })
    expect(presetFilters('oversold')).toMatchObject({ ranges: { rsi: { max: 30 } }, sort: 'rsi', order: 'asc' })
    expect(presetFilters('momentum')).toMatchObject({ ranges: { chg1m: { min: 5 } }, sma: { sma50: 'above', sma200: 'above' }, sort: 'change_1m' })
    for (const id of PRESET_IDS) expect(presetFilters(id).preset).toBeUndefined()
  })

  it('describe their rule in words (tooltip text)', () => {
    expect(presetRule('value')).toBe('P/E ≤ 15x, P/S ≤ 3x, Debt / equity ≤ 1.5x · sorted by P/E, low to high')
    expect(presetRule('oversold')).toBe('RSI (14) ≤ 30 · sorted by RSI (14), low to high')
    expect(presetRule('dividend')).toBe('Market cap ≥ $2B, Dividend yield ≥ 3% · sorted by Dividend yield, high to low')
    expect(presetRule('momentum')).toBe('1M change ≥ 5%, Above 50-day SMA, Above 200-day SMA · sorted by 1M change, high to low')
  })

  it('count preset and explicit criteria together; explicit bounds override the preset', () => {
    expect(activeCriteriaCount(EMPTY_STATE)).toBe(0)
    expect(activeCriteriaCount({ ...EMPTY_STATE, preset: 'value' })).toBe(3)
    expect(activeCriteriaCount({ ...EMPTY_STATE, preset: 'momentum' })).toBe(3)
    const s = setRange({ ...EMPTY_STATE, preset: 'value' }, 'pe', 'max', 25)
    expect(effectiveState(s).ranges.pe).toEqual({ max: 25 })
    expect(activeCriteriaCount(s)).toBe(3)
    expect(activeCriteriaCount(setRange(s, 'mcap', 'min', 10))).toBe(4)
    expect(effectiveState({ ...EMPTY_STATE, preset: 'value', sort: 'price', order: 'desc' })).toMatchObject({ sort: 'price', order: 'desc' })
  })

  it('describes the active screen', () => {
    expect(describeScreen(EMPTY_STATE)).toBe(NO_FILTERS_TEXT)
    expect(describeScreen({ ...EMPTY_STATE, preset: 'growth' })).toBe('Growth: Revenue growth YoY ≥ 20%')
    expect(describeScreen(parseScreenerParams('preset=oversold&mcap_min=10'))).toBe('Oversold (RSI<30): RSI (14) ≤ 30 · Market cap ≥ $10B')
  })
})

describe('screener views', () => {
  it('every view has a price column and only known metrics', () => {
    for (const v of VIEWS) {
      const cols = viewColumns(v.id)
      expect(cols.every(Boolean)).toBe(true)
      expect(cols[0].key).toBe('price')
    }
    expect(viewColumns('technicals').map((c) => c.key)).toContain('rsi_14')
    expect(viewColumns('dividends').map((c) => c.key)).toContain('dividend_yield_pct')
  })

  it('mobile cards drop price and 1D (shown top right)', () => {
    expect(cardColumns('overview').map((c) => c.key)).toEqual(['change_1m_pct', 'market_cap', 'pe_ratio', 'ps_ratio'])
    expect(cardColumns('technicals', 3).map((c) => c.key)).toEqual(['change_1m_pct', 'rsi_14', 'price_vs_sma50_pct'])
  })
})

const row = (over: Partial<ScreenerRow>): ScreenerRow => ({
  symbol: 'X', name: null, sector: null, industry: null, exchange: null, asset_type: null, price: 1,
  change_1d_pct: null, change_1m_pct: null, market_cap: null, pe_ratio: null, ps_ratio: null, dividend_yield_pct: null,
  revenue_growth_yoy_pct: null, profit_margin_pct: null, roe_pct: null, debt_to_equity: null, rsi_14: null, sma_50: null,
  sma_200: null, price_vs_sma50_pct: null, price_vs_sma200_pct: null, flags: [], price_as_of: null, ...over,
})

describe('missing value reasons', () => {
  it('explains a dash from the row flags', () => {
    expect(missingReason(row({ pe_ratio: 12 }), 'pe_ratio')).toBeNull()
    expect(missingReason(row({ pe_ratio: 0 }), 'pe_ratio')).toBeNull()
    expect(missingReason(row({ flags: ['negative_earnings'] }), 'pe_ratio')).toMatch(/Loss-making/)
    expect(missingReason(row({ flags: ['negative_equity'] }), 'roe_pct')).toMatch(/Negative book equity/)
    expect(missingReason(row({ flags: ['roe_outlier'] }), 'roe_pct')).toMatch(/hidden/)
    expect(missingReason(row({}), 'price_vs_sma200_pct')).toMatch(/200 daily closes/)
    expect(missingReason(row({}), 'ps_ratio')).toBe('Unavailable from our data sources')
  })
})
