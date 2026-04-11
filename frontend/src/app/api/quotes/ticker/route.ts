import { NextRequest, NextResponse } from 'next/server'

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
}

async function fetchYahooQuoteSummary(symbol: string): Promise<TickerInfo | null> {
  try {
    const modules = [
      'summaryDetail',
      'financialData',
      'defaultKeyStatistics',
      'assetProfile',
      'price',
      'summaryProfile',
      'calendarEvents',
    ].join(',')

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; QuantTradeAI/1.0)',
        Accept: 'application/json',
      },
      next: { revalidate: 300 },
    })

    if (!res.ok) return null

    const data = await res.json()
    const result = data?.quoteSummary?.result?.[0]
    if (!result) return null

    const price = result.price ?? {}
    const summary = result.summaryDetail ?? {}
    const financial = result.financialData ?? {}
    const keyStats = result.defaultKeyStatistics ?? {}
    const profile = result.assetProfile ?? result.summaryProfile ?? {}
    const calendar = result.calendarEvents ?? {}

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
    if (Array.isArray(profile.companyOfficers)) {
      for (const o of profile.companyOfficers.slice(0, 8)) {
        officers.push({
          name: String(o.name ?? ''),
          title: String(o.title ?? ''),
          age: o.age ?? null,
          totalPay: o.totalPay?.raw ?? null,
        })
      }
    }

    // Parse earnings date
    let earningsDate = ''
    const earningsDates = calendar?.earnings?.earningsDate
    if (Array.isArray(earningsDates) && earningsDates.length > 0) {
      const ed = earningsDates[0]
      earningsDate = ed?.fmt ?? ''
    }

    // Parse ex-dividend date
    const exDivRaw = summary.exDividendDate ?? keyStats.lastDividendDate
    const exDividendDate = exDivRaw?.fmt ?? ''

    return {
      symbol: String(price.symbol ?? symbol),
      name: String(price.longName ?? price.shortName ?? symbol),
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
    }
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim()?.toUpperCase()

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol parameter' }, { status: 400 })
  }

  const data = await fetchYahooQuoteSummary(symbol)

  if (!data) {
    return NextResponse.json({ error: `No data found for ${symbol}` }, { status: 404 })
  }

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  })
}
