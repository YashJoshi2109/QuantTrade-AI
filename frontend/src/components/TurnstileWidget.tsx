'use client'

/**
 * Cloudflare Turnstile CAPTCHA Widget
 *
 * Managed challenge that replaces reCAPTCHA. Free unlimited usage.
 * Renders an invisible or visible challenge depending on risk score.
 *
 * Usage:
 *   <TurnstileWidget onVerify={(token) => setToken(token)} />
 *
 * Docs: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 */

import { useEffect, useRef, useCallback } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
    onTurnstileLoad?: () => void
  }
}

interface TurnstileWidgetProps {
  onVerify: (token: string) => void
  onExpire?: () => void
  onError?: () => void
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact' | 'flexible'
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''

export default function TurnstileWidget({
  onVerify,
  onExpire,
  onError,
  theme = 'dark',
  size = 'flexible',
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const scriptLoadedRef = useRef(false)

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || !SITE_KEY) return
    if (widgetIdRef.current) return // Already rendered

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY,
      callback: (token: string) => onVerify(token),
      'expired-callback': () => onExpire?.(),
      'error-callback': () => onError?.(),
      theme,
      size,
      appearance: 'interaction-only',
    })
  }, [onVerify, onExpire, onError, theme, size])

  useEffect(() => {
    if (!SITE_KEY) return

    // If Turnstile already loaded, render immediately
    if (window.turnstile) {
      renderWidget()
      return
    }

    // Load the script once
    if (!scriptLoadedRef.current) {
      scriptLoadedRef.current = true

      window.onTurnstileLoad = () => {
        renderWidget()
      }

      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {}
        widgetIdRef.current = null
      }
    }
  }, [renderWidget])

  // Don't render anything if no site key configured
  if (!SITE_KEY) return null

  return (
    <div
      ref={containerRef}
      className="flex justify-center my-2"
      style={{ minHeight: size === 'compact' ? 120 : 65 }}
    />
  )
}
