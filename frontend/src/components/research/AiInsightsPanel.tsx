'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { CardSkeleton as Skeleton } from './ResearchCard'
import AskCopilotButton from '@/components/copilot/AskCopilotButton'
import { cn } from '@/lib/utils'
import { rulesReport, toneText, type TechnicalInputs, type TrendLabel } from '@/lib/researchTechnicals'
import { CardTitle, ResearchCard } from './ResearchCard'

const sentimentTone = (s: TrendLabel) => (s === 'Bullish' ? 'up' : s === 'Bearish' ? 'down' : 'neutral')

function SentimentPill({ sentiment }: { sentiment: TrendLabel }) {
  return (
    <span className={cn('rounded-full border border-line-subtle px-2.5 py-0.5 text-[11px] font-semibold', toneText(sentimentTone(sentiment)))}>
      {sentiment}
    </span>
  )
}

/**
 * Overview-tab AI summary: the rules-based snapshot (lib/researchTechnicals
 * rulesReport) with a link into the AI Insights tab for the streamed read.
 */
export function AiSummaryCard({
  symbol,
  inputs,
  quote,
  loading,
  onOpenInsights,
}: {
  symbol: string
  inputs: TechnicalInputs | null
  quote: { percent?: number | null; volume?: number | null }
  loading?: boolean
  onOpenInsights?: () => void
}) {
  const r = rulesReport(inputs, quote)
  return (
    <ResearchCard testId="ai-summary-card" busy={loading}>
      <CardTitle right={!loading && <SentimentPill sentiment={r.sentiment} />}>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-blue-500" aria-hidden />
          AI analysis summary
        </span>
      </CardTitle>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ) : (
        <div className="space-y-2 text-[13px] leading-relaxed text-fg-secondary">
          <p>{r.maSummary}</p>
          <p>{r.macdText}</p>
          {r.bullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 tabular-nums">
              {r.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle pt-3">
        <p className="text-[11px] text-fg-muted">Rules-based read of {symbol} indicators. Not investment advice.</p>
        {onOpenInsights && (
          <button
            type="button"
            onClick={onOpenInsights}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
          >
            Open AI Insights <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </ResearchCard>
  )
}

/**
 * AI Insights tab: streamed AI analysis (/api/ai-analysis) with the rules-based
 * fallback, plus the Copilot handoff. Moved out of app/research/page.tsx.
 */
export function AiInsightsPanel({
  symbol,
  inputs,
  quote,
  loading,
}: {
  symbol: string
  inputs: TechnicalInputs | null
  quote: { price?: number | null; percent?: number | null; volume?: number | null }
  loading?: boolean
}) {
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const r = rulesReport(inputs, quote)

  // A different symbol must not keep the previous symbol's AI text.
  useEffect(() => {
    abortRef.current?.abort()
    setAiText('')
    setAiLoading(false)
  }, [symbol])
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setAiText('')
    setAiLoading(true)
    try {
      const body = {
        symbol,
        price: quote.price ?? undefined,
        change_pct: quote.percent ?? undefined,
        rsi: inputs?.rsi ?? undefined,
        macd: inputs?.macd?.macd ?? undefined,
        macd_signal: inputs?.macd?.signal ?? undefined,
        sma_20: inputs?.sma_20 ?? undefined,
        sma_50: inputs?.sma_50 ?? undefined,
        sma_200: inputs?.sma_200 ?? undefined,
        bb_upper: inputs?.bollinger_bands?.upper ?? undefined,
        bb_lower: inputs?.bollinger_bands?.lower ?? undefined,
        volume: quote.volume ?? undefined,
      }
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        // 401 sign in, 403 verify email, 429 limit, 503 AI budget paused
        const err = await res.json().catch(() => ({}))
        if ([401, 403, 429, 503].includes(res.status)) {
          setAiText(typeof err.error === 'string' ? err.error : 'AI analysis is unavailable right now.')
        }
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setAiText((prev) => prev + decoder.decode(value, { stream: true }))
      }
    } catch (e: unknown) {
      if ((e as { name?: string }).name !== 'AbortError') setAiText('')
    } finally {
      if (abortRef.current === ctrl) setAiLoading(false)
    }
  }, [symbol, inputs, quote.price, quote.percent, quote.volume])

  return (
    <ResearchCard testId="ai-insights-panel" busy={loading}>
      <CardTitle
        right={
          <div className="flex items-center gap-2">
            {!loading && <SentimentPill sentiment={r.sentiment} />}
            <button
              type="button"
              onClick={run}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-default px-2.5 py-1 text-[11px] font-semibold text-fg-secondary hover:text-fg-primary disabled:opacity-50"
              title="Generate a real-time AI read"
            >
              {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {aiLoading ? 'Generating…' : 'AI Refresh'}
            </button>
          </div>
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-blue-500" aria-hidden />
          AI analysis
        </span>
      </CardTitle>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ) : aiText ? (
        <div className="space-y-3">
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg-secondary">
            {aiText}
            {aiLoading && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-blue-500 align-middle" />}
          </p>
          <div className="flex flex-wrap gap-2 text-[11px] text-fg-muted">
            <span className="rounded-full border border-line-subtle px-2 py-0.5">RSI: {r.rsiSignal}</span>
            <span className="rounded-full border border-line-subtle px-2 py-0.5">Trend: {r.trendSignal}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 text-[13px] leading-relaxed text-fg-secondary">
          <p>
            Snapshot for <span className="font-semibold text-fg-primary">{symbol}</span> combines momentum (RSI, MACD)
            with structure (moving averages and Bollinger position). It is a rules-based synthesis, not a prediction.
          </p>
          <p>{r.macdText}</p>
          <p>{r.bbText}</p>
          <p>{r.maSummary}</p>
          {r.bullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 tabular-nums">
              {r.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-fg-muted">Click “AI Refresh” for a real-time QuantTrade AI read.</p>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t border-line-subtle pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-fg-muted">Not investment advice. Verify levels on your chart before acting.</p>
        <AskCopilotButton symbol={symbol} variant="desktop" />
      </div>
    </ResearchCard>
  )
}
