/**
 * Server-side Yahoo Finance symbol search (shared by /api/search and
 * /api/search/global). Runs on the Next server to avoid CORS.
 */

export interface YFQuote {
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
  /** Raw Yahoo quoteType (EQUITY, ETF, INDEX, CRYPTOCURRENCY, ...). */
  quote_type: string
  country: string
}

// Exchange → country mapping for the most common global exchanges
export const EXCHANGE_COUNTRY: Record<string, string> = {
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

const DEFAULT_TYPES = ['EQUITY', 'ETF', 'INDEX']

/**
 * Search Yahoo. Returns [] on any upstream failure (never throws).
 * `types` filters on Yahoo quoteType (EQUITY, ETF, INDEX, CRYPTOCURRENCY, ...).
 */
export async function searchYahoo(
  query: string,
  limit: number,
  types: string[] = DEFAULT_TYPES,
  signal?: AbortSignal,
): Promise<GlobalSearchResult[]> {
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
      signal,
    })
    if (!response.ok) return []

    const data = await response.json()
    // v1/finance/search returns `quotes` at the top level; the nested shape is
    // the older envelope. Reading only the nested one returned [] for every query.
    const quotes: YFQuote[] = data?.quotes ?? data?.finance?.result?.[0]?.quotes ?? []
    return quotes
      .filter((q) => types.includes(q.quoteType ?? ''))
      .slice(0, limit)
      .map((q) => ({
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchange ?? '',
        exchange_display: q.exchDisp ?? q.exchange ?? '',
        type: q.typeDisp ?? q.quoteType ?? 'Equity',
        quote_type: q.quoteType ?? '',
        country: EXCHANGE_COUNTRY[q.exchange ?? ''] ?? 'Global',
      }))
  } catch {
    return []
  }
}
