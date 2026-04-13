import { NextRequest, NextResponse } from 'next/server'
import { sanitizeQuoteSummaryCompanyName } from '@/lib/company-display-name'
import { incrementFmpUsage } from '@/lib/fmp-usage'

/**
 * Universal Ticker Info API
 * Fetches comprehensive data for any global stock/index via Yahoo Finance
 * Covers all 53,795+ publicly listed companies
 *
 * Includes full company profile: officers, address, financials, margins,
 * cash flow, shareholders for the Company Bio section.
 */

export interface CompanyOfficer {
  name: string
  title: string
  age: number | null
  totalPay: number | null
}

export interface TickerInfo {
  symbol: string
  name: string
  exchange: string
  exchange_display: string
  currency: string
  country: string
  sector: string
  industry: string
  market_cap: number
  employees: number
  description: string
  website: string
  // Company profile
  address: string
  city: string
  state: string
  zip: string
  phone: string
  officers: CompanyOfficer[]
  // Price data
  price: number
  change: number
  change_percent: number
  prev_close: number
  open: number
  day_high: number
  day_low: number
  week_52_high: number
  week_52_low: number
  volume: number
  avg_volume: number
  // Fundamentals
  pe_ratio: number
  forward_pe: number
  eps: number
  forward_eps: number
  dividend_yield: number
  dividend_rate: number
  peg_ratio: number
  price_to_book: number
  price_to_sales: number
  debt_to_equity: number
  return_on_equity: number
  return_on_assets: number
  revenue: number
  revenue_growth: number
  gross_profit: number
  gross_margins: number
  operating_margins: number
  profit_margins: number
  ebitda: number
  ebitda_margins: number
  net_income: number
  operating_cashflow: number
  free_cash_flow: number
  total_cash: number
  total_debt: number
  beta: number
  enterprise_value: number
  enterprise_to_revenue: number
  enterprise_to_ebitda: number
  shares_outstanding: number
  float_shares: number
  held_percent_insiders: number
  held_percent_institutions: number
  short_ratio: number
  short_percent_of_float: number
  // Analyst data
  target_price: number
  target_high: number
  target_low: number
  recommendation: string
  analyst_count: number
  // Dates
  ex_dividend_date: string
  earnings_date: string
  /** Year or label when available from Yahoo asset profile */
  founded: string
}

const YAHOO_QUOTE_MODULES = [
  'summaryDetail',
  'financialData',
  'defaultKeyStatistics',
  'assetProfile',
  'price',
  'summaryProfile',
  'calendarEvents',
].join(',')

const YAHOO_BROWSER_HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
}

/** Parse Yahoo quoteSummary JSON (direct or backend proxy) into TickerInfo. */
function parseYahooQuoteSummaryJson(payload: unknown, symbol: string): TickerInfo | null {
  try {
    const data = payload as { quoteSummary?: { result?: unknown[] } }
    const result = data?.quoteSummary?.result?.[0] as Record<string, unknown> | undefined
    if (!result) return null

    const price = (result.price ?? {}) as Record<string, unknown>
    const summary = (result.summaryDetail ?? {}) as Record<string, unknown>
    const financial = (result.financialData ?? {}) as Record<string, unknown>
    const keyStats = (result.defaultKeyStatistics ?? {}) as Record<string, unknown>
    const profile = (result.assetProfile ?? result.summaryProfile ?? {}) as Record<string, unknown>
    const calendar = (result.calendarEvents ?? {}) as Record<string, unknown>
    const prof = profile as Record<string, unknown>
    const foundedRaw = prof.yearFounded ?? prof.founded
    const founded =
      typeof foundedRaw === 'number' && foundedRaw > 0
        ? String(Math.round(foundedRaw))
        : typeof foundedRaw === 'string'
          ? foundedRaw.trim()
          : ''

    const getVal = (obj: Record<string, unknown>, key: string): number => {
      const v = (obj as Record<string, { raw?: number } | number | undefined>)[key]
      if (typeof v === 'number') return v
      if (v && typeof v === 'object' && 'raw' in v) return (v as { raw?: number }).raw ?? 0
      return 0
    }

    const getStr = (obj: Record<string, unknown>, key: string): string => {
      const v = obj[key]
      if (typeof v === 'string') return v
      if (v && typeof v === 'object' && 'longFmt' in v) return String((v as Record<string, unknown>).longFmt ?? '')
      if (v && typeof v === 'object' && 'fmt' in v) return String((v as Record<string, unknown>).fmt ?? '')
      return ''
    }

    const regularPrice = getVal(price, 'regularMarketPrice')
    const prevClose = getVal(price, 'regularMarketPreviousClose') || getVal(summary, 'previousClose')
    const change = regularPrice - prevClose
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0

    // Parse company officers
    const officers: CompanyOfficer[] = []
    const companyOfficersRaw = profile.companyOfficers
    if (Array.isArray(companyOfficersRaw)) {
      for (const o of companyOfficersRaw.slice(0, 8)) {
        const row = o as { name?: string; title?: string; age?: number | null; totalPay?: { raw?: number } }
        officers.push({
          name: String(row.name ?? ''),
          title: String(row.title ?? ''),
          age: row.age ?? null,
          totalPay: row.totalPay?.raw ?? null,
        })
      }
    }

    // Parse earnings date
    let earningsDate = ''
    const calEarnings = calendar.earnings as { earningsDate?: Array<{ fmt?: string }> } | undefined
    const earningsDates = calEarnings?.earningsDate
    if (Array.isArray(earningsDates) && earningsDates.length > 0) {
      const ed = earningsDates[0]
      earningsDate = ed?.fmt ?? ''
    }

    // Parse ex-dividend date
    const exDivRawUnknown = summary.exDividendDate ?? keyStats.lastDividendDate
    let exDividendDate = ''
    if (typeof exDivRawUnknown === 'object' && exDivRawUnknown !== null && 'fmt' in exDivRawUnknown) {
      exDividendDate = String((exDivRawUnknown as { fmt?: string }).fmt ?? '')
    }

    const rawName = String(price.longName ?? price.shortName ?? symbol)
    const displayName = sanitizeQuoteSummaryCompanyName(rawName, symbol)

    return {
      symbol: String(price.symbol ?? symbol),
      name: displayName,
      exchange: String(price.exchange ?? ''),
      exchange_display: String(price.exchangeName ?? price.exchange ?? ''),
      currency: String(price.currency ?? summary.currency ?? 'USD'),
      country: String(profile.country ?? ''),
      sector: String(profile.sector ?? ''),
      industry: String(profile.industry ?? ''),
      market_cap: getVal(price, 'marketCap') || getVal(summary, 'marketCap'),
      employees: getVal(profile as unknown as Record<string, unknown>, 'fullTimeEmployees'),
      description: String(profile.longBusinessSummary ?? ''),
      website: String(profile.website ?? ''),
      // Company profile
      address: String(profile.address1 ?? ''),
      city: String(profile.city ?? ''),
      state: String(profile.state ?? ''),
      zip: String(profile.zip ?? ''),
      phone: String(profile.phone ?? ''),
      officers,
      // Price
      price: regularPrice,
      change,
      change_percent: changePct,
      prev_close: prevClose,
      open: getVal(price, 'regularMarketOpen') || getVal(summary, 'open'),
      day_high: getVal(price, 'regularMarketDayHigh') || getVal(summary, 'dayHigh'),
      day_low: getVal(price, 'regularMarketDayLow') || getVal(summary, 'dayLow'),
      week_52_high: getVal(summary, 'fiftyTwoWeekHigh'),
      week_52_low: getVal(summary, 'fiftyTwoWeekLow'),
      volume: getVal(price, 'regularMarketVolume') || getVal(summary, 'volume'),
      avg_volume: getVal(summary, 'averageVolume') || getVal(summary, 'averageVolume10days'),
      // Fundamentals
      pe_ratio: getVal(summary, 'trailingPE') || getVal(price, 'trailingPE'),
      forward_pe: getVal(summary, 'forwardPE'),
      eps: getVal(keyStats, 'trailingEps'),
      forward_eps: getVal(keyStats, 'forwardEps'),
      dividend_yield: getVal(summary, 'dividendYield') * 100,
      dividend_rate: getVal(summary, 'dividendRate'),
      peg_ratio: getVal(keyStats, 'pegRatio'),
      price_to_book: getVal(keyStats, 'priceToBook'),
      price_to_sales: getVal(keyStats, 'priceToSalesTrailing12Months'),
      debt_to_equity: getVal(financial, 'debtToEquity'),
      return_on_equity: getVal(financial, 'returnOnEquity') * 100,
      return_on_assets: getVal(financial, 'returnOnAssets') * 100,
      revenue: getVal(financial, 'totalRevenue'),
      revenue_growth: getVal(financial, 'revenueGrowth') * 100,
      gross_profit: getVal(financial, 'grossProfits'),
      gross_margins: getVal(financial, 'grossMargins') * 100,
      operating_margins: getVal(financial, 'operatingMargins') * 100,
      profit_margins: getVal(financial, 'profitMargins') * 100,
      ebitda: getVal(financial, 'ebitda'),
      ebitda_margins: getVal(financial, 'ebitdaMargins') * 100,
      net_income: getVal(keyStats, 'netIncomeToCommon'),
      operating_cashflow: getVal(financial, 'operatingCashflow'),
      free_cash_flow: getVal(financial, 'freeCashflow'),
      total_cash: getVal(financial, 'totalCash'),
      total_debt: getVal(financial, 'totalDebt'),
      beta: getVal(summary, 'beta') || getVal(keyStats, 'beta'),
      enterprise_value: getVal(keyStats, 'enterpriseValue'),
      enterprise_to_revenue: getVal(keyStats, 'enterpriseToRevenue'),
      enterprise_to_ebitda: getVal(keyStats, 'enterpriseToEbitda'),
      shares_outstanding: getVal(keyStats, 'sharesOutstanding'),
      float_shares: getVal(keyStats, 'floatShares'),
      held_percent_insiders: getVal(keyStats, 'heldPercentInsiders') * 100,
      held_percent_institutions: getVal(keyStats, 'heldPercentInstitutions') * 100,
      short_ratio: getVal(keyStats, 'shortRatio'),
      short_percent_of_float: getVal(keyStats, 'shortPercentOfFloat') * 100,
      // Analyst
      target_price: getVal(financial, 'targetMeanPrice'),
      target_high: getVal(financial, 'targetHighPrice'),
      target_low: getVal(financial, 'targetLowPrice'),
      recommendation: getStr(financial, 'recommendationKey'),
      analyst_count: getVal(financial, 'numberOfAnalystOpinions'),
      // Dates
      ex_dividend_date: exDividendDate,
      earnings_date: earningsDate,
      founded,
    }
  } catch {
    return null
  }
}

async function fetchYahooQuoteSummaryDirect(sym: string): Promise<TickerInfo | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${YAHOO_QUOTE_MODULES}`
    const res = await fetch(url, { headers: YAHOO_BROWSER_HEADERS, cache: 'no-store' })
    if (!res.ok) return null
    const json: unknown = await res.json()
    return parseYahooQuoteSummaryJson(json, sym)
  } catch {
    return null
  }
}

async function fetchYahooQuoteSummaryViaBackend(sym: string): Promise<TickerInfo | null> {
  const base = (process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')
  if (!base) return null
  try {
    const url = `${base}/api/v1/market/yahoo-quote-summary/${encodeURIComponent(sym)}`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) return null
    const json: unknown = await res.json()
    return parseYahooQuoteSummaryJson(json, sym)
  } catch {
    return null
  }
}

// ─── FMP Stable API (primary data source) ──────────────────────────────────────
//
// One ticker load uses up to four parallel /stable requests (each returns a different slice):
//   profile        — sector, description, address, CEO name, employees, …
//   quote          — live price, change, volume, shares outstanding, 52W range
//   ratios-ttm     — margins, ROE, P/E, EV multiples, dividend yield (TTM)
//   key-executives — officer list for the Company Folio strip
// FMP does not expose one URL that returns this full depth for arbitrary symbols, so four
// HTTP calls are intentional. Usage is incremented only for responses that return HTTP 200.

async function fetchFmpFullProfile(sym: string): Promise<TickerInfo | null> {
  const fmpKey = process.env.FMP_API_KEY
  if (!fmpKey) return null

  const base = 'https://financialmodelingprep.com/stable'
  const qs = `apikey=${fmpKey}`

  try {
    const [profileRes, quoteRes, ratiosRes, execsRes] = await Promise.all([
      fetch(`${base}/profile?symbol=${sym}&${qs}`, { next: { revalidate: 900 } }).catch(() => null),
      fetch(`${base}/quote?symbol=${sym}&${qs}`, { next: { revalidate: 120 } }).catch(() => null),
      fetch(`${base}/ratios-ttm?symbol=${sym}&${qs}`, { next: { revalidate: 900 } }).catch(() => null),
      fetch(`${base}/key-executives?symbol=${sym}&${qs}`, { next: { revalidate: 3600 } }).catch(() => null),
    ])

    const fmpSuccessCount = [profileRes, quoteRes, ratiosRes, execsRes].filter((r) => r?.ok).length
    if (fmpSuccessCount > 0) incrementFmpUsage(fmpSuccessCount)

    const profileArr = profileRes?.ok ? await profileRes.json().catch(() => []) : []
    const quoteArr = quoteRes?.ok ? await quoteRes.json().catch(() => []) : []
    const ratiosArr = ratiosRes?.ok ? await ratiosRes.json().catch(() => []) : []
    const execsArr = execsRes?.ok ? await execsRes.json().catch(() => []) : []

    const p = Array.isArray(profileArr) ? profileArr[0] : null
    const q = Array.isArray(quoteArr) ? quoteArr[0] : null
    const r = Array.isArray(ratiosArr) ? ratiosArr[0] : null

    if (!p && !q) return null // need at least one

    const n = (v: unknown, fallback = 0): number =>
      typeof v === 'number' && isFinite(v) ? v : fallback
    const s = (v: unknown, fallback = ''): string =>
      typeof v === 'string' ? v : fallback

    const price = n(q?.price) || n(p?.price)
    const prevClose = n(q?.previousClose)
    const change = n(q?.change, price - prevClose)
    const changePct = n(q?.changePercentage)

    // Parse executives
    const officers: CompanyOfficer[] = []
    if (Array.isArray(execsArr)) {
      for (const o of execsArr.slice(0, 8)) {
        officers.push({
          name: s(o?.name),
          title: s(o?.title),
          age: typeof o?.yearBorn === 'number' ? new Date().getFullYear() - o.yearBorn : null,
          totalPay: n(o?.pay) || null,
        })
      }
    }
    // If no executives endpoint data, add CEO from profile
    if (!officers.length && p?.ceo) {
      officers.push({ name: s(p.ceo), title: 'Chief Executive Officer', age: null, totalPay: null })
    }

    const displayName = sanitizeQuoteSummaryCompanyName(
      s(p?.companyName) || s(q?.name) || sym,
      sym,
    )

    // Parse 52W range from profile "range" field: "95.04-212.19"
    let w52High = n(q?.yearHigh)
    let w52Low = n(q?.yearLow)
    if ((!w52High || !w52Low) && typeof p?.range === 'string') {
      const parts = p.range.split('-').map(Number)
      if (parts.length === 2 && parts.every((x: number) => x > 0)) {
        w52Low = w52Low || parts[0]
        w52High = w52High || parts[1]
      }
    }

    // Parse earningsAnnouncement from quote
    let earningsDate = ''
    if (q?.earningsAnnouncement) {
      try {
        earningsDate = new Date(q.earningsAnnouncement).toISOString().split('T')[0]
      } catch { /* ignore */ }
    }

    return {
      symbol: sym,
      name: displayName,
      exchange: s(p?.exchange) || s(q?.exchange),
      exchange_display: s(p?.exchangeFullName) || s(q?.exchange),
      currency: s(p?.currency, 'USD'),
      country: s(p?.country),
      sector: s(p?.sector),
      industry: s(p?.industry),
      market_cap: n(q?.marketCap) || n(p?.marketCap),
      employees: n(p?.fullTimeEmployees),
      description: s(p?.description),
      website: s(p?.website),
      address: s(p?.address),
      city: s(p?.city),
      state: s(p?.state),
      zip: s(p?.zip),
      phone: s(p?.phone),
      officers,
      // Price
      price,
      change,
      change_percent: changePct,
      prev_close: prevClose,
      open: n(q?.open),
      day_high: n(q?.dayHigh),
      day_low: n(q?.dayLow),
      week_52_high: w52High,
      week_52_low: w52Low,
      volume: n(q?.volume) || n(p?.volume),
      avg_volume: n(q?.avgVolume) || n(p?.averageVolume),
      // Fundamentals from ratios-ttm
      pe_ratio: r ? (n(r.earningsYieldTTM) > 0 ? 1 / n(r.earningsYieldTTM) : 0) : 0,
      forward_pe: r ? n(r.forwardPriceToEarningsGrowthRatioTTM) : 0,
      eps: r ? n(r.netIncomePerShareTTM) : 0,
      forward_eps: 0,
      dividend_yield: r ? n(r.dividendYieldTTM) * 100 : n(p?.lastDividend) > 0 && price > 0 ? (n(p.lastDividend) / price) * 100 : 0,
      dividend_rate: n(r?.dividendPerShareTTM) || n(p?.lastDividend),
      peg_ratio: r ? n(r.forwardPriceToEarningsGrowthRatioTTM) : 0,
      price_to_book: r ? n(r.priceToBookRatioTTM) : 0,
      price_to_sales: r ? n(r.priceToSalesRatioTTM) : 0,
      debt_to_equity: r ? n(r.debtEquityRatioTTM) * 100 : 0,
      return_on_equity: r ? n(r.returnOnEquityTTM) * 100 : 0,
      return_on_assets: r ? n(r.returnOnAssetsTTM) * 100 : 0,
      revenue: r ? n(r.revenuePerShareTTM) * n(q?.sharesOutstanding || 0) : 0,
      revenue_growth: 0,
      gross_profit: 0,
      gross_margins: r ? n(r.grossProfitMarginTTM) * 100 : 0,
      operating_margins: r ? n(r.operatingProfitMarginTTM) * 100 : 0,
      profit_margins: r ? n(r.netProfitMarginTTM) * 100 : 0,
      ebitda: 0,
      ebitda_margins: r ? n(r.ebitdaMarginTTM) * 100 : 0,
      net_income: 0,
      operating_cashflow: 0,
      free_cash_flow: 0,
      total_cash: 0,
      total_debt: 0,
      beta: n(p?.beta),
      enterprise_value: r ? n(r.enterpriseValueTTM) : 0,
      enterprise_to_revenue: r ? n(r.evToSalesTTM) : 0,
      enterprise_to_ebitda: r ? n(r.enterpriseValueMultipleTTM) : 0,
      shares_outstanding: n(q?.sharesOutstanding),
      float_shares: 0,
      held_percent_insiders: 0,
      held_percent_institutions: 0,
      short_ratio: 0,
      short_percent_of_float: 0,
      // Analyst
      target_price: 0,
      target_high: 0,
      target_low: 0,
      recommendation: '',
      analyst_count: 0,
      // Dates
      ex_dividend_date: '',
      earnings_date: earningsDate,
      founded: s(p?.ipoDate) ? s(p.ipoDate).split('-')[0] : '',
    }
  } catch {
    return null
  }
}

// ─── Finnhub enrichment (earnings history, analyst targets, metrics) ────────

async function enrichWithFinnhub(data: TickerInfo): Promise<TickerInfo> {
  const fhKey = process.env.FINNHUB_API_KEY
  if (!fhKey) return data

  const base = 'https://finnhub.io/api/v1'
  const tk = `token=${fhKey}`

  try {
    const [metricsRes, targetRes, recRes] = await Promise.all([
      fetch(`${base}/stock/metric?symbol=${data.symbol}&metric=all&${tk}`, { next: { revalidate: 600 } }).catch(() => null),
      fetch(`${base}/stock/price-target?symbol=${data.symbol}&${tk}`, { next: { revalidate: 1800 } }).catch(() => null),
      fetch(`${base}/stock/recommendation?symbol=${data.symbol}&${tk}`, { next: { revalidate: 1800 } }).catch(() => null),
    ])

    const metricsJson = metricsRes?.ok ? await metricsRes.json().catch(() => null) : null
    const targetJson = targetRes?.ok ? await targetRes.json().catch(() => null) : null
    const recArr = recRes?.ok ? await recRes.json().catch(() => []) : []

    const m = metricsJson?.metric ?? {}
    const n = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)

    // Enrich with Finnhub metrics where FMP was zero
    if (!data.pe_ratio && n(m.peTTM)) data.pe_ratio = n(m.peTTM)
    if (!data.eps && n(m.epsTTM)) data.eps = n(m.epsTTM)
    if (!data.beta && n(m.beta)) data.beta = n(m.beta)
    if (!data.week_52_high && n(m['52WeekHigh'])) data.week_52_high = n(m['52WeekHigh'])
    if (!data.week_52_low && n(m['52WeekLow'])) data.week_52_low = n(m['52WeekLow'])
    if (!data.gross_margins && n(m.grossMarginTTM)) data.gross_margins = n(m.grossMarginTTM)
    if (!data.profit_margins && n(m.netProfitMarginTTM)) data.profit_margins = n(m.netProfitMarginTTM)
    if (!data.return_on_equity && n(m.roeTTM)) data.return_on_equity = n(m.roeTTM)
    if (!data.revenue_growth && n(m.revenueGrowthQuarterlyYoy)) data.revenue_growth = n(m.revenueGrowthQuarterlyYoy)

    // Price target
    if (targetJson) {
      if (!data.target_price && n(targetJson.targetMean)) data.target_price = n(targetJson.targetMean)
      if (!data.target_high && n(targetJson.targetHigh)) data.target_high = n(targetJson.targetHigh)
      if (!data.target_low && n(targetJson.targetLow)) data.target_low = n(targetJson.targetLow)
    }

    // Recommendation
    if (Array.isArray(recArr) && recArr.length > 0) {
      const latest = recArr[0]
      const buy = n(latest.buy) + n(latest.strongBuy)
      const sell = n(latest.sell) + n(latest.strongSell)
      const hold = n(latest.hold)
      data.analyst_count = buy + sell + hold
      if (buy > sell * 2) data.recommendation = 'buy'
      else if (sell > buy * 2) data.recommendation = 'sell'
      else data.recommendation = 'hold'
    }
  } catch { /* Finnhub enrichment failed silently */ }

  return data
}

// ─── GET handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim()?.toUpperCase()

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol parameter' }, { status: 400 })
  }

  // Strategy: FMP (primary, stable API) → Yahoo (fallback) → Finnhub enrichment
  let data = await fetchFmpFullProfile(symbol)

  // Fallback to Yahoo if FMP fails
  if (!data) {
    data =
      (await fetchYahooQuoteSummaryDirect(symbol)) ??
      (await fetchYahooQuoteSummaryViaBackend(symbol))
  }

  if (!data) {
    return NextResponse.json({ error: `No data found for ${symbol}` }, { status: 404 })
  }

  // Enrich with Finnhub (analyst targets, earnings, metrics gaps)
  data = await enrichWithFinnhub(data)

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  })
}
