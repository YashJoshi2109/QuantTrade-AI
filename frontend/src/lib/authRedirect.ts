/**
 * Where to send someone after they sign in.
 *
 * Pages that need an account link to `/auth?redirect=<their path>` so the
 * visitor lands back where they were instead of on the dashboard. The value
 * comes from the URL, so only same-origin paths are accepted: anything that
 * could leave the site (`//evil.com`, `https://…`, `/\evil.com`,
 * `javascript:`) falls back to the dashboard.
 */
export const DEFAULT_AFTER_AUTH = '/'

export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_AUTH
  let value = raw.trim()
  try {
    value = decodeURIComponent(value)
  } catch {
    return DEFAULT_AFTER_AUTH
  }
  if (!value.startsWith('/')) return DEFAULT_AFTER_AUTH
  // Protocol-relative and backslash tricks resolve to another origin.
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_AFTER_AUTH
  // Control characters (URL parsers strip tabs/newlines, which can turn
  // "/\n/evil.com" into "//evil.com").
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_AFTER_AUTH
  // Never bounce back into the auth flow itself.
  if (value === '/auth' || value.startsWith('/auth?') || value.startsWith('/auth/')) {
    return DEFAULT_AFTER_AUTH
  }
  return value
}

/** Link to the sign-in page that returns to `path` afterwards. */
export function signInHref(path?: string | null): string {
  const target = safeRedirectPath(path)
  return target === DEFAULT_AFTER_AUTH ? '/auth' : `/auth?redirect=${encodeURIComponent(target)}`
}

/** Sign in, then land on the community feed with the post composer open. */
export const COMMUNITY_COMPOSE_SIGN_IN = signInHref('/community?create=true')

/** Read the redirect target from the current URL (client only). */
export function redirectFromLocation(): string {
  if (typeof window === 'undefined') return DEFAULT_AFTER_AUTH
  return safeRedirectPath(new URLSearchParams(window.location.search).get('redirect'))
}
