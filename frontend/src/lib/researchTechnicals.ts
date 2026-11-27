/**
 * Technical-analysis read-outs for the Research page (desktop right rail and
 * MobileResearch). Pure functions: every input is a value the backend already
 * returned (/api/v1/indicators/{sym}: sma_20/50/200, rsi, macd, bollinger_bands
 * and the canonical quote price). Nothing here invents a number; a missing input
 * gives `null` and the UI renders an em dash.
 *
 * Rules (also shown to the user in tooltips, see *_RULE strings):
 *
 * TREND  - four votes, each +1 / -1 (a tie is 0):
 *            price vs SMA 20, price vs SMA 50, price vs SMA 200, MACD line sign.
 *          score = sum / votes available, in [-1, 1]; needs >= 2 votes.
 *          score >= +0.5 Bullish, <= -0.5 Bearish, otherwise Neutral.
 *          The gauge needle sits at the score.
 * MOMENTUM - RSI(14): < 30 Oversold, < 45 Weak, <= 55 Neutral, < 70 Strong,
 *          >= 70 Overbought. The RSI card uses the classic 3 zones
 *          (< 30 Oversold, 30-70 Neutral, >= 70 Overbought).
 * VOLATILITY - Bollinger bandwidth = (upper - lower) / middle * 100.
 *          < 10% Low, < 20% Moderate, >= 20% High.
 * BOLLINGER position = (price - lower) / (upper - lower):
 *          < 0 Below lower band, <= 0.2 Near lower band, < 0.8 Mid band,
 *          <= 1 Near upper band, > 1 Above upper band.
 * MACD   - MACD line above its signal line Bullish, below Bearish, equal Neutral.
 */

import { macd as macdSeries, type MACDPoint } from './indicators'

export type Tone = 'up' | 'down' | 'neutral' | 'caution'

const DASH = '—'

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

const positive = (v: unknown): v is number => isFiniteNumber(v) && v > 0

export interface TechnicalInputs {
  price?: number | null
  sma_20?: number | null
  sma_50?: number | null
  sma_200?: number | null
  rsi?: number | null
  macd?: { macd?: number | null; signal?: number | null; histogram?: number | null } | null
  bollinger_bands?: { upper?: number | null; middle?: number | null; lower?: number | null } | null
}

// ── Trend ────────────────────────────────────────────────────────────────

export const TREND_RULE =
  'One vote each for price vs SMA 20, SMA 50 and SMA 200 (above +1, below -1) and for the MACD line sign. ' +
  'Score = votes / signals available. Score >= +0.5 Bullish, <= -0.5 Bearish, otherwise Neutral.'

export type TrendLabel = 'Bullish' | 'Bearish' | 'Neutral'

export interface TrendSignal {
  label: TrendLabel
  /** -1 (all bearish) .. +1 (all bullish) */
  score: number
  votes: number
  available: number
  tone: Tone
  /** one line, e.g. "Price below all three SMAs · MACD negative" */
  reason: string
}

const sign = (a: number, b: number) => (a > b ? 1 : a < b ? -1 : 0)

function smaReason(price: number, smas: Array<[string, number | null | undefined]>): string | null {
  const known = smas.filter((s): s is [string, number] => positive(s[1]))
  if (known.length === 0) return null
  const above = known.filter(([, v]) => price > v).map(([n]) => n)
  const below = known.filter(([, v]) => price < v).map(([n]) => n)
  const all = known.length === 3 ? 'all three SMAs' : known.length === 2 ? 'both SMAs' : `SMA ${known[0][0]}`
  if (above.length === known.length) return `Price above ${all}`
  if (below.length === known.length) return `Price below ${all}`
  const parts: string[] = []
  if (above.length) parts.push(`above SMA ${above.join('/')}`)
  if (below.length) parts.push(`below SMA ${below.join('/')}`)
  return `Price ${parts.join(', ')}`
}

export function trendSignal(t: TechnicalInputs | null | undefined): TrendSignal | null {
  if (!t || !positive(t.price)) return null
  const price = t.price
  const votes: number[] = []
  for (const s of [t.sma_20, t.sma_50, t.sma_200]) if (positive(s)) votes.push(sign(price, s))
  const m = t.macd?.macd
  if (isFiniteNumber(m)) votes.push(sign(m, 0))
  if (votes.length < 2) return null
  const sum = votes.reduce((a, b) => a + b, 0)
  const score = sum / votes.length
  const label: TrendLabel = score >= 0.5 ? 'Bullish' : score <= -0.5 ? 'Bearish' : 'Neutral'
  const reasons: string[] = []
  const sr = smaReason(price, [['20', t.sma_20], ['50', t.sma_50], ['200', t.sma_200]])
  if (sr) reasons.push(sr)
  if (isFiniteNumber(m)) reasons.push(m > 0 ? 'MACD positive' : m < 0 ? 'MACD negative' : 'MACD flat')
  return {
    label,
    score,
    votes: sum,
    available: votes.length,
    tone: label === 'Bullish' ? 'up' : label === 'Bearish' ? 'down' : 'neutral',
    reason: reasons.join(' · '),
  }
}

// ── Momentum / RSI ──────────────────────────────────────────────────────

export const MOMENTUM_RULE =
  'From RSI(14): below 30 Oversold, 30-45 Weak, 45-55 Neutral, 55-70 Strong, 70 and above Overbought.'
export const RSI_RULE = 'RSI(14) zones: below 30 Oversold, 30-70 Neutral, 70 and above Overbought.'

export type MomentumLabel = 'Oversold' | 'Weak' | 'Neutral' | 'Strong' | 'Overbought'

export function momentumFromRsi(rsi: number | null | undefined): { label: MomentumLabel; tone: Tone } | null {
  if (!isFiniteNumber(rsi) || rsi < 0 || rsi > 100) return null
  if (rsi < 30) return { label: 'Oversold', tone: 'caution' }
  if (rsi < 45) return { label: 'Weak', tone: 'down' }
  if (rsi <= 55) return { label: 'Neutral', tone: 'neutral' }
  if (rsi < 70) return { label: 'Strong', tone: 'up' }
  return { label: 'Overbought', tone: 'caution' }
}

export type RsiZone = 'Oversold' | 'Neutral' | 'Overbought'

export function rsiZone(rsi: number | null | undefined): RsiZone | null {
  if (!isFiniteNumber(rsi) || rsi < 0 || rsi > 100) return null
  return rsi < 30 ? 'Oversold' : rsi >= 70 ? 'Overbought' : 'Neutral'
}

// ── Volatility / Bollinger ──────────────────────────────────────────────

export const VOLATILITY_RULE =
  'Bollinger bandwidth = (upper band - lower band) / middle band. Below 10% Low, 10-20% Moderate, 20% and above High.'
export const BOLLINGER_RULE =
  'Where price sits between the 20-day Bollinger bands: bottom 20% Near lower band, top 20% Near upper band, otherwise Mid band.'

export type VolatilityLabel = 'Low' | 'Moderate' | 'High'

export function bollingerBandwidth(bb: TechnicalInputs['bollinger_bands']): number | null {
  if (!bb || !positive(bb.upper) || !positive(bb.lower) || !positive(bb.middle)) return null
  if (bb.upper < bb.lower) return null
  return ((bb.upper - bb.lower) / bb.middle) * 100
}

export function volatilityFromBollinger(
  bb: TechnicalInputs['bollinger_bands'],
): { label: VolatilityLabel; bandwidthPct: number; tone: Tone } | null {
  const w = bollingerBandwidth(bb)
  if (w === null) return null
  const label: VolatilityLabel = w < 10 ? 'Low' : w < 20 ? 'Moderate' : 'High'
  return { label, bandwidthPct: w, tone: label === 'High' ? 'caution' : 'neutral' }
}

export type BollingerLabel =
  | 'Below lower band'
  | 'Near lower band'
  | 'Mid band'
  | 'Near upper band'
  | 'Above upper band'

export function bollingerPosition(
  price: number | null | undefined,
  bb: TechnicalInputs['bollinger_bands'],
): { label: BollingerLabel; position: number } | null {
  if (!positive(price) || !bb || !positive(bb.upper) || !positive(bb.lower) || bb.upper <= bb.lower) return null
  const pos = (price - bb.lower) / (bb.upper - bb.lower)
  const label: BollingerLabel =
    pos < 0 ? 'Below lower band' : pos <= 0.2 ? 'Near lower band' : pos < 0.8 ? 'Mid band' : pos <= 1 ? 'Near upper band' : 'Above upper band'
  return { label, position: pos }
}

// ── MACD ────────────────────────────────────────────────────────────────

export const MACD_RULE = 'MACD (12, 26, 9): MACD line above its signal line Bullish, below Bearish.'

export function macdSignal(
  macd: TechnicalInputs['macd'],
): { label: TrendLabel; tone: Tone; macd: number; signal: number; histogram: number | null } | null {
  if (!macd || !isFiniteNumber(macd.macd) || !isFiniteNumber(macd.signal)) return null
  const d = macd.macd - macd.signal
  const label: TrendLabel = d > 0 ? 'Bullish' : d < 0 ? 'Bearish' : 'Neutral'
  return {
    label,
    tone: label === 'Bullish' ? 'up' : label === 'Bearish' ? 'down' : 'neutral',
    macd: macd.macd,
    signal: macd.signal,
    histogram: isFiniteNumber(macd.histogram) ? macd.histogram : d,
  }
}

/**
 * MACD(12, 26, 9) history for the mini chart, computed from daily closes the
 * page already loaded (/api/v1/prices). The headline MACD / signal values
 * always come from /api/v1/indicators; this only draws their recent shape.
 */
export function macdHistory(
  bars: ReadonlyArray<{ timestamp: string; close: number }> | null | undefined,
  points = 60,
): MACDPoint[] {
  if (!bars || bars.length < 35) return []
  const candles = bars
    .filter((b) => positive(b.close))
    .map((b) => ({ time: Math.floor(Date.parse(b.timestamp) / 1000), open: b.close, high: b.close, low: b.close, close: b.close, volume: 0 }))
    .filter((c) => Number.isFinite(c.time))
    .sort((a, b) => a.time - b.time)
  return macdSeries(candles).slice(-points)
}

// ── Moving averages ─────────────────────────────────────────────────────

export interface SmaRow {
  label: string
  value: number | null
  /** price relative to the SMA; null when either is missing */
  above: boolean | null
}

export function smaRows(t: TechnicalInputs | null | undefined): SmaRow[] {
  const price = t?.price
  return ([['SMA 20', t?.sma_20], ['SMA 50', t?.sma_50], ['SMA 200', t?.sma_200]] as const).map(([label, v]) => ({
    label,
    value: positive(v) ? v : null,
    above: positive(v) && positive(price) ? price >= v : null,
  }))
}

// ── Range bars ──────────────────────────────────────────────────────────

/** Where `value` sits in [low, high], clamped to 0..1; null when unknown. */
export function rangePosition(
  value: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined,
): number | null {
  if (!positive(value) || !positive(low) || !positive(high) || high < low) return null
  if (high === low) return 0.5
  return Math.min(1, Math.max(0, (value - low) / (high - low)))
}

// ── Formatting ──────────────────────────────────────────────────────────

/** Signed with a true minus sign: -17.57 -> "−17.57", 3.1 -> "+3.10". */
export function fmtSigned(v: number | null | undefined, digits = 2, plus = true): string {
  if (!isFiniteNumber(v)) return DASH
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (v < 0) return `−${abs}`
  return plus && v > 0 ? `+${abs}` : abs
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(v)) return DASH
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** "$342.34" / "—" */
export function fmtUsd(v: number | null | undefined, digits = 2): string {
  return positive(v) ? `$${fmtNum(v, digits)}` : DASH
}

/** "−6.86 (−1.96%)" */
export function fmtChange(change: number | null | undefined, pct: number | null | undefined): string {
  if (!isFiniteNumber(pct)) return DASH
  const p = `${fmtSigned(pct, 2)}%`
  return isFiniteNumber(change) && change !== 0 ? `${fmtSigned(change, 2)} (${p})` : p
}

// ── Rules-based AI summary (moved from app/research/page.tsx) ───────────

export interface RulesReport {
  sentiment: TrendLabel
  rsiSignal: string
  trendSignal: string
  macdText: string
  bbText: string
  maSummary: string
  bullets: string[]
}

/**
 * Plain-language technical snapshot used by the AI Insights fallback and the
 * Overview summary. Same rules the desktop page had inline.
 */
export function rulesReport(
  t: TechnicalInputs | null | undefined,
  quote: { percent?: number | null; volume?: number | null } = {},
): RulesReport {
  const p = t?.price
  const rsi = t?.rsi
  const m = t?.macd
  const bb = t?.bollinger_bands
  const { sma_20: sma20, sma_50: sma50, sma_200: sma200 } = t ?? {}

  let macdText = 'MACD is not available for this symbol yet — sync data if you expect it.'
  if (m && isFiniteNumber(m.macd) && isFiniteNumber(m.signal)) {
    const d = m.macd - m.signal
    macdText =
      d > 0
        ? 'MACD line sits above its signal line, which often accompanies bullish momentum shifts.'
        : d < 0
          ? 'MACD line sits below its signal line, which often accompanies bearish momentum shifts.'
          : 'MACD and signal are effectively tied — short-term momentum is in balance.'
  }

  let bbText = 'Bollinger Band width and position are unavailable.'
  const pos = bollingerPosition(p, bb)
  if (pos) {
    const pct = (pos.position * 100).toFixed(0)
    if (pos.position > 0.85) bbText = `Price is in the upper part of the band (${pct}% of the range) — watch for extension vs. mean reversion.`
    else if (pos.position < 0.15) bbText = `Price is in the lower part of the band (${pct}% of the range) — bounce risk or trend continuation depending on volume.`
    else bbText = `Price trades near the middle of the bands (${pct}% of range), away from volatility extremes.`
  }

  const parts: string[] = []
  if (positive(p) && positive(sma20)) parts.push(p > sma20 ? 'above the 20-day SMA' : 'at or under the 20-day SMA')
  if (positive(p) && positive(sma50)) parts.push(p > sma50 ? 'above the 50-day SMA' : 'at or under the 50-day SMA')
  if (positive(p) && positive(sma200)) parts.push(p > sma200 ? 'above the 200-day SMA (long-term bid often intact)' : 'under the 200-day SMA (long-term trend pressure)')
  let stackNote = ''
  if (positive(sma20) && positive(sma50) && positive(sma200)) {
    if (sma20 > sma50 && sma50 > sma200) stackNote = ' SMAs stack bullish (20 over 50 over 200).'
    else if (sma20 < sma50 && sma50 < sma200) stackNote = ' SMAs stack bearish (20 under 50 under 200).'
    else stackNote = ' SMA alignment is mixed — the trend regime looks transitional.'
  }
  const maSummary =
    parts.length > 0 ? `Relative to moving averages, price is ${parts.join(', ')}.${stackNote}` : 'Moving-average context needs synced indicator data.'

  const trend = trendSignal(t)
  const bullets: string[] = []
  if (isFiniteNumber(rsi)) {
    bullets.push(`RSI(14) is ${fmtNum(rsi, 1)} — ${rsi >= 70 ? 'stretched toward overbought' : rsi < 30 ? 'stretched toward oversold' : 'in a neutral band'}.`)
  }
  if (isFiniteNumber(quote.percent)) bullets.push(`Change vs prior close: ${fmtSigned(quote.percent, 2)}%.`)
  if (positive(quote.volume)) bullets.push(`Volume: about ${fmtNum(quote.volume / 1e6, 2)}M shares on this print.`)

  return {
    sentiment: trend?.label ?? 'Neutral',
    rsiSignal: rsiZone(rsi) ?? 'N/A',
    trendSignal: positive(p) && positive(sma50) ? (p > sma50 ? 'Above SMA 50' : 'Below SMA 50') : 'N/A',
    macdText,
    bbText,
    maSummary,
    bullets,
  }
}

const EXCHANGE_LABELS: Record<string, string> = {
  NYQ: 'NYSE', NYS: 'NYSE', NYSE: 'NYSE', NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NAS: 'NASDAQ', NASDAQ: 'NASDAQ',
  NASDAQGS: 'NASDAQ', NASDAQGM: 'NASDAQ', NASDAQCM: 'NASDAQ', ASE: 'NYSE American', AMEX: 'NYSE American',
  PCX: 'NYSE Arca', ARCA: 'NYSE Arca', NYSEARCA: 'NYSE Arca', BTS: 'Cboe BZX', BATS: 'Cboe BZX',
}

/** Provider exchange code -> readable venue ("NYQ" -> "NYSE"); unknown codes pass through. */
export function exchangeLabel(code: string | null | undefined): string {
  const c = (code ?? '').trim()
  if (!c) return ''
  return EXCHANGE_LABELS[c.toUpperCase().replace(/\s+/g, '')] ?? c
}

/** Tailwind text class for a tone (green/red only for direction). */
export function toneText(tone: Tone | null | undefined): string {
  switch (tone) {
    case 'up':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'down':
      return 'text-red-600 dark:text-red-400'
    case 'caution':
      return 'text-amber-600 dark:text-amber-400'
    default:
      return 'text-fg-secondary'
  }
}
