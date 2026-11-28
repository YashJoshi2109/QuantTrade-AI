/**
 * Facts, copy, metadata and JSON-LD for /stocks/{SYMBOL}.
 *
 * Every sentence is a template filled with a number from the backend. When a
 * number is missing (or fails the shared plausibility rules) the sentence is
 * skipped; nothing here is allowed to invent a value. The ML model is
 * research-grade and never presented as a prediction: the only forward-looking
 * figures are analyst consensus and the statistical price range, each labelled.
 */
import { sanitizeFundamentals } from '../fundamentalSanity'
import { formatMarketCap } from '../valuation'
import { researchHref, SITE_URL, stockPath, stockUrl, symbolToSlug } from './symbol'
import type { StockPageData } from './types'

/* ───────────────────────── formatting ───────────────────────── */

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pos = (v: unknown): number | null => (finite(v) && v > 0 ? v : null)
const num = (v: unknown): number | null => {
  if (finite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

export function money(v: number, digits = 2): string {
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function pct(v: number, digits = 2, signed = false): string {
  const s = Math.abs(v).toFixed(digits)
  if (!signed) return `${v < 0 ? '-' : ''}${s}%`
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${s}%`
}

export function bigMoney(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${a.toFixed(0)}`
}

export function bigCount(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  return Math.round(v).toLocaleString('en-US')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-27" (or an ISO timestamp) -> "Nov 27, 2026", read as a calendar date. */
export function formatDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!m) return null
  const mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  return `${MONTHS[mo - 1]} ${Number(m[3])}, ${m[1]}`
}

/** UTC ISO -> "Nov 27, 2026, 1:00 PM ET". */
export function formatEt(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const s = d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  return `${s} ET`
}

function isoDay(raw: string | null | undefined): string | null {
  const m = raw ? /^(\d{4}-\d{2}-\d{2})/.exec(raw) : null
  return m ? m[1] : null
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/* ───────────────────────── names ───────────────────────── */

const SUFFIX_RE =
  /[,\s]+(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.V\.|S\.A\.|SE|AG|Class [A-Z]|Cl [A-Z]|[A-Z])$/

/** "NVIDIA Corporation" -> "NVIDIA", "Berkshire Hathaway Inc. Class B" -> "Berkshire Hathaway". */
export function shortCompanyName(name: string): string {
  let s = name.trim().replace(/\s+/g, ' ')
  for (let i = 0; i < 4; i++) {
    const next = s.replace(SUFFIX_RE, '').trim()
    if (next === s || next.length < 2) break
    s = next
  }
  return s.replace(/[,.]$/, '')
}

/** "United States" -> "the United States"; most country names take no article. */
export function countryPhrase(country: string): string {
  return /^(United |Netherlands|Cayman|Bahamas|Philippines|Czech Republic)/.test(country) ? `the ${country}` : country
}

/** Title-case an ALL-CAPS SEC filer name; mixed-case names are left alone. */
export function readableFilerName(raw: string): string {
  return raw === raw.toUpperCase() && /[A-Z]{4,}/.test(raw) ? titleCaseFiler(raw) : raw
}

function titleCaseFiler(raw: string): string {
  // SEC filer names are upper case ("NVIDIA CORP"); keep short all-caps words (IBM, AMD).
  return raw
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

export function companyName(d: StockPageData): string {
  const candidates = [
    d.fundamentals?.company_name,
    d.symbolRow?.name,
    d.identity?.listed_name,
    d.overview?.company_name ? titleCaseFiler(d.overview.company_name) : null,
    d.identity?.filer_name ? titleCaseFiler(d.identity.filer_name) : null,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return d.symbol
}

export function isFund(d: StockPageData): boolean {
  const t = (d.fundamentals?.asset_type ?? '').toLowerCase()
  return t === 'etf' || t === 'fund' || (d.symbolRow?.sector ?? '').toUpperCase() === 'ETF'
}

/* ───────────────────────── facts ───────────────────────── */

export interface StockFacts {
  symbol: string
  slug: string
  name: string
  shortName: string
  fund: boolean
  sector: string | null
  industry: string | null
  country: string | null
  price: number | null
  change: number | null
  changePct: number | null
  sessionDate: string | null
  asOf: string | null
  quoteSource: string | null
  stale: boolean
  extended: { price: number; changePct: number | null; session: string } | null
  marketCap: number | null
  pe: number | null
  forwardPe: number | null
  eps: number | null
  grossMargin: number | null
  operatingMargin: number | null
  profitMargin: number | null
  roe: number | null
  beta: number | null
  debtToEquity: number | null
  dividendYield: number | null
  high52: number | null
  low52: number | null
  yearReturnPct: number | null
  yearReturnFrom: string | null
  sma50: number | null
  sma200: number | null
  rsi: number | null
  macd: number | null
  macdSignal: number | null
  target: number | null
  targetUpsidePct: number | null
  recScore: number | null
  recLabel: string | null
  dividend: {
    pays: boolean
    ttmTotal: number | null
    ttmCount: number | null
    frequency: string | null
    nextExDate: string | null
    nextPayDate: string | null
    lastExDate: string | null
    lastAmount: number | null
    source: string | null
  } | null
  earnings: {
    nextDate: string | null
    nextHour: string | null
    nextEpsEstimate: number | null
    last: { label: string; date: string; actual: number; estimate: number | null; surprisePct: number | null } | null
    beats: number
    quarters: number
    source: string | null
  } | null
  insiders: {
    days: number
    buys: number
    sells: number
    buyValue: number
    sellValue: number
    netValue: number
    distinctBuyers: number
    distinctSellers: number
    planSells: number | null
    latestFiling: string | null
    recent: Array<{ date: string; insider: string; title: string | null; type: string; shares: number | null; value: number | null; url: string | null }>
  } | null
  institutional: {
    period: string
    holders: number
    totalShares: number | null
    totalValue: number | null
    holdersChange: number | null
    sharesChangePct: number | null
    top: Array<{ filer: string; shares: number; value: number; changePct: number | null }>
  } | null
  forecast: {
    asOf: string | null
    horizonLabel: string
    date: string
    low: number
    high: number
    lowPct: number | null
    highPct: number | null
    edge: boolean
    hitRate: number | null
    tests: number | null
    benchmark: string
    mlNote: string | null
  } | null
  overview: { sic: string | null; state: string | null; fiscalYearEnd: string | null; cik: string | null } | null
  news: StockPageData['news']
  /** today's ET calendar date at data assembly, for "upcoming" checks */
  today: string
}

export function recommendationLabel(v: number): string {
  return v <= 1.5 ? 'Strong buy' : v <= 2.5 ? 'Buy' : v <= 3.5 ? 'Hold' : v <= 4.5 ? 'Sell' : 'Strong sell'
}

function etToday(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  return parts // en-CA formats as YYYY-MM-DD
}

export function buildFacts(d: StockPageData): StockFacts {
  const name = companyName(d)
  const q = d.quote
  const lastBar = d.bars.length ? d.bars[d.bars.length - 1] : null
  const price = pos(q?.regular?.price ?? q?.price) ?? pos(lastBar?.close)
  const fromQuote = pos(q?.regular?.price ?? q?.price) !== null
  const today = etToday(d.fetchedAt)

  const { values: f } = sanitizeFundamentals(d.fundamentals ?? null, price)
  const fund = isFund(d)

  const high52 = pos(f?.week_52_high)
  const low52 = pos(f?.week_52_low)

  // 12-month return only from a full year of daily bars (>= 240 sessions).
  let yearReturnPct: number | null = null
  let yearReturnFrom: string | null = null
  if (price !== null && d.bars.length >= 240) {
    const first = d.bars[Math.max(0, d.bars.length - 252)]
    if (first && first.close > 0) {
      yearReturnPct = (price / first.close - 1) * 100
      yearReturnFrom = isoDay(first.timestamp)
    }
  }

  const ind = d.indicators?.indicators
  const target = pos(f?.target_price)
  const recScore = num(f?.recommendation)
  const recOk = recScore !== null && recScore >= 1 && recScore <= 5

  let dividend: StockFacts['dividend'] = null
  const dv = d.dividends
  if (dv && dv.available !== false) {
    const payments = (dv.payments ?? []).filter((p) => finite(p.amount) && p.amount > 0)
    const last = payments.length ? payments[payments.length - 1] : null
    const ttm = pos(dv.ttm_total)
    dividend = {
      pays: ttm !== null,
      ttmTotal: ttm,
      ttmCount: finite(dv.ttm_count) ? dv.ttm_count : null,
      frequency: dv.frequency_label ?? null,
      nextExDate: dv.next_ex_date && dv.next_ex_date >= today ? dv.next_ex_date : null,
      nextPayDate: dv.next_pay_date && dv.next_pay_date >= today ? dv.next_pay_date : null,
      lastExDate: last?.ex_date ?? null,
      lastAmount: last?.amount ?? null,
      source: dv.source ?? null,
    }
  }

  let earnings: StockFacts['earnings'] = null
  if (!fund) {
    const quarters = (d.earningsHistory?.quarters ?? []).filter((x) => finite(x.eps_actual))
    const lastQ = quarters.length ? quarters[quarters.length - 1] : null
    const nextFromCal = d.earningsNext?.date && d.earningsNext.date >= today ? d.earningsNext.date : null
    const fundDate = isoDay(d.fundamentals?.earnings_date)
    const nextDate = nextFromCal ?? (fundDate && fundDate > today ? fundDate : null)
    const beats = quarters.filter((x) => finite(x.eps_estimate) && (x.eps_actual as number) > (x.eps_estimate as number)).length
    const withEst = quarters.filter((x) => finite(x.eps_estimate)).length
    if (nextDate || lastQ) {
      earnings = {
        nextDate,
        nextHour: nextFromCal ? d.earningsNext?.hour_label ?? null : null,
        nextEpsEstimate: nextFromCal && finite(d.earningsNext?.eps_estimate) ? (d.earningsNext?.eps_estimate as number) : null,
        last: lastQ
          ? {
              label: lastQ.label ?? formatDate(lastQ.period) ?? lastQ.period,
              date: lastQ.period,
              actual: lastQ.eps_actual as number,
              estimate: finite(lastQ.eps_estimate) ? lastQ.eps_estimate : null,
              surprisePct: finite(lastQ.surprise_pct) ? lastQ.surprise_pct : null,
            }
          : null,
        beats,
        quarters: withEst,
        source: d.earningsHistory?.source ?? null,
      }
    }
  }

  let insiders: StockFacts['insiders'] = null
  const w = d.insiders?.summary?.['90']
  if (w && finite(w.buy_transactions) && finite(w.sell_transactions)) {
    insiders = {
      days: w.days ?? 90,
      buys: w.buy_transactions,
      sells: w.sell_transactions,
      buyValue: w.buy_value ?? 0,
      sellValue: w.sell_value ?? 0,
      netValue: w.net_value ?? 0,
      distinctBuyers: w.distinct_buyers ?? 0,
      distinctSellers: w.distinct_sellers ?? 0,
      planSells: finite(w.sells_under_10b5_1_plan) ? w.sells_under_10b5_1_plan : null,
      latestFiling: d.insiders?.latest_filing ?? null,
      recent: (d.insiders?.transactions ?? [])
        .filter((t) => t.code === 'P' || t.code === 'S')
        .slice(0, 5)
        .map((t) => ({
          date: t.date,
          insider: t.insider,
          title: t.title ?? null,
          type: t.type ?? (t.code === 'P' ? 'Purchase' : 'Sale'),
          shares: finite(t.shares) ? t.shares : null,
          value: finite(t.value) ? t.value : null,
          url: t.url && /^https:\/\/www\.sec\.gov\//.test(t.url) ? t.url : null,
        })),
    }
  }

  let institutional: StockFacts['institutional'] = null
  const ins = d.institutional
  if (ins?.period && finite(ins.holders) && ins.holders > 0) {
    institutional = {
      period: ins.period,
      holders: ins.holders,
      totalShares: pos(ins.total_shares),
      totalValue: pos(ins.total_value_usd),
      holdersChange: finite(ins.qoq?.holders_change) ? (ins.qoq?.holders_change as number) : null,
      sharesChangePct: finite(ins.qoq?.shares_change_pct) ? (ins.qoq?.shares_change_pct as number) : null,
      top: (ins.top_holders ?? []).slice(0, 5).map((h) => ({
        filer: readableFilerName(h.filer),
        shares: h.shares,
        value: h.value_usd,
        changePct: finite(h.change_pct) ? h.change_pct : null,
      })),
    }
  }

  let forecast: StockFacts['forecast'] = null
  const h20 = d.forecast?.horizons?.find((h) => h.h === 20)
  if (h20 && Array.isArray(h20.range_80) && finite(h20.range_80[0]) && finite(h20.range_80[1])) {
    forecast = {
      asOf: d.forecast?.as_of ?? null,
      horizonLabel: h20.label || '1 month',
      date: h20.date,
      low: h20.range_80[0],
      high: h20.range_80[1],
      lowPct: finite(h20.range_80_pct?.[0]) ? (h20.range_80_pct?.[0] as number) : null,
      highPct: finite(h20.range_80_pct?.[1]) ? (h20.range_80_pct?.[1] as number) : null,
      edge: h20.edge === true,
      hitRate: finite(h20.hit_rate_80) ? h20.hit_rate_80 : null,
      tests: finite(h20.hit_rate_tests) ? h20.hit_rate_tests : null,
      benchmark: d.forecast?.benchmark ?? 'ARIMA(0,1,0)',
      mlNote: d.forecast?.ml_gate?.promoted === false ? d.forecast.ml_gate.note ?? null : null,
    }
  }

  const ov = d.overview
  const overview = ov && (ov.sic_description || ov.state_of_incorporation || ov.cik)
    ? {
        sic: ov.sic_description ?? null,
        state: ov.state_of_incorporation ?? null,
        fiscalYearEnd: ov.fiscal_year_end ?? null,
        cik: ov.cik ?? null,
      }
    : null

  return {
    symbol: d.symbol,
    slug: symbolToSlug(d.symbol) ?? d.symbol,
    name,
    shortName: shortCompanyName(name),
    fund,
    sector: f?.sector || (d.symbolRow?.sector && d.symbolRow.sector !== 'ETF' ? d.symbolRow.sector : null) || null,
    industry: f?.industry || d.symbolRow?.industry || null,
    country: f?.country || null,
    price,
    change: fromQuote ? num(q?.regular?.change ?? q?.change) : null,
    changePct: fromQuote ? num(q?.regular?.change_percent ?? q?.change_percent) : null,
    sessionDate: fromQuote ? q?.regular?.session_date ?? isoDay(q?.as_of) : isoDay(lastBar?.timestamp),
    asOf: fromQuote ? q?.as_of ?? null : lastBar?.timestamp ?? null,
    quoteSource: fromQuote ? q?.data_source ?? null : 'daily bars',
    stale: fromQuote ? q?.stale === true : true,
    extended:
      fromQuote && q?.extended && pos(q.extended.price) !== null && q.extended.session
        ? { price: q.extended.price, changePct: num(q.extended.change_percent), session: q.extended.session }
        : null,
    marketCap: pos(f?.market_cap),
    pe: pos(f?.pe_ratio),
    forwardPe: pos(f?.forward_pe),
    eps: num(f?.eps),
    grossMargin: num(f?.gross_margin),
    operatingMargin: num(f?.operating_margin),
    profitMargin: num(f?.profit_margin),
    roe: num(f?.roe),
    beta: num(f?.beta),
    debtToEquity: num(f?.debt_to_equity),
    dividendYield: num(f?.dividend_yield),
    high52,
    low52,
    yearReturnPct,
    yearReturnFrom,
    sma50: pos(ind?.sma_50),
    sma200: pos(ind?.sma_200),
    rsi: finite(ind?.rsi) && (ind?.rsi as number) >= 0 && (ind?.rsi as number) <= 100 ? (ind?.rsi as number) : null,
    macd: num(ind?.macd?.macd),
    macdSignal: num(ind?.macd?.signal),
    target,
    targetUpsidePct: target !== null && price !== null ? (target / price - 1) * 100 : null,
    recScore: recOk ? recScore : null,
    recLabel: recOk ? recommendationLabel(recScore as number) : null,
    dividend,
    earnings,
    insiders,
    institutional,
    forecast,
    overview,
    news: d.news,
    today,
  }
}

/* ───────────────────────── metadata ───────────────────────── */

const BRAND = ' | QuantTrade AI'
export const TITLE_MAX = 60

/** True when the page shows forward-looking numbers (analyst target or statistical range). */
export function hasForecastContent(f: Pick<StockFacts, 'target' | 'forecast'>): boolean {
  return f.target !== null || f.forecast !== null
}

/**
 * "{Company} ({TICKER}) Stock Price, Forecast & AI Analysis | QuantTrade AI",
 * shortened step by step until it fits in 60 characters. "Forecast" only
 * appears when the page has analyst targets or statistical ranges.
 */
export function buildTitle(f: Pick<StockFacts, 'symbol' | 'shortName' | 'fund' | 'target' | 'forecast'>): string {
  const T = f.symbol
  const name = f.shortName && f.shortName.toUpperCase() !== T ? f.shortName : ''
  const who = name ? `${name} (${T})` : T
  const kind = f.fund ? 'ETF' : 'Stock'
  const fc = hasForecastContent(f)
  const variants = fc
    ? [
        `${who} ${kind} Price, Forecast & AI Analysis`,
        `${who} ${kind} Price, Forecast & Analysis`,
        `${who} ${kind} Price & Forecast`,
        `${who} Price & Forecast`,
        `${T} ${kind} Price, Forecast & AI Analysis`,
        `${T} ${kind} Price & Forecast`,
      ]
    : [
        `${who} ${kind} Price & AI Analysis`,
        `${who} ${kind} Price & Analysis`,
        `${who} ${kind} Price`,
        `${T} ${kind} Price & AI Analysis`,
        `${T} ${kind} Price`,
      ]
  for (const v of variants) {
    if ((v + BRAND).length <= TITLE_MAX) return v + BRAND
  }
  // Very long names: drop the brand rather than cut the ticker.
  for (const v of variants) {
    if (v.length <= TITLE_MAX) return v
  }
  return `${T} ${kind} Price${BRAND}`
}

export const DESCRIPTION_MAX = 160

/** Join sentences, dropping trailing ones until the text fits in `max` characters. */
export function fitSentences(parts: string[], max: number): string {
  const kept = [...parts]
  while (kept.length > 1 && kept.join(' ').length > max) kept.pop()
  const text = kept.join(' ')
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

export function buildDescription(f: StockFacts): string {
  const parts: string[] = []
  const who = f.shortName && f.shortName.toUpperCase() !== f.symbol ? `${f.shortName} (${f.symbol})` : f.symbol
  if (f.price !== null) {
    const chg = f.changePct !== null ? ` (${pct(f.changePct, 2, true)})` : ''
    const on = formatDate(f.sessionDate)
    parts.push(`${who} ${f.stale ? 'last traded' : 'closed'} at ${money(f.price)}${chg}${on ? ` on ${on}` : ''}.`)
  } else {
    parts.push(`${who} stock data.`)
  }
  const stats: string[] = []
  if (f.marketCap !== null) stats.push(`market cap ${formatMarketCap(f.marketCap)}`)
  if (f.pe !== null) stats.push(`P/E ${f.pe.toFixed(1)}`)
  if (f.target !== null) stats.push(`analyst target ${money(f.target)}`)
  if (stats.length) parts.push(`${stats[0][0].toUpperCase()}${listJoin(stats).slice(1)}.`)
  parts.push(f.fund ? 'Price history, distributions, technicals and news.' : 'Earnings, dividends, insider trades, 13F owners and news.')
  return fitSentences(parts, DESCRIPTION_MAX)
}

/* ───────────────────────── body copy ───────────────────────── */

export interface Section {
  id: string
  heading: string
  sentences: string[]
}

function dirWord(v: number, up = 'up', down = 'down'): string {
  return v >= 0 ? up : down
}

export function buildSections(f: StockFacts): Section[] {
  const n = f.shortName || f.symbol
  const T = f.symbol
  const out: Section[] = []

  // Price
  const price: string[] = []
  if (f.price !== null) {
    const on = formatDate(f.sessionDate)
    let s = `${f.name} (${T}) ${f.stale ? 'last traded' : 'closed'} at ${money(f.price)}${on ? ` on ${on}` : ''}`
    if (f.change !== null && f.changePct !== null) {
      s += `, ${dirWord(f.change)} ${money(Math.abs(f.change))} (${pct(Math.abs(f.changePct))}) from the previous close`
    }
    price.push(`${s}.`)
    if (f.extended) {
      const label = f.extended.session
      price.push(
        `In ${label} trading the last print was ${money(f.extended.price)}${f.extended.changePct !== null ? ` (${pct(f.extended.changePct, 2, true)} vs the regular close)` : ''}.`,
      )
    }
    if (f.yearReturnPct !== null && f.yearReturnFrom) {
      price.push(
        `Over the past 12 months the ${f.fund ? 'fund' : 'stock'} is ${dirWord(f.yearReturnPct)} ${pct(Math.abs(f.yearReturnPct), 1)} (price change since ${formatDate(f.yearReturnFrom)}, excluding dividends).`,
      )
    }
    if (f.high52 !== null && f.low52 !== null && f.high52 >= f.low52) {
      const below = (1 - f.price / f.high52) * 100
      const above = (f.price / f.low52 - 1) * 100
      price.push(
        `Its 52-week range is ${money(f.low52)} to ${money(f.high52)}; the price is ${pct(Math.max(0, below), 1)} below the high and ${pct(Math.max(0, above), 1)} above the low.`,
      )
    }
  }
  if (price.length) out.push({ id: 'price', heading: `${T} price today`, sentences: price })

  // Profile + valuation
  const val: string[] = []
  if (f.fund) {
    val.push(`${f.name} is an exchange-traded fund (ETF) listed under the ticker ${T}.`)
    if (f.pe !== null) val.push(`The weighted price-to-earnings ratio of its holdings is ${f.pe.toFixed(1)}.`)
    if (f.dividendYield !== null && f.dividendYield > 0) val.push(`Its trailing distribution yield is ${pct(f.dividendYield)}.`)
  } else {
    if (f.industry && f.sector) {
      val.push(`${n} is classified in the ${f.industry} industry within the ${f.sector} sector${f.country ? `, with headquarters in ${countryPhrase(f.country)}` : ''}.`)
    } else if (f.overview?.sic) {
      val.push(`${n} files with the SEC under the industry code "${f.overview.sic}".`)
    }
    if (f.marketCap !== null) val.push(`Its market capitalization is ${formatMarketCap(f.marketCap)}.`)
    if (f.pe !== null) {
      let s = `The stock trades at ${f.pe.toFixed(1)} times trailing earnings`
      if (f.eps !== null) s += ` (EPS ${money(f.eps)})`
      if (f.forwardPe !== null) s += ` and ${f.forwardPe.toFixed(1)} times forward earnings estimates`
      val.push(`${s}.`)
    }
    const margins: string[] = []
    if (f.grossMargin !== null) margins.push(`a gross margin of ${pct(f.grossMargin, 1)}`)
    if (f.operatingMargin !== null) margins.push(`an operating margin of ${pct(f.operatingMargin, 1)}`)
    if (f.profitMargin !== null) margins.push(`a net profit margin of ${pct(f.profitMargin, 1)}`)
    if (margins.length) val.push(`Over the trailing twelve months it reported ${listJoin(margins)}.`)
    if (f.roe !== null) val.push(`Return on equity is ${pct(f.roe, 1)}.`)
    if (f.beta !== null && f.beta > 0) {
      const rel = f.beta > 1.1 ? 'more volatile than' : f.beta < 0.9 ? 'less volatile than' : 'about as volatile as'
      val.push(`With a beta of ${f.beta.toFixed(2)}, the stock has historically been ${rel} the overall market.`)
    }
  }
  if (val.length) out.push({ id: 'valuation', heading: f.fund ? `About the ${T} ETF` : `${n} valuation and fundamentals`, sentences: val })

  // Technicals
  const tech: string[] = []
  if (f.price !== null && f.sma50 !== null && f.sma200 !== null) {
    const r50 = f.price >= f.sma50 ? 'above' : 'below'
    const r200 = f.price >= f.sma200 ? 'above' : 'below'
    tech.push(
      r50 === r200
        ? `The price is ${r50} both its 50-day (${money(f.sma50)}) and 200-day (${money(f.sma200)}) simple moving averages.`
        : `The price is ${r50} its 50-day simple moving average (${money(f.sma50)}) and ${r200} its 200-day average (${money(f.sma200)}).`,
    )
  }
  if (f.rsi !== null) {
    const zone = f.rsi >= 70 ? 'above 70, a level traders read as overbought' : f.rsi <= 30 ? 'below 30, a level traders read as oversold' : 'between the 30 (oversold) and 70 (overbought) thresholds'
    tech.push(`The 14-day relative strength index (RSI) is ${f.rsi.toFixed(1)}, ${zone}.`)
  }
  if (f.macd !== null && f.macdSignal !== null) {
    tech.push(`MACD is ${f.macd.toFixed(2)}, ${f.macd >= f.macdSignal ? 'above' : 'below'} its signal line at ${f.macdSignal.toFixed(2)}.`)
  }
  if (tech.length) {
    tech.push('Technical indicators describe past price behaviour; they are not a prediction.')
    out.push({ id: 'technicals', heading: `${T} technical indicators`, sentences: tech })
  }

  // Analysts + statistical range
  const fwd: string[] = []
  if (f.recLabel && f.recScore !== null) {
    let s = `The analyst consensus rating is ${f.recLabel} (${f.recScore.toFixed(1)} on a 1 to 5 scale, where 1 is strong buy)`
    if (f.target !== null) s += ` with an average 12-month price target of ${money(f.target)}`
    if (f.targetUpsidePct !== null) s += `, ${pct(Math.abs(f.targetUpsidePct), 1)} ${f.targetUpsidePct >= 0 ? 'above' : 'below'} the current price`
    fwd.push(`${s}.`)
  } else if (f.target !== null) {
    fwd.push(`The average analyst 12-month price target is ${money(f.target)}${f.targetUpsidePct !== null ? `, ${pct(Math.abs(f.targetUpsidePct), 1)} ${f.targetUpsidePct >= 0 ? 'above' : 'below'} the current price` : ''}.`)
  }
  if (f.forecast) {
    const fc = f.forecast
    fwd.push(
      `QuantTrade's statistical model puts ${T} between ${money(fc.low)} and ${money(fc.high)} on ${formatDate(fc.date)} (${fc.horizonLabel} ahead) with 80% probability${fc.lowPct !== null && fc.highPct !== null ? `, a move of ${pct(fc.lowPct, 1, true)} to ${pct(fc.highPct, 1, true)}` : ''}.`,
    )
    fwd.push(
      fc.edge
        ? `At this horizon the model beat the ${fc.benchmark} random-walk benchmark in walk-forward tests.`
        : `In walk-forward tests the model showed no edge over the ${fc.benchmark} random walk at this horizon, so the range, not a midpoint, is the forecast.`,
    )
    if (fc.hitRate !== null && fc.tests) {
      fwd.push(`In ${fc.tests} back-tests the real price landed inside the 80% range ${pct(fc.hitRate * 100, 0)} of the time.`)
    }
  }
  if (f.forecast?.mlNote || f.forecast) {
    fwd.push('Our machine-learning price model is research-grade and has not passed its validation gate, so no ML buy or sell signal is shown.')
  }
  if (fwd.length) out.push({ id: 'outlook', heading: `${T} analyst targets and price range`, sentences: fwd })

  // Earnings + dividends
  const ed: string[] = []
  if (f.earnings?.last) {
    const l = f.earnings.last
    let s = `${n} last reported quarterly earnings on ${formatDate(l.date) ?? l.label}: EPS of ${money(l.actual)}`
    if (l.estimate !== null) s += ` against an estimate of ${money(l.estimate)}`
    if (l.surprisePct !== null && l.estimate !== null) s += `, ${l.surprisePct >= 0 ? 'beating' : 'missing'} it by ${pct(Math.abs(l.surprisePct), 1)}`
    ed.push(`${s}.`)
    if (f.earnings.quarters >= 4) ed.push(`It beat the EPS estimate in ${f.earnings.beats} of the last ${f.earnings.quarters} quarters.`)
  }
  if (f.earnings?.nextDate) {
    ed.push(`The next earnings report is expected on ${formatDate(f.earnings.nextDate)}${f.earnings.nextHour ? ` (${f.earnings.nextHour.toLowerCase()})` : ''}${f.earnings.nextEpsEstimate !== null ? `, with analysts expecting EPS of ${money(f.earnings.nextEpsEstimate)}` : ''}.`)
  }
  if (f.dividend) {
    const dv = f.dividend
    if (dv.pays && dv.ttmTotal !== null) {
      let s = `${n} pays a${dv.frequency ? ` ${dv.frequency.toLowerCase()}` : ''} dividend: ${money(dv.ttmTotal, dv.ttmTotal < 1 ? 3 : 2)} per share over the last 12 months`
      if (f.dividendYield !== null && f.dividendYield > 0) s += ` (a ${pct(f.dividendYield)} yield)`
      ed.push(`${s}.`)
      if (dv.nextExDate) ed.push(`The next ex-dividend date is ${formatDate(dv.nextExDate)}${dv.nextPayDate ? `, payable ${formatDate(dv.nextPayDate)}` : ''}.`)
    } else {
      ed.push(`${n} has not paid a dividend in the last 12 months.`)
    }
  }
  if (ed.length) out.push({ id: 'earnings', heading: f.fund ? `${T} distributions` : `${n} earnings and dividends`, sentences: ed })

  // Ownership
  const own: string[] = []
  if (f.insiders) {
    const i = f.insiders
    if (i.buys === 0 && i.sells === 0) {
      own.push(`No open-market insider purchases or sales of ${T} were reported to the SEC in the last ${i.days} days.`)
    } else {
      let s = `In the last ${i.days} days, insiders reported ${i.buys} open-market purchase${i.buys === 1 ? '' : 's'}${i.buyValue > 0 ? ` (${bigMoney(i.buyValue)})` : ''} and ${i.sells} sale${i.sells === 1 ? '' : 's'}${i.sellValue > 0 ? ` (${bigMoney(i.sellValue)})` : ''} on SEC Form 4`
      if (i.planSells !== null && i.sells > 0) s += `; ${i.planSells} of the sales were made under pre-arranged Rule 10b5-1 plans`
      own.push(`${s}.`)
    }
  }
  if (f.institutional) {
    const h = f.institutional
    let s = `For the quarter ended ${formatDate(h.period)}, ${h.holders.toLocaleString('en-US')} institutional managers reported ${T} on Form 13F`
    if (h.totalShares !== null) s += `, holding ${bigCount(h.totalShares)} shares`
    if (h.totalValue !== null) s += ` worth ${bigMoney(h.totalValue)}`
    own.push(`${s}.`)
    if (h.sharesChangePct !== null) {
      own.push(`Reported institutional shares ${h.sharesChangePct >= 0 ? 'rose' : 'fell'} ${pct(Math.abs(h.sharesChangePct), 1)} from the prior quarter${h.holdersChange !== null ? `, and the number of holders changed by ${h.holdersChange >= 0 ? '+' : ''}${h.holdersChange.toLocaleString('en-US')}` : ''}.`)
    }
    if (h.top.length >= 3) own.push(`The largest reported holders were ${listJoin(h.top.slice(0, 3).map((t) => t.filer))}.`)
  }
  if (own.length) out.push({ id: 'ownership', heading: `Who owns ${T}`, sentences: own })

  return out
}

/* ───────────────────────── FAQ ───────────────────────── */

export interface FaqItem {
  q: string
  a: string
}

export function buildFaq(f: StockFacts): FaqItem[] {
  const T = f.symbol
  const n = f.shortName || T
  const out: FaqItem[] = []

  if (f.price !== null) {
    const on = formatDate(f.sessionDate)
    out.push({
      q: `What is ${T}'s stock price today?`,
      a: `${n} (${T}) ${f.stale ? 'last traded' : 'closed'} at ${money(f.price)}${on ? ` on ${on}` : ''}${f.changePct !== null ? `, ${pct(f.changePct, 2, true)} on the day` : ''}.${f.high52 !== null && f.low52 !== null ? ` Its 52-week range is ${money(f.low52)} to ${money(f.high52)}.` : ''}`,
    })
  }

  if (!f.fund && f.earnings) {
    const e = f.earnings
    let a: string
    if (e.nextDate) {
      a = `${n}'s next earnings report is expected on ${formatDate(e.nextDate)}${e.nextHour ? ` (${e.nextHour.toLowerCase()})` : ''}.`
    } else {
      a = `There is no confirmed upcoming earnings date for ${T} in our calendar yet.`
    }
    if (e.last) {
      a += ` The most recent report, on ${formatDate(e.last.date) ?? e.last.label}, showed EPS of ${money(e.last.actual)}${e.last.estimate !== null ? ` vs an estimate of ${money(e.last.estimate)}` : ''}.`
    }
    out.push({ q: `When is ${T}'s next earnings date?`, a })
  }

  if (f.dividend) {
    const dv = f.dividend
    out.push({
      q: `Does ${T} pay a dividend?`,
      a: dv.pays && dv.ttmTotal !== null
        ? `Yes. ${n} paid ${money(dv.ttmTotal, dv.ttmTotal < 1 ? 3 : 2)} per share in dividends over the last 12 months${dv.frequency ? ` (${dv.frequency.toLowerCase()})` : ''}${f.dividendYield !== null && f.dividendYield > 0 ? `, a yield of ${pct(f.dividendYield)}` : ''}.${dv.nextExDate ? ` The next ex-dividend date is ${formatDate(dv.nextExDate)}.` : dv.lastExDate && dv.lastAmount !== null ? ` The last payment of ${money(dv.lastAmount, dv.lastAmount < 1 ? 3 : 2)} went ex-dividend on ${formatDate(dv.lastExDate)}.` : ''}`
        : `No. ${n} has not paid a dividend in the last 12 months.`,
    })
  }

  if (f.target !== null) {
    out.push({
      q: `What is the analyst price target for ${T}?`,
      a: `The average analyst 12-month price target for ${T} is ${money(f.target)}${f.targetUpsidePct !== null ? `, ${pct(Math.abs(f.targetUpsidePct), 1)} ${f.targetUpsidePct >= 0 ? 'above' : 'below'} the latest price` : ''}.${f.recLabel && f.recScore !== null ? ` The consensus rating is ${f.recLabel} (${f.recScore.toFixed(1)} of 5, where 1 is strong buy).` : ''} Analyst targets are opinions, not guarantees.`,
    })
  }

  if (!f.fund && (f.marketCap !== null || f.pe !== null)) {
    const bits: string[] = []
    if (f.marketCap !== null) bits.push(`a market capitalization of ${formatMarketCap(f.marketCap)}`)
    if (f.pe !== null) bits.push(`a trailing P/E ratio of ${f.pe.toFixed(1)}`)
    if (f.forwardPe !== null) bits.push(`a forward P/E of ${f.forwardPe.toFixed(1)}`)
    out.push({ q: `What is ${T}'s market cap and P/E ratio?`, a: `${n} has ${listJoin(bits)}.` })
  }

  if (f.insiders) {
    const i = f.insiders
    out.push({
      q: `Are insiders buying or selling ${T} stock?`,
      a: i.buys === 0 && i.sells === 0
        ? `No open-market insider purchases or sales were reported on SEC Form 4 in the last ${i.days} days.`
        : `In the last ${i.days} days insiders reported ${i.buys} open-market purchase${i.buys === 1 ? '' : 's'} and ${i.sells} sale${i.sells === 1 ? '' : 's'} (net ${i.netValue >= 0 ? '' : '-'}${bigMoney(Math.abs(i.netValue))}), according to SEC Form 4 filings${i.planSells !== null && i.sells > 0 ? `; ${i.planSells} sales were under Rule 10b5-1 plans` : ''}.`,
    })
  }

  if (f.institutional && f.institutional.top.length) {
    const h = f.institutional
    out.push({
      q: `Who are the largest institutional holders of ${T}?`,
      a: `As of the ${formatDate(h.period)} 13F filings, the largest reported holders were ${listJoin(h.top.slice(0, 3).map((t) => `${t.filer} (${bigCount(t.shares)} shares)`))}. ${h.holders.toLocaleString('en-US')} institutions reported a position in total.`,
    })
  }

  if (f.forecast || f.target !== null) {
    const parts: string[] = []
    if (f.forecast) {
      parts.push(`Our statistical model gives an 80% range of ${money(f.forecast.low)} to ${money(f.forecast.high)} for ${formatDate(f.forecast.date)}.`)
      parts.push(f.forecast.edge
        ? `At that horizon it beat a random walk in back-tests.`
        : `It showed no edge over a random walk in back-tests, so treat it as a volatility range, not a direction call.`)
    }
    if (f.target !== null) parts.push(`Analysts' average 12-month target is ${money(f.target)}.`)
    parts.push('Our ML model is research-grade and is not used for any prediction. This is not financial advice.')
    out.push({ q: `What is the ${T} stock forecast?`, a: parts.join(' ') })
  }

  return out
}

/* ───────────────────────── JSON-LD ───────────────────────── */

export function buildJsonLd(f: StockFacts, opts: { title: string; description: string; faq: FaqItem[]; dateModified: string }) {
  const url = stockUrl(f.symbol) ?? `${SITE_URL}/stocks/${f.slug}`
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Stocks', item: `${SITE_URL}/stocks` },
        { '@type': 'ListItem', position: 3, name: f.symbol, item: url },
      ],
    },
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: opts.title,
      description: opts.description,
      dateModified: opts.dateModified,
      inLanguage: 'en-US',
      isPartOf: { '@type': 'WebSite', name: 'QuantTrade AI', url: SITE_URL },
      breadcrumb: { '@id': `${url}#breadcrumb` },
      ...(f.fund
        ? {}
        : { about: { '@type': 'Corporation', name: f.name, tickerSymbol: f.symbol } }),
    },
  ]
  if (opts.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: opts.faq.map((x) => ({
        '@type': 'Question',
        name: x.q,
        acceptedAnswer: { '@type': 'Answer', text: x.a },
      })),
    })
  }
  return { '@context': 'https://schema.org', '@graph': graph }
}

/** JSON for a <script type="application/ld+json">, safe against `</script>` injection. */
export function jsonLdString(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

/* ───────────────────────── links ───────────────────────── */

export { researchHref, stockPath }
