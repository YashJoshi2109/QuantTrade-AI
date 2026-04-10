/**
 * Stripe Payment Links (public URLs). Override with NEXT_PUBLIC_* for test mode or new links.
 */
export const STRIPE_PAYMENT_LINK_MONTHLY =
  process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_MONTHLY ??
  'https://buy.stripe.com/dRmbJ2ae80Y2aw36KU7Re01'

export const STRIPE_PAYMENT_LINK_YEARLY =
  process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_YEARLY ??
  'https://buy.stripe.com/4gM3cwae8bCG7jRd9i7Re02'

export function buildStripePaymentLinkUrl(
  baseUrl: string,
  opts: { clientReferenceId?: string; prefilledEmail?: string }
): string {
  const u = new URL(baseUrl)
  if (opts.clientReferenceId) {
    u.searchParams.set('client_reference_id', opts.clientReferenceId)
  }
  if (opts.prefilledEmail) {
    u.searchParams.set('prefilled_email', opts.prefilledEmail)
  }
  return u.toString()
}

export const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''

export const STRIPE_BUY_BUTTON_MONTHLY_ID =
  process.env.NEXT_PUBLIC_STRIPE_BUY_BUTTON_MONTHLY_ID ?? ''

export const STRIPE_BUY_BUTTON_YEARLY_ID =
  process.env.NEXT_PUBLIC_STRIPE_BUY_BUTTON_YEARLY_ID ?? ''
