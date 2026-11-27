'use client'

/**
 * Inline notice on the Copilot page when the "AI Copilot (LLM)" service in
 * /api/v1/system/status is degraded or down. Renders nothing when it is fine,
 * not configured, or the status has not loaded.
 */
import Link from 'next/link'
import { copilotBanner } from '@/lib/systemStatus'
import { useSystemStatus } from './SystemStatusProvider'

export default function CopilotLlmBanner() {
  const { data } = useSystemStatus()
  const b = copilotBanner(data)
  if (!b) return null
  const tone =
    b.tone === 'down'
      ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100'
      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
  return (
    <div role="status" className={`border-b px-4 py-2 text-[13px] leading-snug ${tone}`} data-testid="copilot-llm-banner">
      <span className="font-semibold">{b.title}</span> {b.body}{' '}
      <Link href="/status" className="underline underline-offset-2">
        System status
      </Link>
    </div>
  )
}
