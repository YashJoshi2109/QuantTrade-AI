/**
 * Yahoo quoteSummary often returns longName like
 * "NVDA - NVIDIA Corp Stock Price and Quote". Strip ticker prefix and SEO tails
 * so UI shows a clean legal-style company name (e.g. "NVIDIA Corp").
 */
export function sanitizeQuoteSummaryCompanyName(raw: string, symbol: string): string {
  let s = raw.trim()
  if (!s) return s

  const sym = symbol.trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  s = s.replace(new RegExp(`^${sym}\\s*[-–—:]\\s*`, 'i'), '')

  const tails = [
    /\s+stock\s+price\s+and\s+quote\s*$/i,
    /\s+stock\s+quote\s+and\s+chart\s*$/i,
    /\s+stock\s+quote\s*$/i,
    /\s+stock\s+price\s*$/i,
    /\s+share\s+price\s*$/i,
    /\s*\|\s*yahoo\s+finance\s*$/i,
    /\s+-\s*yahoo\s+finance\s*$/i,
    /\s+-\s*overview\s*$/i,
    /\s+-\s*company\s+profile\s*$/i,
  ]
  for (const re of tails) {
    s = s.replace(re, '')
  }

  s = s.trim()
  return s || raw.trim()
}
