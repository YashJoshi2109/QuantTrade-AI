'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

type Props = {
  buyButtonId: string
  publishableKey: string
  className?: string
}

/**
 * Stripe Buy Button web component. Requires publishable key + buy button IDs from Dashboard.
 */
export function StripeBuyButton({ buyButtonId, publishableKey, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [scriptLoaded, setScriptLoaded] = useState(false)

  useEffect(() => {
    if (!scriptLoaded || !hostRef.current || !buyButtonId || !publishableKey) return
    hostRef.current.innerHTML = ''
    const el = document.createElement('stripe-buy-button')
    el.setAttribute('buy-button-id', buyButtonId)
    el.setAttribute('publishable-key', publishableKey)
    hostRef.current.appendChild(el)
  }, [scriptLoaded, buyButtonId, publishableKey])

  if (!buyButtonId || !publishableKey) return null

  return (
    <>
      <Script
        src="https://js.stripe.com/v3/buy-button.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
      <div
        ref={hostRef}
        className={
          className ??
          'stripe-buy-button-host flex w-full min-h-[52px] items-center justify-center'
        }
      />
    </>
  )
}
