'use client'

import { AlertTriangle, BarChart3, ExternalLink, FileText, Globe, LineChart, Newspaper, X } from 'lucide-react'
import type { CitationData } from '@/lib/copilot-engine'
import { citationKindLabel } from '@/lib/copilot-handoff'
import { citationFreshness } from '@/lib/copilot-trust'

const ICON: Record<string, typeof FileText> = {
  filing: FileText, statement: BarChart3, news: Newspaper, forecast: LineChart, macro: Globe,
}

function Row({ k, v }: { k: string; v?: string | number | null }) {
  if (v == null || v === '') return null
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-[13px] text-[var(--cp-ink-3)]">{k}</dt>
      <dd className="truncate text-right text-[13px] font-medium tabular-nums text-[var(--cp-ink)]">{String(v)}</dd>
    </div>
  )
}

/** Date-only strings ("2026-10-26") stay as written; timestamps use local time. */
function when(v?: string | null): string | null {
  if (!v) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

function secUrl(c: CitationData): string | null {
  if (c.url) return c.url
  if (c.accession) return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&State=&type=${encodeURIComponent(c.filing_type ?? '')}&company=${encodeURIComponent(c.ticker ?? '')}`
  return null
}

/** Source drawer for a clicked citation: what it is, how old it is, where to read the original. */
export default function CitationSourcePanel({ citation, onClose }: { citation: CitationData; onClose: () => void }) {
  const Icon = ICON[citation.kind] ?? FileText
  const link = citation.kind === 'news' || citation.kind === 'statement' ? citation.url ?? null : citation.kind === 'filing' ? secUrl(citation) : null
  const fresh = citationFreshness(citation)
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--cp-panel)]" data-testid="citation-source-panel" role="region" aria-label="Source details">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--cp-line)] px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-md bg-[var(--cp-sunken)] px-1 text-[12px] font-semibold tabular-nums text-[var(--cp-ink-2)]">
            {citation.n}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12px] text-[var(--cp-ink-3)]">
              <Icon className="h-3.5 w-3.5" aria-hidden /> {citationKindLabel(citation.kind)}
            </p>
            <h2 className="text-[15px] font-semibold leading-snug text-[var(--cp-ink)]">{citation.kind === 'news' ? citation.title ?? citation.label : citation.label}</h2>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close source"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)] hover:text-[var(--cp-ink)]">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="cp-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <p className={fresh.stale ? 'text-[13px] font-medium text-[var(--cp-caution-ink)]' : 'text-[13px] text-[var(--cp-ink-2)]'}>
          {fresh.asOf ? `Dated ${fresh.label}.` : 'This source has no date.'}{fresh.stale && fresh.staleReason ? ` ${fresh.staleReason}.` : ''}
        </p>
        {citation.suspicious && (
          <div className="flex gap-2 rounded-lg border border-[var(--cp-caution-line)] bg-[var(--cp-caution-soft)] px-3 py-2 text-[13px] text-[var(--cp-caution-ink)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            This source contains instruction-like text. The copilot treated it as data only.
          </div>
        )}
        {citation.snippet && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-[var(--cp-ink-2)]">
              {citation.kind === 'filing' ? `${citation.section ?? 'Filing'} excerpt` : 'Excerpt'}
            </p>
            <blockquote className="cp-serif border-l-2 border-[var(--cp-line-strong)] pl-3 text-[15px] leading-relaxed text-[var(--cp-ink-2)]">{citation.snippet}</blockquote>
          </div>
        )}
        <dl className="rounded-xl border border-[var(--cp-line)] bg-[var(--cp-canvas)] px-3 py-2">
          <Row k="Ticker" v={citation.ticker} />
          <Row k="Form" v={citation.filing_type} />
          <Row k="Fiscal year" v={citation.fiscal_year} />
          <Row k="Section" v={citation.section} />
          <Row k="Period" v={citation.period} />
          <Row k="Filed" v={citation.filed_date} />
          <Row k="Accession" v={citation.accession} />
          <Row k="Publisher" v={citation.publisher} />
          <Row k="Published" v={when(citation.published_at)} />
          <Row k="As of" v={when(citation.as_of)} />
          <Row k="Data source" v={citation.source} />
          <Row k="Citation id" v={citation.id} />
        </dl>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-[36px] items-center gap-1.5 text-[14px] font-semibold text-[var(--cp-accent-ink)] underline underline-offset-2">
            Open the original <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}
