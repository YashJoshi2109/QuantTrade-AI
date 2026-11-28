'use client'

import { forwardRef, type ComponentProps, type FocusEvent, type MouseEvent, type TouchEvent } from 'react'
import Link from 'next/link'
import { useIntentPrefetch } from '@/lib/intentPrefetch'

type IntentLinkProps = Omit<ComponentProps<typeof Link>, 'prefetch' | 'href'> & { href: string }

/**
 * <Link> for navigation chrome: no viewport prefetch; prefetches the route once
 * per session on hover / focus / touchstart (see lib/intentPrefetch).
 */
const IntentLink = forwardRef<HTMLAnchorElement, IntentLinkProps>(function IntentLink(
  { href, onMouseEnter, onFocus, onTouchStart, ...rest },
  ref
) {
  const intent = useIntentPrefetch(href)
  return (
    <Link
      ref={ref}
      href={href}
      prefetch={false}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        intent.onMouseEnter()
        onMouseEnter?.(e)
      }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
        intent.onFocus()
        onFocus?.(e)
      }}
      onTouchStart={(e: TouchEvent<HTMLAnchorElement>) => {
        intent.onTouchStart()
        onTouchStart?.(e)
      }}
      {...rest}
    />
  )
})

export default IntentLink
