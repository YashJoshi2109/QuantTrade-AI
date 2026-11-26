import { describe, expect, it } from 'vitest'
import {
  DISCLAIMER, baseSpec, chartRows, countConditions, csvCell, dsrVerdict, formatMetric, gridSize, groupDepth, groupText,
  heatClass, monthlyGrid, newCondition, oosVerdict, parseGrid, pboVerdict, referencedParams, specFromPreset, toCsv,
  tradesCsv, updateRule, validateSpec, wfVerdict,
  type Group, type LabResult, type LabTrade, type Preset, type StrategySpec,
} from './backtestLab'

const cross: Group = {
  logic: 'all',
  rules: [{ left: { indicator: 'sma', params: { period: '$fast' } }, op: 'crosses_above', right: { indicator: 'sma', params: { period: '$slow' } } }],
}

function spec(p: Partial<StrategySpec> = {}): StrategySpec {
  return { ...baseSpec(), start_date: '2015-01-01', end_date: '2024-12-31', entry: cross, parameters: { fast: 50, slow: 200 }, ...p }
}

describe('strategy lab helpers', () => {
  it('has the required disclaimer text', () => {
    expect(DISCLAIMER).toBe('Hypothetical results; past performance does not guarantee future results.')
  })

  it('renders rule text like the backend', () => {
    expect(groupText(cross, { fast: 50, slow: 200 })).toBe('SMA(50) crosses above SMA(200)')
    const g: Group = { logic: 'any', rules: [cross, { left: { indicator: 'rsi', params: { period: 14 } }, op: '<', right: { value: 30 } }] }
    expect(groupText(g, { fast: 5, slow: 20 })).toBe('(SMA(5) crosses above SMA(20)) OR RSI(14) < 30')
  })

  it('edits nested rules immutably', () => {
    const g: Group = { logic: 'all', rules: [newCondition(), { logic: 'any', rules: [newCondition(), newCondition()] }] }
    const removed = updateRule(g, [1, 0], () => null)
    expect(countConditions(g)).toBe(3)
    expect(countConditions(removed)).toBe(2)
    expect(groupDepth(g)).toBe(2)
    expect(g.rules[1]).not.toBe(removed.rules[1])
  })

  it('parses sweep values', () => {
    expect(parseGrid('10, 20,30')).toEqual([10, 20, 30])
    expect(parseGrid('10-50:10')).toEqual([10, 20, 30, 40, 50])
    expect(parseGrid('')).toEqual([])
    expect(parseGrid('ten')).toBeNull()
    expect(gridSize({ a: [1, 2, 3], b: [1, 2] })).toBe(6)
    expect(gridSize({})).toBe(1)
  })

  it('finds $parameter references', () => {
    expect(referencedParams(spec())).toEqual(['fast', 'slow'])
  })

  it('validates bounds before submit', () => {
    expect(validateSpec(spec())).toEqual([])
    expect(validateSpec(spec({ symbols: Array.from({ length: 11 }, (_, i) => `S${i}`) })).join()).toMatch(/At most 10 symbols/)
    expect(validateSpec(spec({ start_date: '1990-01-01' })).join()).toMatch(/25 years/)
    expect(validateSpec(spec({ param_grid: { fast: [1, 2, 3, 4, 5, 6, 7, 8], slow: [1, 2, 3, 4, 5, 6, 7, 8] } })).join()).toMatch(/limit is 60/)
    expect(validateSpec(spec({ parameters: {} })).join()).toMatch(/\$fast/)
    expect(validateSpec(spec({ entry: { logic: 'all', rules: [] } })).join()).toMatch(/entry condition/)
    expect(validateSpec(spec({ symbols: Array.from({ length: 10 }, (_, i) => `S${i}`), start_date: '2000-01-01', param_grid: { fast: [1, 2, 3, 4, 5, 6], slow: [1, 2, 3, 4, 5] } })).join()).toMatch(/Too much work/)
  })

  it('builds a spec from a preset but keeps user dates and costs', () => {
    const p: Preset = { id: 'x', name: 'X', category: 'c', description: 'd', spec: { symbols: ['QQQ'], entry: cross, parameters: { fast: 1, slow: 2 } } }
    const s = specFromPreset(p, { start_date: '2001-02-03', commission_bps: 9, symbols: ['ZZZ'] })
    expect(s.symbols).toEqual(['QQQ'])
    expect(s.start_date).toBe('2001-02-03')
    expect(s.commission_bps).toBe(9)
    expect(s.exit).toBeNull()
    expect(p.spec.entry).not.toBe(s.entry) // deep copy
  })

  it('formats metrics', () => {
    expect(formatMetric(12.345, 'pct')).toBe('+12.35%')
    expect(formatMetric(-3, 'pct')).toBe('−3.00%')
    expect(formatMetric(1.234, 'ratio')).toBe('1.23')
    expect(formatMetric(null, 'ratio')).toBe('—')
    expect(formatMetric(400, 'days')).toBe('400 d')
    expect(formatMetric(2.5, 'x')).toBe('2.50×')
  })

  it('lays out the monthly heatmap by calendar month', () => {
    const rows = monthlyGrid({
      monthly_returns: [{ year: 2020, month: 1, return_pct: 1 }, { year: 2020, month: 3, return_pct: -2 }, { year: 2021, month: 12, return_pct: 4 }],
      yearly_returns: [{ year: 2020, return_pct: -1.02 }, { year: 2021, return_pct: 4 }],
    })
    expect(rows.map((r) => r.year)).toEqual([2020, 2021])
    expect(rows[0].months[0]).toBe(1)
    expect(rows[0].months[1]).toBeNull()
    expect(rows[0].months[2]).toBe(-2)
    expect(rows[1].months[11]).toBe(4)
    expect(rows[0].total).toBe(-1.02)
    expect(heatClass(5)).toContain('emerald')
    expect(heatClass(-5)).toContain('red')
    expect(heatClass(null)).toBe('text-fg-muted')
  })

  it('guards CSV against formula injection and quotes fields', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@SUM')).toBe("'@SUM")
    expect(csvCell(-5)).toBe('-5') // numbers stay numbers
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(toCsv(['a', 'b'], [[1, null]])).toBe('a,b\r\n1,')
    const t: LabTrade = {
      symbol: '-SPY', side: 'LONG', signal_date: '2020-01-02', entry_date: '2020-01-03', entry_price: 100.123456,
      exit_signal_date: null, exit_date: '2020-02-03', exit_price: 110, quantity: 1.5, pnl: 14.81, return_pct: 9.87,
      commission: 0.2, bars_held: 21, exit_reason: 'signal', mae: -1, mfe: 12,
    }
    const lines = tradesCsv([t]).split('\r\n')
    expect(lines[0].startsWith('#,Symbol,Side,Signal date,Entry date')).toBe(true)
    expect(lines[1]).toContain("'-SPY")
    expect(lines[1]).toContain('100.1235')
  })

  it('aligns Monte Carlo bands with the equity series by date', () => {
    const r = {
      series: { points: [{ date: '2020-01-01', equity: 1, benchmark: 1, drawdown_pct: 0 }, { date: '2020-01-02', equity: 2, benchmark: 1, drawdown_pct: 0 }], sampled: false },
      monte_carlo: { block_bootstrap: { bands: [{ date: '2020-01-02', p5: 1, p25: 1.5, p50: 2, p75: 2.5, p95: 3 }] }, trade_bootstrap: null },
    } as unknown as LabResult
    const rows = chartRows(r)
    expect(rows[0].band).toBeUndefined()
    expect(rows[1].band).toEqual([1, 3])
  })

  it('turns robustness numbers into honest verdicts', () => {
    expect(pboVerdict(0.6).tone).toBe('bad')
    expect(pboVerdict(0.1).tone).toBe('good')
    expect(pboVerdict(null).tone).toBe('neutral')
    expect(dsrVerdict(0.99).tone).toBe('good')
    expect(dsrVerdict(0.5).tone).toBe('bad')
    expect(oosVerdict(1.2, -0.1).tone).toBe('bad')
    expect(oosVerdict(1.2, 0.4).tone).toBe('warn')
    expect(oosVerdict(0.7, 0.75).tone).toBe('good')
    expect(wfVerdict(0.67).tone).toBe('warn')
    expect(wfVerdict(1.1).tone).toBe('good')
  })
})
