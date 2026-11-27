/**
 * Which SEC EDGAR panel the Research page (desktop + MobileResearch) shows.
 *
 * The panel used to read every 404 from `/company-overview` as "not
 * applicable — ETFs, index funds ... foreign issuers", so US operating
 * companies (AEIS, INSM, TENB) were mislabelled whenever the first EDGAR
 * sync failed or the ticker had no Symbol row yet. The backend now returns a
 * typed `detail.code` and a `filer_type`; this module turns both into one
 * view state so the two layouts cannot drift.
 */

export type SecFilerType = 'domestic' | 'foreign' | 'fund' | 'unknown'

export type SecErrorCode = 'no_sec_filer' | 'sec_unavailable' | 'sync_pending' | 'network'

export interface SecOverviewLike {
  asset_type?: string | null
  filer_type?: string | null
  edgar_status?: string | null
}

export type SecPanelView =
  | 'loading'
  | 'ok'
  | 'foreign'
  | 'fund'
  | 'no_filer'
  | 'unavailable'

export class EdgarFetchError extends Error {
  readonly code: SecErrorCode
  readonly status: number

  constructor(code: SecErrorCode, status: number, message?: string) {
    super(message || code)
    this.name = 'EdgarFetchError'
    this.code = code
    this.status = status
  }

  /** 503 sync-in-progress / SEC hiccups are worth retrying; "no filer" is final. */
  get retryable(): boolean {
    return this.code !== 'no_sec_filer'
  }
}

/** Typed error from a failed EDGAR response (new `{detail:{code}}` or legacy string detail). */
export function edgarErrorFrom(status: number, body: unknown): EdgarFetchError {
  const detail = (body && typeof body === 'object' ? (body as { detail?: unknown }).detail : undefined)
  if (detail && typeof detail === 'object') {
    const code = String((detail as { code?: unknown }).code ?? '')
    const message = String((detail as { message?: unknown }).message ?? '')
    if (code === 'no_sec_filer' || code === 'sec_unavailable' || code === 'sync_pending') {
      return new EdgarFetchError(code, status, message)
    }
  }
  const text = typeof detail === 'string' ? detail : ''
  // Legacy backend: only "CIK not found" meant the ticker has no SEC filer.
  if (status === 404 && /cik not found/i.test(text)) return new EdgarFetchError('no_sec_filer', status, text)
  if (status === 503 && /in progress/i.test(text)) return new EdgarFetchError('sync_pending', status, text)
  return new EdgarFetchError('sec_unavailable', status, text)
}

export function normalizeFilerType(raw: unknown): SecFilerType {
  return raw === 'domestic' || raw === 'foreign' || raw === 'fund' ? raw : 'unknown'
}

/** One view for the panel: never "not applicable" unless EDGAR or the asset type says so. */
export function secPanelView(
  overview: SecOverviewLike | null | undefined,
  error: unknown,
  loading: boolean,
): SecPanelView {
  if (overview) {
    const asset = String(overview.asset_type ?? 'equity').toLowerCase()
    if (overview.edgar_status === 'not_applicable' || (asset && asset !== 'equity')) return 'fund'
    const filer = normalizeFilerType(overview.filer_type)
    if (filer === 'fund') return 'fund'
    if (filer === 'foreign') return 'foreign'
    return 'ok'
  }
  if (loading) return 'loading'
  if (error instanceof EdgarFetchError && error.code === 'no_sec_filer') return 'no_filer'
  if (error) return 'unavailable'
  return 'loading'
}

/** Form types the filings list asks for, per filer regime. */
export function filingFormsFor(view: SecPanelView): string[] {
  return view === 'foreign' ? ['20-F', '40-F', '6-K'] : ['10-K', '10-Q', '8-K']
}

export const FUND_NOT_APPLICABLE = (symbol: string) =>
  `${symbol} is a fund, not an operating company. ETFs, index funds and unit trusts do not file 10-K/10-Q ` +
  `income statements or balance sheets; they report holdings on N-CSR / N-PORT instead.`

export const NO_SEC_FILER = (symbol: string) =>
  `SEC EDGAR has no filer registered under ${symbol}. Companies listed only outside the US, and some OTC ` +
  `issuers, do not file with the SEC, so there are no SEC statements to show.`

export const FOREIGN_FILER_NOTE = (symbol: string) =>
  `${symbol} is a foreign private issuer: it files annual reports on Form 20-F or 40-F and interim results ` +
  `on Form 6-K, usually under IFRS. QuantTrade parses US-GAAP 10-K/10-Q statements, so line items appear ` +
  `only when EDGAR has them; the filings below link to the original reports.`
