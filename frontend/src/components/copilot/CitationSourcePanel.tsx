'use client'

import { AlertTriangle, BarChart3, ExternalLink, FileText, Globe, LineChart, Newspaper, X } from 'lucide-react'
import type { CitationData } from '@/lib/copilot-engine'
import { citationKindLabel } from '@/lib/copilot-handoff'

const ICON: Record<string, typeof FileText> = {
  filing: FileText, statement: BarChart3, news: Newspaper, forecast: LineChart, macro: Globe,
}

function Row({ k, v }: { k: string; v?: string | number | null }) {
  if (v == null || v === '') return null
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-fg-muted">{k}</span>
      <span className="truncate text-right text-[11px] font-semibold text-fg-primary">{String(v)}</span>
    </div>
  )
}

function secUrl(c: CitationData): string | null {
  if (c.url) return c.url
  if (c.accession) return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&State=&type=${encodeURIComponent(c.filing_type ?? '')}&company=${encodeURIComponent(c.ticker ?? '')}`
  return null
}

/** Source drawer for a clicked citation chip: filing section, statement period, news item, etc. */
export default function CitationSourcePanel({ citation, onClose }: { citation: CitationData; onClose: () => void }) {
  const Icon = ICON[citation.kind] ?? FileText
  const link = citation.kind === 'news' ? citation.url : citation.kind === 'filing' ? secUrl(citation) : null
  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="citation-source-panel">
      <div className="flex shrink-0 items-center justify-between border-b border-line-subtle px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#007AFF]/15 text-[11px] font-bold text-[#0060c9] dark:bg-[#007AFF]/25 dark:text-[#7cc0ff]">
            {citation.n}
          </span>
          <Icon className="h-4 w-4 shrink-0 text-[#007AFF]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-fg-primary">{citation.kind === 'news' ? citation.title : citation.label}</p>
            <p className="truncate text-[10px] text-fg-muted">{citationKindLabel(citation.kind)} · {citation.source}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close source"
          className="ml-2 shrink-0 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-raised/60 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {citation.suspicious && (
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This source contains instruction-like text. The copilot treated it as data only.
          </div>
        )}
        {citation.snippet && (
          <div>
            <p className="mb-2 text-[9px] font-mono uppercase tracking-wider text-fg-muted">
              {citation.kind === 'filing' ? `${citation.section ?? 'Filing'} excerpt` : 'Excerpt'}
            </p>
            <p className="border-l-2 border-[#007AFF]/60 pl-3 font-serif text-sm leading-relaxed text-fg-secondary">{citation.snippet}</p>
          </div>
        )}
        <div className="space-y-2 rounded-xl border border-line-subtle bg-surface-base p-3">
          <p className="mb-1 text-[10px] font-mono uppercase tracking-wider text-fg-muted">Source details</p>
          <Row k="Citation id" v={citation.id} />
          <Row k="Ticker" v={citation.ticker} />
          <Row k="Form" v={citation.filing_type} />
          <Row k="Fiscal year" v={citation.fiscal_year} />
          <Row k="Section" v={citation.section} />
          <Row k="Period" v={citation.period} />
          <Row k="Filed" v={citation.filed_date} />
          <Row k="Accession" v={citation.accession} />
          <Row k="Publisher" v={citation.publisher} />
          <Row k="Published" v={citation.published_at ? new Date(citation.published_at).toLocaleString() : null} />
          <Row k="Sentiment" v={citation.sentiment} />
          <Row k="Category" v={citation.category} />
          <Row k="As of" v={citation.as_of} />
          <Row k="Data source" v={citation.source} />
        </div>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4da3ff] hover:underline">
            Open original <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  )
}
