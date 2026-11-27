'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogIn, type LucideIcon } from 'lucide-react'
import { signInHref } from '@/lib/authRedirect'
import { cn } from '@/lib/utils'

interface SignInPromptProps {
  title: string
  description?: string
  icon?: LucideIcon
  /** Path to return to after signing in. Defaults to the current page. */
  returnTo?: string
  /** Tighter padding for mobile and in-panel use. */
  compact?: boolean
  className?: string
}

/**
 * The one "you need an account for this" card. Every signed-out gate uses it
 * so the copy, button and spacing match across tabs, and the button returns
 * the visitor to the page they were on.
 */
export default function SignInPrompt({
  title,
  description,
  icon: Icon = LogIn,
  returnTo,
  compact = false,
  className,
}: SignInPromptProps) {
  const pathname = usePathname()
  const href = signInHref(returnTo ?? pathname)

  return (
    <div
      className={cn(
        'rounded-2xl border border-line-subtle bg-surface-raised text-center',
        compact ? 'px-5 py-7' : 'px-8 py-12',
        className,
      )}
    >
      <div
        className={cn(
          'mx-auto mb-4 flex items-center justify-center rounded-xl border border-line-subtle bg-surface-base',
          compact ? 'h-10 w-10' : 'h-12 w-12',
        )}
      >
        <Icon className={cn('text-fg-muted', compact ? 'h-5 w-5' : 'h-6 w-6')} aria-hidden />
      </div>
      <h2 className={cn('font-semibold text-fg-primary', compact ? 'text-sm' : 'text-lg')}>{title}</h2>
      {description && (
        <p className={cn('mx-auto mt-1 max-w-md text-fg-muted', compact ? 'text-xs' : 'text-sm')}>{description}</p>
      )}
      <Link
        href={href}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <LogIn className="h-4 w-4" aria-hidden /> Sign in
      </Link>
    </div>
  )
}
