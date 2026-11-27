'use client'

import { cn } from '@/lib/utils'
import { fmtCompact, fmtSignedPct, useInstitutional } from '@/lib/publicData'
import { CardSkeleton, CardTitle, ResearchCard } from './ResearchCard'
import { SourceLine } from './SourceLine'

/** SEC 13F institutional ownership (desktop + mobile: rendered by ResearchTabPanels). */
export default function InstitutionalOwnershipPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, isError, refetch } = useInstitutional(symbol)

  return (
    <ResearchCard testId="institutional-ownership" busy={isLoading} ariaLabel="Institutional ownership">
      <CardTitle rule="Sum of 13F-HR share positions reported by institutional managers with over $100M in US equities. Holdings are as of the quarter end and filed up to 45 days later.">
        Institutional ownership
      </CardTitle>

      {isLoading ? (
        <div className="space-y-2" data-testid="institutional-skeleton">
          <CardSkeleton className="h-12 w-full" />
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="text-[13px] text-fg-muted">
          13F data could not be loaded.{' '}
          <button type="button" onClick={() => refetch()} className="text-blue-600 underline dark:text-blue-400">Retry</button>
        </div>
      ) : data.status !== 'ok' ? (
        <p className="text-[13px] text-fg-muted">
          {data.reason ?? `No 13F holdings loaded for ${symbol}.`}
        </p>
      ) : (
        <>
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Quarter ending {data.period}. 13F reports are filed up to 45 days after quarter end, so this is a
            lagging view, not current positioning.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Institutions" value={(data.holders ?? 0).toLocaleString()}
              sub={data.qoq?.holders_change != null ? `${data.qoq.holders_change >= 0 ? '+' : ''}${data.qoq.holders_change.toLocaleString()} QoQ` : undefined} />
            <Stat label="Shares held" value={fmtCompact(data.total_shares)}
              sub={data.qoq?.shares_change_pct != null ? `${fmtSignedPct(data.qoq.shares_change_pct)} QoQ` : undefined}
              up={data.qoq?.shares_change_pct != null ? data.qoq.shares_change_pct >= 0 : undefined} />
            <Stat label="Reported value" value={fmtCompact(data.total_value_usd, '$')} />
          </div>
          <div className="mt-3 overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line-subtle pb-1 text-[10px] uppercase tracking-wide text-fg-muted">
              <span>Top holders</span>
              <span className="text-right">Shares</span>
              <span className="w-16 text-right">QoQ</span>
            </div>
            <ul className="divide-y divide-line-subtle">
              {(data.top_holders ?? []).map((h) => (
                <li key={`${h.filer}-${h.filed}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 py-1.5 text-[12px]">
                  <span className="truncate text-fg-primary" title={h.filer ?? ''}>{h.filer}</span>
                  <span className="text-right tabular-nums text-fg-secondary">{fmtCompact(h.shares)}</span>
                  <span
                    className={cn(
                      'w-16 text-right tabular-nums',
                      h.change_pct == null ? 'text-fg-muted' : h.change_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                    )}
                  >
                    {h.change_pct == null ? 'n/a' : fmtSignedPct(h.change_pct)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      <SourceLine attribution={data?.attribution} testId="institutional-source" />
    </ResearchCard>
  )
}

function Stat({ label, value, sub, up }: { label: string; value: string; sub?: string; up?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-white/5">
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-[13px] font-semibold tabular-nums text-fg-primary">{value}</div>
      {sub && (
        <div className={cn('text-[11px] tabular-nums', up === undefined ? 'text-fg-muted' : up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
          {sub}
        </div>
      )}
    </div>
  )
}
