'use client'

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtCompact, netActivityLabel, useInsiders, type InsiderTx } from '@/lib/publicData'
import { CardSkeleton, CardTitle, ResearchCard } from './ResearchCard'
import { SourceLine } from './SourceLine'

const WINDOWS = ['90', '180', '365'] as const

function TxRow({ t }: { t: InsiderTx }) {
  const buy = t.code === 'P'
  return (
    <li className="flex items-start justify-between gap-3 py-2 text-[12px]">
      <div className="min-w-0">
        <div className="truncate font-medium text-fg-primary">{t.insider ?? 'Unknown insider'}</div>
        <div className="truncate text-[11px] text-fg-muted">
          {[t.title || t.relationship, t.date, t.plan_10b5_1 ? '10b5-1 plan' : null].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <div className={cn('font-semibold', buy ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
          {buy ? 'Buy' : 'Sell'} {fmtCompact(t.value, '$')}
        </div>
        <div className="text-[11px] text-fg-muted">
          {fmtCompact(t.shares)} sh{t.price ? ` @ $${t.price.toFixed(2)}` : ''}
          {t.url && (
            <a href={t.url} target="_blank" rel="noopener noreferrer" aria-label="Form 4 filing on SEC EDGAR" className="ml-1 inline-flex align-middle hover:text-fg-secondary">
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </li>
  )
}

/** SEC Form 4 insider activity (desktop + mobile: rendered by ResearchTabPanels). */
export default function InsiderActivityPanel({ symbol }: { symbol: string }) {
  const [win, setWin] = useState<(typeof WINDOWS)[number]>('180')
  const { data, isLoading, isError, refetch } = useInsiders(symbol)
  const loading = isLoading || (data?.syncing && data.status !== 'ok')

  return (
    <ResearchCard testId="insider-activity" busy={!!loading} ariaLabel="Insider activity">
      <CardTitle
        rule="Open-market purchases (code P) and sales (code S) of common stock reported on SEC Form 4. Awards, option exercises and tax withholding are not counted."
        right={
          <div role="group" aria-label="Window" className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWin(w)}
                aria-pressed={win === w}
                className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium', win === w ? 'bg-blue-600 text-white' : 'text-fg-muted hover:text-fg-secondary')}
              >
                {w === '365' ? '1Y' : `${w}D`}
              </button>
            ))}
          </div>
        }
      >
        Insider activity
      </CardTitle>

      {loading ? (
        <div className="space-y-2" data-testid="insider-skeleton">
          <CardSkeleton className="h-12 w-full" />
          <CardSkeleton className="h-8 w-full" />
          <CardSkeleton className="h-8 w-full" />
          <p className="text-[11px] text-fg-muted">Reading SEC Form 4 filings for {symbol}…</p>
        </div>
      ) : isError || !data ? (
        <div className="text-[13px] text-fg-muted">
          Insider data could not be loaded.{' '}
          <button type="button" onClick={() => refetch()} className="text-blue-600 underline dark:text-blue-400">Retry</button>
        </div>
      ) : data.status !== 'ok' ? (
        <p className="text-[13px] text-fg-muted">
          {data.refresh_error
            ? `SEC EDGAR did not return Form 4 data for ${symbol} (${data.refresh_error}).`
            : `No Form 4 insider filings for ${symbol} in the last 13 months.`}
        </p>
      ) : (
        <InsiderBody data={data} win={win} />
      )}
      <SourceLine attribution={data?.attribution} extra="Form 4 is due 2 business days after the trade" testId="insider-source" />
    </ResearchCard>
  )
}

function InsiderBody({ data, win }: { data: NonNullable<ReturnType<typeof useInsiders>['data']>; win: string }) {
  const s = data.summary[win]
  const net = netActivityLabel(s)
  const cutoff = new Date(Date.now() - Number(win) * 86_400_000).toISOString().slice(0, 10)
  const trades = data.transactions.filter((t) => (t.code === 'P' || t.code === 'S') && !t.derivative && (t.date ?? '') >= cutoff)
  return (
    <>
      <div className="keep-cols grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Net" value={net.label} tone={net.tone} wide />
        <Stat label="Buys" value={`${s?.buy_transactions ?? 0} · ${fmtCompact(s?.buy_value, '$')}`} />
        <Stat label="Sells" value={`${s?.sell_transactions ?? 0} · ${fmtCompact(s?.sell_value, '$')}`} />
        <Stat wide label="Insiders selling" value={`${s?.distinct_sellers ?? 0}${s?.sells_under_10b5_1_plan ? ` (${s.sells_under_10b5_1_plan} plan sales)` : ''}`} />
      </div>
      {trades.length === 0 ? (
        <p className="mt-3 text-[12px] text-fg-muted">No open-market buys or sells in this window.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-subtle" aria-label="Recent open-market insider trades">
          {trades.slice(0, 8).map((t, i) => (
            <TxRow key={`${t.url}-${i}`} t={t} />
          ))}
        </ul>
      )}
    </>
  )
}

function Stat({ label, value, tone, wide }: { label: string; value: string; tone?: 'buy' | 'sell' | 'none'; wide?: boolean }) {
  return (
    <div className={cn('rounded-lg bg-slate-100 px-3 py-2 dark:bg-white/5', wide && 'col-span-2 sm:col-span-1')}>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div
        className={cn(
          'truncate text-[13px] font-semibold tabular-nums text-fg-primary',
          tone === 'buy' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'sell' && 'text-red-600 dark:text-red-400',
        )}
      >
        {value}
      </div>
    </div>
  )
}
