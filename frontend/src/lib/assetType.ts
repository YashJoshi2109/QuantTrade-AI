/**
 * Asset-type gating shared by the desktop Research page and MobileResearch.
 * Company-only panels (fundamentals, company folio, earnings, SEC EDGAR) make
 * no sense for an index (^GSPC) or ETF and must be hidden, not shown empty.
 */
import { isIndexLevelSymbol } from '@/lib/indexQuotes'

export type AssetType = 'equity' | 'etf' | 'fund' | 'index' | 'future' | 'fx' | 'crypto'

/** Normalise a provider/back-end asset type string (Equity, ETF, MUTUALFUND, INDEX …). */
export function normalizeAssetType(raw: unknown): AssetType | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const t = raw.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (t === 'equity' || t === 'stock' || t === 'commonstock' || t === 'adr') return 'equity'
  if (t === 'etf' || t === 'etn') return 'etf'
  if (t === 'fund' || t === 'mutualfund' || t === 'closedendfund') return 'fund'
  if (t === 'index') return 'index'
  if (t === 'future' || t === 'futures') return 'future'
  if (t === 'fx' || t === 'currency') return 'fx'
  if (t === 'crypto' || t === 'cryptocurrency') return 'crypto'
  return null
}

// Single-letter Yahoo exchange suffixes that are NOT share classes (VOD.L, ABC.V …).
const YAHOO_SINGLE_LETTER_SUFFIXES = new Set(['L', 'V', 'F', 'T'])

/**
 * US share-class tickers use a dot in our URLs (BRK.B, BF.B) but a dash on Yahoo,
 * FMP and Finviz (BRK-B). Exchange suffixes (0700.HK, SHOP.TO, VOD.L) are kept.
 */
export function toYahooSymbol(symbol: string): string {
  const s = (symbol ?? '').trim().toUpperCase()
  const m = /^([A-Z]{1,6})\.([A-Z])$/.exec(s)
  return m && !YAHOO_SINGLE_LETTER_SUFFIXES.has(m[2]) ? `${m[1]}-${m[2]}` : s
}

/** Asset type from the symbol shape alone (indices, futures, FX, crypto pairs). */
export function assetTypeFromSymbol(symbol: string | null | undefined): AssetType | null {
  const s = (symbol ?? '').trim().toUpperCase()
  if (!s) return null
  if (isIndexLevelSymbol(s)) return 'index'
  if (s.endsWith('=F')) return 'future'
  if (s.endsWith('=X')) return 'fx'
  if (/^[A-Z0-9]+-USD$/.test(s)) return 'crypto'
  return null
}

/**
 * True only for operating companies. The symbol shape wins (an index is never a
 * company even if a provider mislabels it); otherwise the reported asset type
 * decides; unknown defaults to company so ordinary tickers keep every panel.
 */
export function isCompanyAsset(symbol: string | null | undefined, assetType?: unknown): boolean {
  const bySymbol = assetTypeFromSymbol(symbol)
  if (bySymbol) return false
  const t = normalizeAssetType(assetType)
  return t === null || t === 'equity'
}
