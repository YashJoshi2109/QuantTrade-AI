'use client'

import type { Attribution } from '@/lib/publicData'

/** "Source: <agency>, as of <date>" with a link to the publisher's dataset page. */
export function SourceLine({ attribution, extra, testId }: { attribution?: Attribution | null; extra?: string; testId?: string }) {
  if (!attribution) return null
  return (
    <p className="mt-3 text-[11px] leading-relaxed text-fg-muted" data-testid={testId}>
      <a href={attribution.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-fg-secondary">
        {attribution.text}
      </a>
      {extra ? <span> · {extra}</span> : null}
    </p>
  )
}
