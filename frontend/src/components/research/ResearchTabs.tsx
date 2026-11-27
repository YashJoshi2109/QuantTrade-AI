'use client'

import { useRef, type KeyboardEvent } from 'react'
import { Newspaper } from 'lucide-react'
import LiveNews from '@/components/LiveNews'
import KeyFactorsPanel from '@/components/KeyFactorsPanel'
import FundamentalsPanel from '@/components/FundamentalsPanel'
import TechnicalAnalysisGauge from '@/components/TechnicalAnalysisGauge'
import type { FundamentalsData, Indicators } from '@/lib/api'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'
import { cn } from '@/lib/utils'
import { RESEARCH_TABS, RESEARCH_TAB_LABELS, type ResearchTab } from '@/lib/researchPrefs'
import type { TechnicalInputs } from '@/lib/researchTechnicals'
import { CompanyFolioPanel } from './CompanyFolioPanel'
import EarningsShortInterestPanel from './EarningsShortInterestPanel'
import ForecastPanel from './ForecastPanel'
import InsiderActivityPanel from './InsiderActivityPanel'
import InstitutionalOwnershipPanel from './InstitutionalOwnershipPanel'
import OptionChainPanel from './OptionChainPanel'
import SecEdgarPanel from './SecEdgarPanel'
import { AiInsightsPanel, AiSummaryCard } from './AiInsightsPanel'
import { CardTitle, ResearchCard } from './ResearchCard'
import { TechnicalSummaryTiles } from './TechnicalCards'

export function ResearchTabBar({
  value,
  onChange,
  className,
  testIdPrefix = 'research-tab',
}: {
  value: ResearchTab
  onChange: (t: ResearchTab) => void
  className?: string
  testIdPrefix?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const n = RESEARCH_TABS.length
    const next = (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n
    onChange(RESEARCH_TABS[next])
    refs.current[next]?.focus()
  }
  return (
    <div role="tablist" aria-label="Research sections" className={cn('flex overflow-x-auto border-b border-line-subtle [scrollbar-width:none]', className)}>
      {RESEARCH_TABS.map((t, i) => {
        const active = value === t
        return (
          <button
            key={t}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${testIdPrefix}-${t}`}
            aria-selected={active}
            aria-controls={`${testIdPrefix}-panel`}
            tabIndex={active ? 0 : -1}
            data-testid={`${testIdPrefix}-${t}`}
            onClick={() => onChange(t)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
              active ? 'border-blue-600 text-fg-primary dark:border-blue-400' : 'border-transparent text-fg-muted hover:text-fg-secondary',
            )}
          >
            {RESEARCH_TAB_LABELS[t]}
          </button>
        )
      })}
    </div>
  )
}

export interface ResearchTabPanelsProps {
  tab: ResearchTab
  onTabChange: (t: ResearchTab) => void
  symbol: string
  tickerInfo: TickerInfo | undefined
  tickerInfoLoading: boolean
  fundamentals: FundamentalsData | null
  fundamentalsLoading: boolean
  indicators: Indicators | null
  indicatorsLoading: boolean
  technicals: TechnicalInputs | null
  price: number | null
  quote: { price?: number | null; percent?: number | null; volume?: number | null }
  showCompanyPanels: boolean
  onSync: () => void
  syncing: boolean
  testIdPrefix?: string
  /** mobile: fewer news items */
  newsLimit?: number
}

function NotApplicable({ symbol, what }: { symbol: string; what: string }) {
  return (
    <ResearchCard>
      <p className="text-[13px] text-fg-muted">
        {what} do not apply to {symbol} (not an operating company).
      </p>
    </ResearchCard>
  )
}

/**
 * Tab bar + Trend/Momentum/Volatility tiles + the panel for the selected tab.
 * Desktop and MobileResearch render this same component, so every existing
 * research panel is reachable from exactly one tab on both:
 *   Overview     Key factors, Price forecast range, Option chain, AI summary
 *   Fundamentals Fundamentals + valuation, Company profile, Earnings / short interest
 *   Financials   SEC EDGAR statements and filings
 *   Ownership    SEC Form 4 insider activity, SEC 13F institutional ownership
 *   News         Live news
 *   AI Insights  AI analysis (streamed), Technical analysis gauges, Copilot
 */
export function ResearchTabPanels(p: ResearchTabPanelsProps) {
  const prefix = p.testIdPrefix ?? 'research-tab'
  return (
    <div className="space-y-3">
      <ResearchTabBar value={p.tab} onChange={p.onTabChange} testIdPrefix={prefix} />
      <TechnicalSummaryTiles inputs={p.technicals} loading={p.indicatorsLoading} />
      <div role="tabpanel" id={`${prefix}-panel`} aria-labelledby={`${prefix}-${p.tab}`} className="space-y-4">
        {p.tab === 'overview' && (
          <>
            <KeyFactorsPanel
              indicators={p.indicators}
              fundamentals={p.fundamentals}
              price={p.price ?? undefined}
              loading={p.indicatorsLoading || p.fundamentalsLoading}
            />
            <ForecastPanel symbol={p.symbol} />
            <OptionChainPanel symbol={p.symbol} />
            <AiSummaryCard
              symbol={p.symbol}
              inputs={p.technicals}
              quote={p.quote}
              loading={p.indicatorsLoading}
              onOpenInsights={() => p.onTabChange('ai')}
            />
          </>
        )}

        {p.tab === 'fundamentals' &&
          (p.showCompanyPanels ? (
            <>
              <FundamentalsPanel
                fundamentals={p.fundamentals}
                price={p.price ?? undefined}
                loading={p.fundamentalsLoading}
                onSync={p.onSync}
                syncing={p.syncing}
              />
              <EarningsShortInterestPanel symbol={p.symbol} tickerInfo={p.tickerInfo} />
            </>
          ) : (
            <NotApplicable symbol={p.symbol} what="Company fundamentals" />
          ))}

        {p.tab === 'financials' &&
          (p.showCompanyPanels ? <SecEdgarPanel symbol={p.symbol} /> : <NotApplicable symbol={p.symbol} what="SEC filings and financial statements" />)}

        {p.tab === 'ownership' &&
          (p.showCompanyPanels ? (
            <>
              <InsiderActivityPanel symbol={p.symbol} />
              <InstitutionalOwnershipPanel symbol={p.symbol} />
            </>
          ) : (
            <NotApplicable symbol={p.symbol} what="Insider and institutional ownership filings" />
          ))}

        {p.tab === 'news' && (
          <ResearchCard testId="research-news">
            <CardTitle>
              <span className="inline-flex items-center gap-1.5">
                <Newspaper className="h-4 w-4 text-fg-muted" aria-hidden />
                {p.tickerInfo?.name ? `News · ${p.tickerInfo.name}` : `${p.symbol} news`}
              </span>
            </CardTitle>
            <LiveNews symbol={p.symbol} limit={p.newsLimit ?? 8} showTitle={false} />
          </ResearchCard>
        )}

        {p.tab === 'ai' && (
          <>
            <AiInsightsPanel symbol={p.symbol} inputs={p.technicals} quote={p.quote} loading={p.indicatorsLoading} />
            <TechnicalAnalysisGauge indicators={p.indicators} price={p.price ?? undefined} loading={p.indicatorsLoading} />
          </>
        )}
      </div>
    </div>
  )
}
