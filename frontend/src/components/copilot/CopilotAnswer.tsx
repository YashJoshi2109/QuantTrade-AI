'use client'

import { useId, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import {
  AlertCircle,
  BarChart3,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Copy,
  FileText,
  Globe,
  Info,
  LineChart,
  Newspaper,
  RotateCcw,
  Activity,
  ListChecks,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react'
import type { CitationData, CopilotDone, CopilotPlan, CopilotProgress } from '@/lib/copilot-engine'
import {
  collapseProgress,
  isNumericCell,
  isStructuredAnswer,
  splitMarkdownBlocks,
  splitSections,
  withoutSourcesSection,
  type TableSegment,
} from '@/lib/copilot-rich'
import {
  citationIdFromHref,
  citationKindLabel,
  citationShortLabel,
  linkifyCitations,
} from '@/lib/copilot-handoff'
import {
  citationFreshness,
  citationTitle,
  markUnverified,
  splitAnswer,
  stripDisclaimer,
  summarizeTrust,
  toPlainText,
  type AnswerTone,
  type CopilotLimitNotice,
} from '@/lib/copilot-trust'
import { formatResetsIn } from '@/lib/copilot-usage'
import { cn } from '@/lib/utils'

export interface CopilotMessageView {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  error?: boolean
  timestamp: Date
  citations?: CitationData[]
  done?: CopilotDone | null
  notice?: CopilotLimitNotice | null
  tone?: AnswerTone
  noFilings?: string[]
  /** Deep questions: plan + streamed progress of long-running steps. */
  plan?: CopilotPlan | null
  progress?: CopilotProgress[]
}

const KIND_ICON: Record<string, typeof FileText> = {
  filing: FileText, statement: BarChart3, news: Newspaper, forecast: LineChart, quote: Activity,
  fundamentals: BarChart3, technicals: Activity, macro: Globe, movers: Activity,
}

function fmtTime(d: Date | null): string {
  return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
}

// ─── User question ───────────────────────────────────────────────────────────

export function UserQuestion({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[min(36rem,85%)] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--cp-accent-soft)] px-4 py-2.5 text-[15px] leading-relaxed text-[var(--cp-ink)]">
        <span className="sr-only">You asked: </span>
        {text}
      </p>
    </div>
  )
}

// ─── Limit / error notice (never a silent failure, never red) ───────────────

export function LimitNoticeCard({
  notice,
  now,
  noticeAt,
  resetsInSeconds,
  onRetry,
  onUpgrade,
  isPro,
}: {
  notice: CopilotLimitNotice
  now: number
  noticeAt: number
  resetsInSeconds: number | null
  onRetry?: () => void
  onUpgrade?: () => void
  isPro?: boolean
}) {
  const waitLeft = notice.retryAfterS != null ? Math.ceil(notice.retryAfterS - (now - noticeAt) / 1000) : null
  const canRetry = notice.kind === 'per_minute' ? (waitLeft ?? 0) <= 0 : notice.kind === 'other'
  return (
    <div role="status" className="rounded-2xl border border-[var(--cp-caution-line)] bg-[var(--cp-caution-soft)] p-4 sm:p-5">
      <div className="flex gap-3">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--cp-caution-ink)]" aria-hidden />
        <div className="min-w-0 text-[var(--cp-ink)]">
          <p className="text-[15px] font-semibold">{notice.title}</p>
          <p className="mt-1 text-[14px] leading-relaxed text-[var(--cp-ink-2)]">{notice.body}</p>
          {notice.kind === 'daily' && (
            <p className="mt-1 text-[14px] font-medium tabular-nums text-[var(--cp-ink)]">
              Your allowance {formatResetsIn(resetsInSeconds)}.
            </p>
          )}
          {notice.kind === 'per_minute' && waitLeft != null && waitLeft > 0 && (
            <p className="mt-1 text-[14px] font-medium tabular-nums text-[var(--cp-ink)]" aria-live="off">
              Ready in about {waitLeft}s.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {onRetry && (notice.kind === 'per_minute' || notice.kind === 'other') && (
              <button
                type="button"
                onClick={onRetry}
                disabled={!canRetry}
                className="min-h-[36px] rounded-lg bg-[var(--cp-accent)] px-3.5 text-sm font-semibold text-[var(--cp-on-accent)] disabled:cursor-not-allowed disabled:bg-[var(--cp-sunken)] disabled:text-[var(--cp-ink-3)]"
              >
                Ask again
              </button>
            )}
            {notice.kind === 'daily' && !isPro && onUpgrade && (
              <button type="button" onClick={onUpgrade} className="min-h-[36px] text-sm font-semibold text-[var(--cp-accent-ink)] underline underline-offset-2">
                See Pro plans
              </button>
            )}
            {notice.kind === 'auth' && (
              <a href="/auth" className="inline-flex min-h-[36px] items-center rounded-lg bg-[var(--cp-accent)] px-3.5 text-sm font-semibold text-[var(--cp-on-accent)]">
                Sign in
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Markdown renderer with citation chips ──────────────────────────────────

function useMarkdownComponents(citations: CitationData[] | undefined, onCitationClick: (c: CitationData) => void): Components {
  return useMemo<Components>(() => {
    const byId = (id: string): CitationData =>
      citations?.find((c) => c.id === id) ??
      ({ id, n: 0, kind: id.split(':')[0], source: 'Source details arrive when the answer finishes', label: id } as CitationData)
    return {
      a: ({ href, children }) => {
        if (href === '#unverified') {
          return (
            <span
              className="mx-0.5 rounded bg-[var(--cp-caution-soft)] px-1 text-[0.8em] font-medium text-[var(--cp-caution-ink)] underline decoration-dotted underline-offset-2"
              title="This figure could not be matched to a cited source"
            >
              unverified
            </span>
          )
        }
        const cid = citationIdFromHref(href)
        if (cid) {
          const c = byId(cid)
          return (
            <button
              type="button"
              onClick={() => onCitationClick(c)}
              aria-label={`Source ${c.n || ''}: ${citationKindLabel(c.kind)}, ${citationShortLabel(c)}`}
              className="mx-[1px] inline-flex !h-[1.35em] !min-h-0 min-w-[1.35em] !py-0 -translate-y-[0.1em] items-center justify-center rounded-md border border-[var(--cp-line-strong)] bg-[var(--cp-panel)] px-1 align-middle text-[0.72em] font-semibold leading-none text-[var(--cp-accent-ink)] hover:border-[var(--cp-accent)] hover:bg-[var(--cp-accent-soft)]"
            >
              {children}
            </button>
          )
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        )
      },
    }
  }, [citations, onCitationClick])
}

function InlineMarkdown({ text, components }: { text: string; components: Components }) {
  return (
    <ReactMarkdown components={{ ...components, p: ({ children }) => <>{children}</> }}>{text}</ReactMarkdown>
  )
}

function AnswerTable({ table, components }: { table: TableSegment; components: Components }) {
  const numericCol = table.header.map((_, k) => table.rows.length > 0 && table.rows.every((r) => !r[k] || isNumericCell(r[k])))
  return (
    <div className="cp-table-wrap" role="region" aria-label="Results table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {table.header.map((h, k) => (
              <th key={k} scope="col" className={numericCol[k] ? 'cp-num' : undefined}>
                <InlineMarkdown text={h} components={components} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, k) => (
                <td key={k} className={numericCol[k] || isNumericCell(cell) ? 'cp-num' : undefined}>
                  <InlineMarkdown text={cell} components={components} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Markdown with real (scrollable) tables; react-markdown alone renders pipe tables as text. */
function Markdown({ text, components }: { text: string; components: Components }) {
  const segments = splitMarkdownBlocks(text)
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'table' ? (
          <AnswerTable key={i} table={s} components={components} />
        ) : (
          <ReactMarkdown key={i} components={components}>{s.text}</ReactMarkdown>
        ),
      )}
    </>
  )
}

/** Deep answers: every section visible; facts-vs-assumptions and limitations set apart. */
function StructuredAnswer({ text, components }: { text: string; components: Components }) {
  return (
    <>
      {splitSections(text).map((s, i) => {
        const body = (
          <>
            {s.title && <h2>{s.title}</h2>}
            <Markdown text={s.body} components={components} />
          </>
        )
        if (s.key === 'facts_vs_assumptions') {
          return <section key={i} className="cp-section-facts" aria-label="Verified facts versus assumptions">{body}</section>
        }
        if (s.key === 'limitations') {
          return <section key={i} className="cp-section-limits" aria-label="Limitations">{body}</section>
        }
        return <section key={i}>{body}</section>
      })}
    </>
  )
}

// ─── Deep-question progress ─────────────────────────────────────────────────

function ProgressIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--cp-accent-ink)] motion-reduce:animate-none" aria-hidden />
  if (status === 'error' || status === 'failed') return <XCircle className="h-3.5 w-3.5 shrink-0 text-[var(--cp-caution-ink)]" aria-hidden />
  if (status === 'unavailable') return <MinusCircle className="h-3.5 w-3.5 shrink-0 text-[var(--cp-ink-3)]" aria-hidden />
  return <Check className="h-3.5 w-3.5 shrink-0 text-[var(--cp-sourced)]" aria-hidden />
}

function ProgressList({ items, limit = 8 }: { items: CopilotProgress[]; limit?: number }) {
  const shown = items.slice(-limit)
  return (
    <ul className="mt-2 space-y-1" aria-label="Analysis steps">
      {shown.map((p, i) => (
        <li key={(p.id ?? p.label) + i} className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--cp-ink-2)]">
          <ProgressIcon status={p.status} />
          <span className="truncate">{p.label}{p.status === 'running' ? '…' : ''}</span>
          {p.status === 'error' && <span className="shrink-0 text-[var(--cp-caution-ink)]">not available</span>}
        </li>
      ))}
    </ul>
  )
}

const STEP_STATUS: Record<string, string> = {
  done: 'computed', partial: 'partly computed', in_context: 'from context', planned: 'requested',
  failed: 'failed, not executed', unavailable: 'no tool, not executed',
}

function PlanSummary({ plan }: { plan: CopilotPlan }) {
  const notRun = plan.steps.filter((s) => s.status === 'failed' || s.status === 'unavailable').length
  return (
    <details className="mt-3 rounded-lg border border-[var(--cp-line)] px-3 py-2 text-[13px] text-[var(--cp-ink-2)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-[var(--cp-ink)]">
        <ListChecks className="h-4 w-4 shrink-0 text-[var(--cp-ink-3)]" aria-hidden />
        How this was computed: {plan.steps.length} {plan.steps.length === 1 ? 'step' : 'steps'}
        {notRun > 0 && <span className="font-normal text-[var(--cp-caution-ink)]">, {notRun} not executed</span>}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {plan.steps.map((s) => (
          <li key={s.id} className="flex min-w-0 items-start gap-2">
            <span className="mt-[2px]"><ProgressIcon status={s.status === 'planned' ? 'done' : s.status} /></span>
            <span className="min-w-0">
              <span className="text-[var(--cp-ink)]">{s.label}</span>
              <span className="text-[var(--cp-ink-3)]"> · {STEP_STATUS[s.status] ?? s.status}</span>
              {s.tools.length > 0 && (
                <span className="block break-words font-mono text-[11.5px] text-[var(--cp-ink-3)]">{s.tools.join(', ')}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

// ─── Sources ledger ─────────────────────────────────────────────────────────

/** "Item 1A · filed Feb 26, 2026 · accession 0001045810-26-000012" for filing-backed sources. */
function provenanceLine(c: CitationData): string {
  const bits: string[] = []
  if (c.kind === 'computed' && c.filing_type) bits.push(c.filing_type)
  if (c.kind === 'computed' && c.section) bits.push(c.section)
  if (c.filed_date && c.kind !== 'statement') bits.push(`filed ${String(c.filed_date).slice(0, 10)}`)
  if (c.accession) bits.push(`accession ${c.accession}`)
  return bits.join(' · ')
}

function SourcesLedger({ citations, now, onCitationClick, limit = 12 }: { citations: CitationData[]; now: number; onCitationClick: (c: CitationData) => void; limit?: number }) {
  const extra = citations.length - limit
  return (
    <>
    <ol className="mt-2 grid gap-1.5 sm:grid-cols-2" aria-label="Sources">
      {citations.slice(0, limit).map((c) => {
        const f = citationFreshness(c, now)
        const Icon = KIND_ICON[c.kind] ?? FileText
        const prov = provenanceLine(c)
        return (
          <li key={c.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onCitationClick(c)}
              className="flex w-full min-w-0 items-start gap-2.5 rounded-lg border border-[var(--cp-line)] bg-[var(--cp-panel)] px-2.5 py-2 text-left hover:border-[var(--cp-accent)]"
            >
              <span className="mt-[1px] flex h-5 min-w-5 items-center justify-center rounded bg-[var(--cp-sunken)] px-1 text-[11px] font-semibold tabular-nums text-[var(--cp-ink-2)]">
                {c.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--cp-ink)]">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--cp-ink-3)]" aria-hidden />
                  <span className="truncate">{citationTitle(c)}</span>
                </span>
                <span className="mt-0.5 block text-[12px] text-[var(--cp-ink-3)]">
                  {citationKindLabel(c.kind)}
                  {c.kind === 'news' && c.publisher ? `, ${c.publisher}` : ''}
                  {', '}
                  {f.stale ? (
                    <span className="font-medium text-[var(--cp-caution-ink)]">{f.label}. {f.staleReason}</span>
                  ) : (
                    <span className="tabular-nums">{f.label}</span>
                  )}
                </span>
                {prov && <span className="mt-0.5 block break-words text-[11.5px] tabular-nums text-[var(--cp-ink-3)]">{prov}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
    {extra > 0 && (
      <p className="mt-1.5 text-[12px] text-[var(--cp-ink-3)]">
        and {extra} more {extra === 1 ? 'source' : 'sources'}, listed in the copied answer
      </p>
    )}
    </>
  )
}

function TrustStrip({ msg, now }: { msg: CopilotMessageView; now: number }) {
  const t = summarizeTrust(msg.citations, msg.done, now)
  const items: ReactNode[] = []
  if (t.unsourced) {
    items.push(
      <span key="src" className="inline-flex items-center gap-1.5 text-[var(--cp-ink-2)]">
        <Info className="h-3.5 w-3.5" aria-hidden /> No market data cited in this answer
      </span>,
    )
  } else {
    items.push(
      <span key="src" className="inline-flex items-center gap-1.5 font-medium text-[var(--cp-sourced)]">
        <Check className="h-3.5 w-3.5" aria-hidden /> {t.sourceCount} {t.sourceCount === 1 ? 'source' : 'sources'} cited
      </span>,
    )
  }
  if (t.quoteAsOf) items.push(<span key="q" className="tabular-nums">Price as of {fmtTime(t.quoteAsOf)}</span>)
  if (t.staleCount) {
    items.push(
      <span key="stale" className="inline-flex items-center gap-1 font-medium text-[var(--cp-caution-ink)]">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {t.staleCount} older {t.staleCount === 1 ? 'source' : 'sources'}
      </span>,
    )
  }
  if (t.unverifiedNumbers.length) {
    items.push(
      <span key="unv" className="inline-flex items-center gap-1 font-medium text-[var(--cp-caution-ink)]" title={t.unverifiedNumbers.join(', ')}>
        <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {t.unverifiedNumbers.length} {t.unverifiedNumbers.length === 1 ? 'figure' : 'figures'} not matched to a source
      </span>,
    )
  }
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--cp-ink-3)]">{items}</div>
}

// ─── Assistant answer ───────────────────────────────────────────────────────

export function AssistantAnswer({
  msg,
  now,
  statusText,
  isLast,
  followUps,
  onCitationClick,
  onRegenerate,
  onAsk,
}: {
  msg: CopilotMessageView
  now: number
  /** "Reading NVDA's quote, filings and news" while nothing has streamed yet. */
  statusText?: string
  isLast?: boolean
  followUps?: string[]
  onCitationClick: (c: CitationData) => void
  onRegenerate?: () => void
  onAsk?: (q: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const detailsId = useId()
  const components = useMarkdownComponents(msg.citations, onCitationClick)

  const { body } = stripDisclaimer(msg.content)
  const done = !msg.streaming
  // Deep answers (Summary / Data & Method / Results / ... / Sources): show every
  // section; the citation ledger below replaces the text Sources list once done.
  const structured = isStructuredAnswer(body)
  const shownBody = structured && done && (msg.citations?.length ?? 0) > 0 ? withoutSourcesSection(body) : body
  const linked = markUnverified(linkifyCitations(shownBody, msg.streaming ? null : msg.citations))
  const parts = splitAnswer(linked)
  const tone = msg.tone ?? 'normal'
  const hasForecast = (msg.citations ?? []).some((c) => c.kind === 'forecast')
  const progress = collapseProgress(msg.progress)
  const plan = msg.done?.plan ?? msg.plan ?? null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(msg.content))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked */
    }
  }

  // Waiting for the first token: a status line and reserved skeleton lines.
  if (msg.streaming && !msg.content) {
    return (
      <div aria-busy="true" className="min-h-[96px]">
        <p className="text-[14px] text-[var(--cp-ink-2)]">{statusText || 'Gathering sources'}…</p>
        {progress.length > 0 && <ProgressList items={progress} />}
        <div aria-hidden className="mt-3 space-y-2.5">
          <div className="cp-skeleton h-3.5 w-[92%]" />
          <div className="cp-skeleton h-3.5 w-[78%]" />
          <div className="cp-skeleton h-3.5 w-[55%]" />
        </div>
      </div>
    )
  }

  const answerBody = structured ? (
    <div className="cp-answer">
      {msg.streaming && progress.some((p) => p.status === 'running') && <ProgressList items={progress} limit={4} />}
      <StructuredAnswer text={linked} components={components} />
      {msg.streaming && <span className="cp-caret" aria-hidden />}
    </div>
  ) : (
    <div className="cp-answer">
      {msg.streaming && progress.some((p) => p.status === 'running') && <ProgressList items={progress} limit={4} />}
      <Markdown text={parts.summary} components={components} />
      {parts.details && !expanded && msg.streaming && <span className="sr-only">More detail is being written.</span>}
      {parts.details && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={detailsId}
            className="mt-3 flex w-full items-center gap-2 rounded-lg border border-[var(--cp-line)] px-3 py-2 text-left text-[14px] text-[var(--cp-ink-2)] hover:border-[var(--cp-line-strong)] hover:bg-[var(--cp-sunken)]"
          >
            <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', expanded && 'rotate-180')} aria-hidden />
            <span className="font-semibold text-[var(--cp-ink)]">{expanded ? 'Hide details' : 'Show details'}</span>
            {!expanded && parts.sectionTitles.length > 0 && (
              <span className="hidden min-w-0 truncate text-[var(--cp-ink-3)] sm:inline">{parts.sectionTitles.join(', ')}</span>
            )}
            {msg.streaming && !expanded && <span className="ml-auto shrink-0 text-[12px] text-[var(--cp-ink-3)]">still writing</span>}
          </button>
          <div id={detailsId} hidden={!expanded}>
            <Markdown text={parts.details} components={components} />
          </div>
        </>
      )}
      {msg.streaming && <span className="cp-caret" aria-hidden />}
    </div>
  )

  return (
    <article aria-busy={msg.streaming ? 'true' : 'false'} aria-label="Copilot answer" className="min-w-0">
      {tone === 'supportive' ? (
        <div className="rounded-2xl border border-[var(--cp-care-line)] bg-[var(--cp-care-soft)] p-4 sm:p-5">
          <p className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-[var(--cp-care-ink)]">
            <Compass className="h-4 w-4" aria-hidden /> A careful note before any big decision
          </p>
          {answerBody}
        </div>
      ) : tone === 'info' ? (
        <div className="rounded-2xl border border-[var(--cp-line)] bg-[var(--cp-panel)] p-4 sm:p-5">{answerBody}</div>
      ) : (
        answerBody
      )}

      {msg.noFilings && msg.noFilings.length > 0 && done && (
        <p className="mt-3 text-[13px] text-[var(--cp-ink-3)]">
          No SEC filings are indexed for {msg.noFilings.join(', ')}, so this answer uses market data and news only.
        </p>
      )}

      {done && msg.content && (
        <div className="mt-4 border-t border-[var(--cp-line)] pt-3">
          <TrustStrip msg={msg} now={now} />
          {msg.citations && msg.citations.length > 0 && (
            <SourcesLedger citations={msg.citations} now={now} onCitationClick={onCitationClick} limit={structured ? 24 : 12} />
          )}
          {plan && plan.deep && plan.steps.length > 0 && <PlanSummary plan={plan} />}
          {hasForecast && (
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--cp-ink-3)]">
              Forecast figures come from an experimental model. Read them as a range of outcomes, not a prediction.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={copy}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-[13px] text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)] hover:text-[var(--cp-ink)]"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {isLast && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-[13px] text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)] hover:text-[var(--cp-ink)]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden /> Regenerate
              </button>
            )}
            <span className="ml-auto text-[12px] text-[var(--cp-ink-3)]">
              Informational only, not financial advice. <span className="tabular-nums">{fmtTime(msg.timestamp)}</span>
            </span>
          </div>
        </div>
      )}

      {done && isLast && followUps && followUps.length > 0 && onAsk && (
        <div className="mt-4">
          <p className="text-[13px] font-semibold text-[var(--cp-ink-3)]">Ask next</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {followUps.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => onAsk(q)}
                  className="min-h-[36px] rounded-full border border-[var(--cp-line-strong)] bg-[var(--cp-panel)] px-3.5 py-1.5 text-left text-[14px] text-[var(--cp-ink)] hover:border-[var(--cp-accent)] hover:text-[var(--cp-accent-ink)]"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}
