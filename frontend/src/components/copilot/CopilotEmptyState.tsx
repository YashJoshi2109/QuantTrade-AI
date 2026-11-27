'use client'

import { CornerDownLeft } from 'lucide-react'
import type { StarterPromptGroup } from '@/lib/copilot-prompts'
import { cn } from '@/lib/utils'

/**
 * Empty state: plain-language promise, honest limits, then personal starter
 * questions as a scannable list (one line each), not a grid of cards.
 */
export default function CopilotEmptyState({
  groups,
  onAsk,
  disabled,
  loadingPersonal,
  compact,
}: {
  groups: StarterPromptGroup[]
  onAsk: (text: string) => void
  disabled?: boolean
  loadingPersonal?: boolean
  compact?: boolean
}) {
  return (
    <div className={cn('mx-auto w-full max-w-[44rem]', compact ? 'pt-2' : 'pt-[clamp(1rem,6vh,4rem)]')}>
      <h2 className={cn('cp-serif font-semibold tracking-[-0.01em] text-[var(--cp-ink)]', compact ? 'text-[1.75rem] leading-[1.15]' : 'text-[2.5rem] leading-[1.1]')}>
        Ask about any US stock.
      </h2>
      <p className={cn('mt-3 max-w-[36rem] text-[var(--cp-ink-2)]', compact ? 'text-[15px] leading-6' : 'text-[17px] leading-7')}>
        Answers cite their sources, with dates you can check: filings, financial statements, quotes and news.
        Forecasts are experimental ranges, and nothing here is financial advice.
      </p>

      <div className={cn('grid gap-x-10', compact ? 'mt-6 gap-y-5' : 'mt-10 gap-y-7 lg:grid-cols-2')}>
        {groups.map((g) => (
          <section key={g.source} aria-labelledby={`cp-group-${g.source}`}>
            <h3 id={`cp-group-${g.source}`} className="text-[13px] font-semibold text-[var(--cp-ink-3)]">
              {g.title}
            </h3>
            <ul className="mt-2 divide-y divide-[var(--cp-line)] border-y border-[var(--cp-line)]">
              {g.prompts.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onAsk(p.text)}
                    className={cn(
                      'group flex min-h-[44px] w-full items-center gap-3 py-2.5 pr-1 text-left text-[15px] leading-snug text-[var(--cp-ink)]',
                      'hover:text-[var(--cp-accent-ink)] disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                  >
                    {p.symbol ? (
                      <span className="w-14 shrink-0 text-[12px] font-semibold tabular-nums tracking-wide text-[var(--cp-ink-3)]">{p.symbol}</span>
                    ) : (
                      <span className="w-14 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">{p.text}</span>
                    <CornerDownLeft aria-hidden className="h-4 w-4 shrink-0 text-[var(--cp-ink-3)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {loadingPersonal && (
          <div aria-hidden className="space-y-3 pt-6">
            <div className="cp-skeleton h-3 w-32" />
            <div className="cp-skeleton h-4 w-full" />
            <div className="cp-skeleton h-4 w-4/5" />
          </div>
        )}
      </div>
    </div>
  )
}
