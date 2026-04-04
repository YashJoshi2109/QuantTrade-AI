import { NextRequest, NextResponse } from 'next/server'

/**
 * Global stock search proxy
 * Searches Yahoo Finance for ~53,795+ global equities across all exchanges.
 * This server-side route avoids CORS restrictions on the Yahoo Finance API.
 */

interface YFQuote {
  symbol: string
  shortname?: string
  longname?: string
  exchange?: string
  exchDisp?: string
  typeDisp?: string
  quoteType?: string
  score?: number
}

export interface GlobalSearchResult {
  symbol: string
  name: string
  exchange: string
  exchange_display: string
  type: string
  country: string
}

// Exchange → country mapping for the most common global exchanges
const EXCHANGE_COUNTRY: Record<string, string> = {
  // US
  NMS: 'US', NGM: 'US', NYQ: 'US', ASE: 'US', PCX: 'US', BTS: 'US',
  // Europe
  LSE: 'GB', AMS: 'NL', PAR: 'FR', FRA: 'DE', MIL: 'IT', MCE: 'ES',
  STO: 'SE', OSL: 'NO', HEL: 'FI', CPH: 'DK', VIE: 'AT', ZRH: 'CH',
  LIS: 'PT', BRU: 'BE', DUB: 'IE', WAR: 'PL', PRA: 'CZ', BUD: 'HU',
  // Asia Pacific
  TYO: 'JP', OSA: 'JP', HKG: 'HK', SHH: 'CN', SHZ: 'CN', NSE: 'IN',
  BSE: 'IN', KSC: 'KR', KOE: 'KR', SES: 'SG', ASX: 'AU', NZE: 'NZ',
  TAI: 'TW', BOM: 'IN', KLS: 'MY', BKK: 'TH', JKT: 'ID', PSE: 'PH',
  // Americas
  TSX: 'CA', CNQ: 'CA', MEX: 'MX', SAO: 'BR', BUE: 'AR', LIM: 'PE',
  SCL: 'CL', BOG: 'CO',
  // Middle East & Africa
  TLV: 'IL', DFM: 'AE', ADX: 'AE', QAT: 'QA', SAU: 'SA', KWT: 'KW',
  JSE: 'ZA', EGX: 'EG', NSE_NG: 'NG',
  // Other
  BMV: 'MX', BCBA: 'AR',
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim()
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '15', 10), 30)

  if (!query || query.length < 1) {
    return NextResponse.json([] as GlobalSearchResult[], { status: 200 })
  }

  try {
    const yahooUrl = new URL('https://query2.finance.yahoo.com/v1/finance/search')
    yahooUrl.searchParams.set('q', query)
    yahooUrl.searchParams.set('lang', 'en-US')
    yahooUrl.searchParams.set('region', 'US')
    yahooUrl.searchParams.set('quotesCount', String(limit))
    yahooUrl.searchParams.set('newsCount', '0')
    yahooUrl.searchParams.set('enableFuzzyQuery', 'false')
    yahooUrl.searchParams.set('enableCb', 'false')
    yahooUrl.searchParams.set('enableNavLinks', 'false')
    yahooUrl.searchParams.set('enableEnhancedTrivialQuery', 'true')

    const response = await fetch(yahooUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; QuantTradeAI/1.0)',
        Accept: 'application/json',
      },
      next: { revalidate: 30 }, // cache for 30s
    })

    if (!response.ok) {
      return NextResponse.json([] as GlobalSearchResult[], { status: 200 })
    }

    const data = await response.json()
    const quotes: YFQuote[] = data?.finance?.result?.[0]?.quotes ?? []

    const results: GlobalSearchResult[] = quotes
      .filter((q) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'INDEX')
      .slice(0, limit)
      .map((q) => ({
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchange ?? '',
        exchange_display: q.exchDisp ?? q.exchange ?? '',
        type: q.typeDisp ?? q.quoteType ?? 'Equity',
        country: EXCHANGE_COUNTRY[q.exchange ?? ''] ?? 'Global',
      }))

    return NextResponse.json(results)
  } catch {
    // Silently return empty on network errors
    return NextResponse.json([] as GlobalSearchResult[], { status: 200 })
  }
}
