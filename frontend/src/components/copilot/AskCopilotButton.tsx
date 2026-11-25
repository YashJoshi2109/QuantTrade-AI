'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { buildCopilotHref } from '@/lib/copilot-handoff'
import { cn } from '@/lib/utils'

/** Research → Copilot handoff ("Chat with Copilot about NVDA"). Same link on desktop and mobile. */
export default function AskCopilotButton({
  symbol,
  question,
  variant = 'desktop',
  className,
}: {
  symbol: string
  question?: string
  variant?: 'desktop' | 'mobile'
  className?: string
}) {
  const sym = symbol.toUpperCase()
  return (
    <Link
      href={buildCopilotHref(sym, question)}
      data-testid="ask-copilot"
      aria-label={`Chat with Copilot about ${sym}`}
      className={cn(
        'group inline-flex items-center justify-center gap-2 font-semibold text-white transition-all',
        'border border-[#007AFF]/45 bg-gradient-to-br from-[#0a84ff]/90 to-[#0060c9]/90 shadow-[0_0_24px_rgba(0,122,255,0.25)] hover:brightness-110 active:scale-[0.98]',
        variant === 'desktop' ? 'rounded-xl px-4 py-2 text-sm' : 'w-full rounded-2xl px-4 py-3 text-[13px]',
        className,
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 transition-transform group-hover:rotate-12" aria-hidden />
      Chat with Copilot about {sym}
    </Link>
  )
}
