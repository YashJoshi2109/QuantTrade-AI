/**
 * Stripe Payment Links (public URLs). Override with NEXT_PUBLIC_* for test mode or new links.
 */
export const STRIPE_PAYMENT_LINK_MONTHLY =
  process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_MONTHLY ??
  'https://buy.stripe.com/dRmbJ2ae80Y2aw36KU7Re01'

export const STRIPE_PAYMENT_LINK_YEARLY =
  process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_YEARLY ??
  'https://buy.stripe.com/4gM3cwae8bCG7jRd9i7Re02'

/** Customer-facing code (e.g. QUANTTRADE). Prefills Stripe Checkout when the Payment Link allows promo codes. */
export const STRIPE_PROMO_CUSTOMER_CODE =
  process.env.NEXT_PUBLIC_STRIPE_PROMO_CODE?.trim() || 'QUANTTRADE'

export function buildStripePaymentLinkUrl(
  baseUrl: string,
  opts: {
    clientReferenceId?: string
    prefilledEmail?: string
    /** Set false to skip prefilled_promo_code */
    includePromoCode?: boolean
  }
): string {
  const u = new URL(baseUrl)
  if (opts.clientReferenceId) {
    u.searchParams.set('client_reference_id', opts.clientReferenceId)
  }
  if (opts.prefilledEmail) {
    u.searchParams.set('prefilled_email', opts.prefilledEmail)
  }
  if (opts.includePromoCode !== false && STRIPE_PROMO_CUSTOMER_CODE) {
    u.searchParams.set('prefilled_promo_code', STRIPE_PROMO_CUSTOMER_CODE)
  }
  return u.toString()
}
