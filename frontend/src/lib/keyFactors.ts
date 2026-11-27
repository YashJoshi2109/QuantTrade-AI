/**
 * Key Factors — rule-based readings from technicals + fundamentals.
 *
 * Every factor family reports its *current reading* (including neutral ones),
 * so the panel is never down to two or three cards on an ordinary day.
 * Descriptions state only what the numbers show; no invented hit-rates.
 * Pure (no JSX) so it is unit-testable and shared by desktop + mobile.
 */
import type { FundamentalsData, Indicators } from '@/lib/api'
import { earningsTiming } from '@/lib/valuation'

export type FactorBias = 'Bullish' | 'Bearish' | 'Neutral'
export type FactorImpact = 'High' | 'Medium' | 'Low'
export type FactorCategory = 'Technical' | 'Valuation' | 'Quality' | 'Balance Sheet' | 'Sentiment' | 'Event'
export type FactorIcon = 'trend' | 'trendDown' | 'momentum' | 'volatility' | 'macd' | 'valuation' | 'quality' | 'shield' | 'target' | 'range' | 'event'

export interface KeyFactor {
  id: string
  title: string
  category: FactorCategory
  impact: FactorImpact
  bias: FactorBias
  /** 0–100 strength of the reading (how far past its threshold), not a probability. */
  strength: number
  description: string
  icon: FactorIcon
}

const n = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const f = (v: number, d = 1) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const clamp = (v: number, lo = 5, hi = 95) => Math.round(Math.max(lo, Math.min(hi, v)))

const IMPACT_RANK: Record<FactorImpact, number> = { High: 0, Medium: 1, Low: 2 }

export function generateKeyFactors(
  indicators: Indicators | null | undefined,
  fundamentals: FundamentalsData | null | undefined,
  price: number | null | undefined,
  now: Date = new Date(),
): KeyFactor[] {
  const out: KeyFactor[] = []
  const ind = indicators?.indicators
  const fd = fundamentals ?? undefined
  const px = n(price) && price > 0 ? price : n(ind?.current_price) ? ind!.current_price! : undefined

  // ── Trend: price vs SMA50 / SMA200 ────────────────────────────────────
  if (px && n(ind?.sma_50) && n(ind?.sma_200) && ind!.sma_50! > 0 && ind!.sma_200! > 0) {
    const s50 = ind!.sma_50!, s200 = ind!.sma_200!
    const d50 = ((px - s50) / s50) * 100
    const d200 = ((px - s200) / s200) * 100
    const base = { id: 'trend', category: 'Technical' as const }
    if (px > s50 && s50 > s200) {
      out.push({ ...base, title: 'Uptrend Intact', impact: 'High', bias: 'Bullish', strength: clamp(60 + d200), icon: 'trend',
        description: `Price ${f(d50)}% above SMA50 ($${f(s50, 2)}), and SMA50 is above SMA200 ($${f(s200, 2)}) — moving averages aligned upward.` })
    } else if (px < s50 && s50 < s200) {
      out.push({ ...base, title: 'Downtrend', impact: 'High', bias: 'Bearish', strength: clamp(60 + Math.abs(d200)), icon: 'trendDown',
        description: `Price ${f(Math.abs(d50))}% below SMA50 ($${f(s50, 2)}), and SMA50 is below SMA200 ($${f(s200, 2)}) — moving averages aligned downward.` })
    } else if (px < s50 && px < s200) {
      // SMA50 still above SMA200 but price below both: the uptrend has broken
      // (NVDA 149.30 vs SMA50 203.65 / SMA200 202.62), not a pullback inside it.
      out.push({ ...base, title: 'Trend Breakdown', impact: 'High', bias: 'Bearish', strength: clamp(55 + Math.abs(d200)), icon: 'trendDown',
        description: `Price ${f(Math.abs(d50))}% below SMA50 ($${f(s50, 2)}) and ${f(Math.abs(d200))}% below SMA200 ($${f(s200, 2)}). SMA50 is still above SMA200; a cross below would confirm a downtrend.` })
    } else if (px < s50) {
      out.push({ ...base, title: 'Pullback in Uptrend', impact: 'Medium', bias: 'Bearish', strength: clamp(45 + Math.abs(d50)), icon: 'trendDown',
        description: `Price ${f(Math.abs(d50))}% below SMA50 while SMA50 stays above SMA200. SMA200 at $${f(s200, 2)} (${f(d200)}% away) is the longer-term reference.` })
    } else {
      out.push({ ...base, title: 'Recovery Attempt', impact: 'Medium', bias: 'Bullish', strength: clamp(45 + d50), icon: 'trend',
        description: `Price ${f(d50)}% above SMA50, but SMA50 is still below SMA200 ($${f(s200, 2)}). A long-term trend change needs SMA50 to cross above SMA200.` })
    }
  }

  // ── Momentum: RSI(14) ─────────────────────────────────────────────────
  const rsi = n(ind?.rsi) ? ind!.rsi! : n(fd?.rsi) ? fd!.rsi! : undefined
  if (rsi !== undefined) {
    const base = { id: 'rsi', category: 'Technical' as const, icon: 'momentum' as const }
    if (rsi >= 70) out.push({ ...base, title: 'Overbought (RSI)', impact: rsi >= 80 ? 'High' : 'Medium', bias: 'Bearish', strength: clamp(50 + (rsi - 70) * 2.5),
      description: `RSI(14) at ${f(rsi)} — above 70, momentum is stretched to the upside.` })
    else if (rsi <= 30) out.push({ ...base, title: 'Oversold (RSI)', impact: rsi <= 20 ? 'High' : 'Medium', bias: 'Bullish', strength: clamp(50 + (30 - rsi) * 2.5),
      description: `RSI(14) at ${f(rsi)} — below 30, selling pressure is stretched.` })
    else if (rsi >= 55) out.push({ ...base, title: 'Positive Momentum', impact: 'Low', bias: 'Bullish', strength: clamp(30 + (rsi - 50) * 2),
      description: `RSI(14) at ${f(rsi)} — buyers in control without being overbought.` })
    else if (rsi <= 45) out.push({ ...base, title: 'Weak Momentum', impact: 'Low', bias: 'Bearish', strength: clamp(30 + (50 - rsi) * 2),
      description: `RSI(14) at ${f(rsi)} — sellers have the edge, but not oversold.` })
    else out.push({ ...base, title: 'Neutral Momentum', impact: 'Low', bias: 'Neutral', strength: 25,
      description: `RSI(14) at ${f(rsi)} — mid-range, no momentum edge either way.` })
  }

  // ── MACD vs signal ────────────────────────────────────────────────────
  if (ind?.macd && n(ind.macd.macd) && n(ind.macd.signal)) {
    const m = ind.macd.macd, s = ind.macd.signal
    const diff = m - s
    const rel = px ? (Math.abs(diff) / px) * 100 : Math.abs(diff)
    out.push({
      id: 'macd', category: 'Technical', icon: 'macd',
      title: diff >= 0 ? 'MACD Above Signal' : 'MACD Below Signal',
      impact: rel > 1 ? 'High' : rel > 0.3 ? 'Medium' : 'Low',
      bias: Math.abs(diff) < 1e-9 ? 'Neutral' : diff > 0 ? 'Bullish' : 'Bearish',
      strength: clamp(35 + rel * 40),
      description: `MACD ${f(m, 2)} vs signal ${f(s, 2)} (gap ${diff >= 0 ? '+' : ''}${f(diff, 2)}). ${m >= 0 ? 'MACD is above zero.' : 'MACD is below zero.'}`,
    })
  }

  // ── Volatility: Bollinger width + position ────────────────────────────
  const bb = ind?.bollinger_bands
  if (bb && n(bb.upper) && n(bb.lower) && n(bb.middle) && bb.middle > 0) {
    const width = ((bb.upper - bb.lower) / bb.middle) * 100
    const pos = px && bb.upper > bb.lower ? ((px - bb.lower) / (bb.upper - bb.lower)) * 100 : undefined
    const where = pos === undefined ? '' : ` Price sits at ${f(pos, 0)}% of the band range.`
    if (width > 20) out.push({ id: 'vol', category: 'Technical', icon: 'volatility', title: 'High Volatility', impact: 'High', bias: 'Bearish', strength: clamp(40 + width),
      description: `Bollinger bands span ${f(width)}% of the 20-day average — wide swings, so size positions smaller.${where}` })
    else if (width < 6) out.push({ id: 'vol', category: 'Technical', icon: 'volatility', title: 'Volatility Squeeze', impact: 'Medium', bias: 'Neutral', strength: clamp(40 + (6 - width) * 8),
      description: `Bollinger bands compressed to ${f(width)}% of the 20-day average — quiet range that often precedes a larger move.${where}` })
    else out.push({ id: 'vol', category: 'Technical', icon: 'volatility', title: 'Normal Volatility', impact: 'Low', bias: 'Neutral', strength: 25,
      description: `Bollinger bands span ${f(width)}% of the 20-day average.${where}` })
  }

  // ── 52-week range ─────────────────────────────────────────────────────
  if (px && n(fd?.week_52_high) && n(fd?.week_52_low) && fd!.week_52_high! > fd!.week_52_low!) {
    const hi = fd!.week_52_high!, lo = fd!.week_52_low!
    const pos = ((px - lo) / (hi - lo)) * 100
    const offHigh = ((hi - px) / hi) * 100
    out.push({
      id: 'range', category: 'Technical', icon: 'range',
      title: pos >= 85 ? 'Near 52-Week High' : pos <= 15 ? 'Near 52-Week Low' : '52-Week Range',
      impact: pos >= 85 || pos <= 15 ? 'Medium' : 'Low',
      bias: pos >= 85 ? 'Bullish' : pos <= 15 ? 'Bearish' : 'Neutral',
      strength: clamp(pos >= 50 ? pos : 100 - pos),
      description: `At ${f(pos, 0)}% of its 52-week range ($${f(lo, 2)} – $${f(hi, 2)}), ${f(offHigh)}% below the high.`,
    })
  }

  // ── Valuation: P/E, forward P/E, PEG ──────────────────────────────────
  if (n(fd?.pe_ratio) && fd!.pe_ratio! > 0) {
    const pe = fd!.pe_ratio!, fpe = fd?.forward_pe, peg = fd?.peg_ratio
    const growthImplied = n(fpe) && fpe > 0 && fpe < pe
    const pegTxt = n(peg) && peg > 0 ? ` PEG ${f(peg, 2)}.` : ''
    const fwdTxt = n(fpe) && fpe > 0 ? ` Forward P/E ${f(fpe)}x${growthImplied ? ' — earnings expected to grow' : ''}.` : ''
    if (pe > 40 && !(n(peg) && peg > 0 && peg < 1.5)) out.push({ id: 'val', category: 'Valuation', icon: 'valuation', title: 'Premium Valuation', impact: pe > 60 ? 'High' : 'Medium', bias: 'Bearish',
      strength: clamp(40 + (pe - 40) * 0.8), description: `Trailing P/E ${f(pe)}x — well above the broad-market range (~20–25x).${fwdTxt}${pegTxt}` })
    else if ((n(peg) && peg > 0 && peg < 1) || pe < 15) out.push({ id: 'val', category: 'Valuation', icon: 'valuation', title: 'Attractive Valuation', impact: 'Medium', bias: 'Bullish',
      strength: clamp(n(peg) && peg > 0 ? 90 - peg * 40 : 70 - pe), description: `Trailing P/E ${f(pe)}x.${fwdTxt}${pegTxt} Price looks cheap relative to ${n(peg) && peg > 0 && peg < 1 ? 'expected growth' : 'earnings'}.` })
    else out.push({ id: 'val', category: 'Valuation', icon: 'valuation', title: 'Fair Valuation', impact: 'Low', bias: 'Neutral', strength: 30,
      description: `Trailing P/E ${f(pe)}x.${fwdTxt}${pegTxt}` })
  }

  // ── Quality: margins + ROE (percent numbers, e.g. 55.6 = 55.6%) ───────
  const pm = fd?.profit_margin, roe = fd?.roe, gm = fd?.gross_margin
  if (n(pm) || n(roe)) {
    const bits = [n(gm) ? `gross margin ${f(gm)}%` : '', n(pm) ? `net margin ${f(pm)}%` : '', n(roe) ? `ROE ${f(roe)}%` : ''].filter(Boolean).join(', ')
    const strong = (n(pm) && pm >= 20) || (n(roe) && roe >= 20)
    const weak = (n(pm) && pm < 0) || (n(roe) && roe < 0)
    out.push({
      id: 'quality', category: 'Quality', icon: 'quality',
      title: weak ? 'Unprofitable' : strong ? 'High Profitability' : 'Moderate Profitability',
      impact: weak || strong ? 'Medium' : 'Low',
      bias: weak ? 'Bearish' : strong ? 'Bullish' : 'Neutral',
      strength: clamp(weak ? 70 : strong ? 50 + Math.min(n(roe) ? roe : 0, 40) : 35),
      description: `${bits.charAt(0).toUpperCase()}${bits.slice(1)}.`,
    })
  }

  // ── Balance sheet: debt/equity + current ratio ────────────────────────
  const de = fd?.debt_to_equity, cr = fd?.current_ratio
  if (n(de) || n(cr)) {
    const risky = (n(de) && de > 2) || (n(cr) && cr < 1)
    const solid = (!n(de) || de < 0.5) && (!n(cr) || cr >= 1.5)
    const bits = [n(de) ? `debt/equity ${f(de, 2)}` : '', n(cr) ? `current ratio ${f(cr, 2)}` : ''].filter(Boolean).join(', ')
    out.push({
      id: 'balance', category: 'Balance Sheet', icon: 'shield',
      title: risky ? 'Leverage / Liquidity Risk' : solid ? 'Strong Balance Sheet' : 'Adequate Balance Sheet',
      impact: risky ? 'High' : solid ? 'Medium' : 'Low',
      bias: risky ? 'Bearish' : solid ? 'Bullish' : 'Neutral',
      strength: clamp(risky ? 70 : solid ? 65 : 35),
      description: `${bits.charAt(0).toUpperCase()}${bits.slice(1)}.${risky ? ' Elevated leverage or thin short-term liquidity.' : ''}`,
    })
  }

  // ── Analyst view: target upside + consensus (1 = strong buy … 5 = sell) ─
  const tgt = fd?.target_price
  const rec = fd?.recommendation !== undefined ? parseFloat(String(fd.recommendation)) : NaN
  if ((px && n(tgt) && tgt > 0) || Number.isFinite(rec)) {
    const upside = px && n(tgt) && tgt > 0 ? ((tgt - px) / px) * 100 : undefined
    const recTxt = Number.isFinite(rec) ? ` Consensus ${f(rec, 1)} (1 = strong buy, 5 = sell).` : ''
    const bullish = (upside !== undefined && upside >= 10) || (Number.isFinite(rec) && rec <= 2)
    const bearish = (upside !== undefined && upside <= -5) || (Number.isFinite(rec) && rec >= 3.5)
    out.push({
      id: 'analyst', category: 'Sentiment', icon: 'target',
      title: bullish && !bearish ? 'Analysts Bullish' : bearish && !bullish ? 'Analysts Cautious' : 'Analysts Mixed',
      impact: upside !== undefined && Math.abs(upside) >= 20 ? 'High' : 'Medium',
      bias: bullish && !bearish ? 'Bullish' : bearish && !bullish ? 'Bearish' : 'Neutral',
      strength: clamp(upside !== undefined ? 40 + Math.abs(upside) : 45),
      description: `${upside !== undefined ? `Mean target $${f(tgt!, 2)} implies ${upside >= 0 ? '+' : ''}${f(upside)}% from here.` : ''}${recTxt}`.trim(),
    })
  }

  // ── Beta ──────────────────────────────────────────────────────────────
  if (n(fd?.beta)) {
    const b = fd!.beta!
    if (b >= 1.5 || b <= 0.6) out.push({
      id: 'beta', category: 'Sentiment', icon: 'volatility',
      title: b >= 1.5 ? 'High Market Sensitivity' : 'Defensive Profile',
      impact: 'Low', bias: 'Neutral', strength: clamp(b >= 1.5 ? 30 + b * 15 : 60),
      description: `Beta ${f(b, 2)} — tends to move ${b >= 1.5 ? `about ${f(b, 1)}x` : 'less than'} the market.`,
    })
  }

  // ── Event: earnings (only a future date is "next"; a past one is "last reported") ─
  const et = earningsTiming(fd?.earnings_date, now)
  if (et?.kind === 'upcoming') {
    const soon = et.days <= 14
    out.push({ id: 'earnings', category: 'Event', icon: 'event', title: 'Earnings Event', impact: soon ? 'High' : 'Medium', bias: 'Neutral', strength: clamp(soon ? 75 - et.days : 40),
      description: `Next earnings: ${et.label}${et.days === 0 ? ' (today)' : ` (in ${et.days} day${et.days === 1 ? '' : 's'})`}. Expect larger price moves around the report.` })
  } else if (et?.kind === 'reported' && et.days <= 100) {
    out.push({ id: 'earnings', category: 'Event', icon: 'event', title: 'Earnings Reported', impact: 'Low', bias: 'Neutral', strength: 20,
      description: `Last reported: ${et.label} (${et.days} day${et.days === 1 ? '' : 's'} ago). Next date not yet confirmed.` })
  }

  return out.sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || b.strength - a.strength)
}

/** Net tilt across factors, weighted by impact: −100 (all bearish) … +100 (all bullish). */
export function netBias(factors: KeyFactor[]): number {
  const w: Record<FactorImpact, number> = { High: 3, Medium: 2, Low: 1 }
  let sum = 0, total = 0
  for (const x of factors) {
    total += w[x.impact]
    sum += x.bias === 'Bullish' ? w[x.impact] : x.bias === 'Bearish' ? -w[x.impact] : 0
  }
  return total ? Math.round((sum / total) * 100) : 0
}
