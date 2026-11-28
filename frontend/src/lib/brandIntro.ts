export const BRAND_INTRO_STORAGE_KEY = 'quanttrade_brand_intro_v1'

/** Attribute set on <html> while the server-rendered intro poster is showing. */
export const BRAND_INTRO_ATTR = 'data-brand-intro'

/** Hide the server-rendered intro poster (BrandIntroPoster). */
export function hideBrandIntroPoster(): void {
  if (typeof document === 'undefined') return
  document.documentElement.removeAttribute(BRAND_INTRO_ATTR)
}

/** Routes where a first visit may start with the full-screen brand intro. */
const INTRO_ROUTES = new Set(['/'])

/**
 * The brand intro is a full-screen first-visit overlay. It only plays when the
 * visit lands on the home page, so deep links (a ticker page from search,
 * /markets, /earnings, ...) open straight on their content. Also skipped for
 * reduced-motion users and once it has been seen.
 */
export function shouldShowBrandIntro(pathname: string | null | undefined): boolean {
  if (typeof window === 'undefined') return false
  if (!pathname || !INTRO_ROUTES.has(pathname)) return false
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    if (window.localStorage.getItem(BRAND_INTRO_STORAGE_KEY) === '1') return false
  } catch {
    /* private mode: storage unavailable, fall through and show it */
  }
  return true
}
