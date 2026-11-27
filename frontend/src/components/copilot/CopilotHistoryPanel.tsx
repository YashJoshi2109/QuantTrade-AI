'use client'

import { useMemo, useState } from 'react'
import { Plus, Search, Trash2, X } from 'lucide-react'
import type { ConversationSummary } from '@/lib/api'
import { cn } from '@/lib/utils'

const DAY = 86_400_000

function bucket(iso: string, now: number): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'Older'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const s = startOfToday.getTime()
  if (t >= s) return 'Today'
  if (t >= s - DAY) return 'Yesterday'
  if (t >= s - 6 * DAY) return 'Earlier this week'
  return 'Older'
}

/** Conversation history: search, grouped by day, one-line titles. */
export default function CopilotHistoryPanel({
  conversations,
  activeId,
  loading,
  now,
  onSelect,
  onDelete,
  onNewChat,
  onClose,
}: {
  conversations: ConversationSummary[]
  activeId: string | null
  loading: boolean
  now: number
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onNewChat: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? conversations.filter((c) => `${c.title ?? ''} ${c.last_message ?? ''}`.toLowerCase().includes(q))
      : conversations
    const out: Array<{ label: string; items: ConversationSummary[] }> = []
    for (const c of filtered) {
      const label = bucket(c.updated_at, now)
      const g = out.find((x) => x.label === label)
      if (g) g.items.push(c)
      else out.push({ label, items: [c] })
    }
    return { out, count: filtered.length }
  }, [conversations, query, now])

  return (
    <nav aria-label="Conversation history" className="flex h-full w-full flex-col bg-[var(--cp-panel)]">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="flex-1 text-[15px] font-semibold text-[var(--cp-ink)]">History</h2>
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-[var(--cp-accent-ink)] hover:bg-[var(--cp-accent-soft)]"
        >
          <Plus className="h-4 w-4" aria-hidden /> New chat
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="px-3 pb-2">
        <label className="relative block">
          <span className="sr-only">Search conversations</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cp-ink-3)]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="h-9 w-full rounded-lg border border-[var(--cp-line)] bg-[var(--cp-canvas)] pl-8 pr-2 text-[14px] text-[var(--cp-ink)] placeholder:text-[var(--cp-ink-3)] focus:border-[var(--cp-focus)] focus:outline-none"
          />
        </label>
        {query && (
          <p className="mt-1.5 px-0.5 text-[12px] text-[var(--cp-ink-3)]" aria-live="polite">
            {groups.count} {groups.count === 1 ? 'match' : 'matches'}
          </p>
        )}
      </div>

      <div className="cp-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div aria-hidden className="space-y-3 px-1 pt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="cp-skeleton h-4" style={{ width: `${90 - (i % 3) * 15}%` }} />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 pt-4 text-[14px] leading-relaxed text-[var(--cp-ink-3)]">
            Your questions will appear here so you can pick them up later.
          </p>
        ) : groups.count === 0 ? (
          <p className="px-2 pt-4 text-[14px] text-[var(--cp-ink-3)]">No conversations match “{query}”.</p>
        ) : (
          groups.out.map((g) => (
            <section key={g.label} className="mt-2">
              <h3 className="px-2 pb-1 pt-2 text-[12px] font-semibold text-[var(--cp-ink-3)]">{g.label}</h3>
              <ul>
                {g.items.map((c) => {
                  const active = c.id === activeId
                  const title = (c.title || c.last_message || 'Untitled conversation').trim()
                  return (
                    <li key={c.id} className="group relative">
                      {confirmId === c.id ? (
                        <div className="flex items-center gap-2 rounded-lg bg-[var(--cp-sunken)] px-2 py-2 text-[13px]">
                          <span className="flex-1 text-[var(--cp-ink-2)]">Delete this conversation?</span>
                          <button type="button" onClick={() => { onDelete(c.id); setConfirmId(null) }} className="min-h-[32px] rounded-md px-2 font-semibold text-[var(--cp-down)] hover:bg-[var(--cp-panel)]">
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirmId(null)} className="min-h-[32px] rounded-md px-2 text-[var(--cp-ink-2)] hover:bg-[var(--cp-panel)]">
                            Keep
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onSelect(c.id)}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'block w-full truncate rounded-lg py-2 pl-2.5 pr-9 text-left text-[14px] leading-snug',
                              active
                                ? 'bg-[var(--cp-accent-soft)] font-medium text-[var(--cp-ink)]'
                                : 'text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)] hover:text-[var(--cp-ink)]',
                            )}
                            title={title}
                          >
                            {title}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(c.id)}
                            aria-label={`Delete conversation: ${title}`}
                            className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--cp-ink-3)] opacity-0 hover:bg-[var(--cp-panel)] hover:text-[var(--cp-ink)] focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  )
}
