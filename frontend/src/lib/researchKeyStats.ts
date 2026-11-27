/**
 * Key-stats grid for the Research stock header (Apple Stocks style):
 * three columns, label left / value right, tabular numerals.
 *   Open / High / Low  |  Vol / P/E / Mkt Cap  |  52W H / 52W L / Avg Vol
 * Every value comes from the canonical ticker quote (/api/quotes/ticker); a
 * missing or zero figure renders as an em dash, never a fabricated number.
 */

export interface KeyStatsSource {
  open?: number | null
  day_high?: number | null
  day_low?: number | null
  volume?: number | null
  pe_ratio?: number | null
  market_cap?: number | null
  week_52_high?: number | null
  week_52_low?: number | null
  avg_volume?: number | null
}

/** Fields read from /api/quotes/ticker (TickerInfo) for the grid. */
export interface KeyStatsTicker extends KeyStatsSource {
  eps?: number | null
}

/** Fields read from the resolved live quote (lib/researchQuote ResolvedPriceInfo). */
export interface KeyStatsLive {
  volume?: number | null
  high?: number | null
  low?: number | null
}

/** Fields read from DB fundamentals (/api/v1/enhanced/fundamentals). */
export interface KeyStatsFundamentals {
  market_cap?: number | null
  pe_ratio?: number | null
  week_52_high?: number | null
  week_52_low?: number | null
}

function first(...values: Array<number | null | undefined>): number | undefined {
  for (const v of values) if (positive(v)) return v
  return undefined
}

/**
 * One merge rule for desktop and MobileResearch: the live quote wins for the
 * intraday figures (Vol / High / Low), the ticker quote for the session open
 * and averages, and DB fundamentals only fill a gap the quote left.
 */
export function keyStatsSource(
  ticker: KeyStatsTicker | null | undefined,
  live?: KeyStatsLive | null,
  fundamentals?: KeyStatsFundamentals | null,
): KeyStatsSource {
  const t = ticker ?? {}
  const l = live ?? {}
  const f = fundamentals ?? {}
  return {
    open: first(t.open),
    day_high: first(l.high, t.day_high),
    day_low: first(l.low, t.day_low),
    volume: first(l.volume, t.volume),
    pe_ratio: first(t.pe_ratio, f.pe_ratio),
    market_cap: first(t.market_cap, f.market_cap),
    week_52_high: first(t.week_52_high, f.week_52_high),
    week_52_low: first(t.week_52_low, f.week_52_low),
    avg_volume: first(t.avg_volume),
  }
}

export interface KeyStat {
  label: string
  value: string
}

const DASH = '—'

function positive(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

export function fmtPrice(v: number | null | undefined): string {
  return positive(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : DASH
}

/** 366_570_000 -> "366.57M"; 3.61e12 -> "3.61T". */
export function fmtCompact(v: number | null | undefined): string {
  if (!positive(v)) return DASH
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (const [size, suffix] of units) {
    if (v >= size) return `${(v / size).toFixed(2)}${suffix}`
  }
  return v.toFixed(0)
}

/** P/E is meaningless when earnings are negative: show a dash, not a number. */
export function fmtPe(v: number | null | undefined): string {
  return positive(v) ? v.toFixed(2) : DASH
}

export function keyStatsColumns(s: KeyStatsSource | null | undefined): KeyStat[][] {
  const q = s ?? {}
  return [
    [
      { label: 'Open', value: fmtPrice(q.open) },
      { label: 'High', value: fmtPrice(q.day_high) },
      { label: 'Low', value: fmtPrice(q.day_low) },
    ],
    [
      { label: 'Vol', value: fmtCompact(q.volume) },
      { label: 'P/E', value: fmtPe(q.pe_ratio) },
      { label: 'Mkt Cap', value: fmtCompact(q.market_cap) },
    ],
    [
      { label: '52W H', value: fmtPrice(q.week_52_high) },
      { label: '52W L', value: fmtPrice(q.week_52_low) },
      { label: 'Avg Vol', value: fmtCompact(q.avg_volume) },
    ],
  ]
}
