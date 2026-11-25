'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  categoryMeta,
  DEFAULT_NEWS_CATEGORIES,
  PRIMARY_CATEGORY_TABS,
  type NewsCategory,
} from '@/lib/newsFeed'

export interface CategoryTab {
  key: string
  label: string
  count: number
}

/**
 * Split categories into visible tabs and a "More" overflow.
 * All is always shown; other zero-count tabs are hidden unless selected.
 */
export function buildCategoryTabs(
  categories: NewsCategory[],
  counts: Record<string, number>,
  total: number,
  selected: string
): { visible: CategoryTab[]; overflow: CategoryTab[] } {
  const cats = categories.length > 0 ? categories : DEFAULT_NEWS_CATEGORIES
  const byKey = new Map(cats.map((c) => [c.key, c]))
  const tab = (key: string): CategoryTab => ({
    key,
    label: byKey.get(key)?.label ?? categoryMeta(key).label,
    count: counts[key] ?? 0,
  })
  const keep = (t: CategoryTab) => t.count > 0 || t.key === selected
  const primaryKeys = PRIMARY_CATEGORY_TABS.filter((k) => byKey.has(k) || k in counts)
  const visible: CategoryTab[] = [{ key: 'all', label: 'All', count: total }]
  visible.push(...primaryKeys.map(tab).filter(keep))
  const overflowAll = cats
    .map((c) => c.key)
    .filter((k) => k !== 'all' && !primaryKeys.includes(k as (typeof PRIMARY_CATEGORY_TABS)[number]))
    .map(tab)
  // A selected overflow category is promoted to a visible tab so the active state is obvious.
  const promoted = overflowAll.find((t) => t.key === selected)
  if (promoted) visible.push(promoted)
  const overflow = overflowAll.filter((t) => t.count > 0 && t.key !== selected)
  return { visible, overflow }
}

export default function NewsCategoryTabs({
  categories,
  counts,
  total,
  value,
  onChange,
  idPrefix = 'news-cat',
  panelId,
}: {
  categories: NewsCategory[]
  counts: Record<string, number>
  total: number
  value: string
  onChange: (key: string) => void
  idPrefix?: string
  panelId?: string
}) {
  const { visible, overflow } = useMemo(
    () => buildCategoryTabs(categories, counts, total, value),
    [categories, counts, total, value]
  )
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const menuItemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    menuItemRefs.current[0]?.focus()
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (idx + 1) % visible.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + visible.length) % visible.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = visible.length - 1
    if (next < 0) return
    e.preventDefault()
    tabRefs.current[next]?.focus()
    onChange(visible[next].key)
  }

  const onMenuKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = -1
    if (e.key === 'ArrowDown') next = (idx + 1) % overflow.length
    else if (e.key === 'ArrowUp') next = (idx - 1 + overflow.length) % overflow.length
    else if (e.key === 'Escape') {
      e.preventDefault()
      setMoreOpen(false)
      return
    }
    if (next < 0) return
    e.preventDefault()
    menuItemRefs.current[next]?.focus()
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div
        role="tablist"
        aria-label="News categories"
        className="flex min-w-0 gap-1 overflow-x-auto rounded-lg border border-line-subtle bg-surface-raised p-0.5 [scrollbar-width:none]"
      >
        {visible.map((t, i) => {
          const selected = t.key === value
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              id={`${idPrefix}-${t.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.key)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
                selected ? 'bg-blue-500/15 text-blue-300' : 'text-fg-muted hover:text-fg-primary'
              }`}
            >
              {t.label}
              <span className={`font-mono text-[9px] ${selected ? 'text-blue-300/80' : 'text-fg-muted/80'}`}>{t.count}</span>
            </button>
          )
        })}
      </div>

      {overflow.length > 0 && (
        <div className="relative shrink-0" ref={moreRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMoreOpen(true)
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-line-subtle bg-surface-raised px-2 py-1.5 text-[10px] font-medium text-fg-muted transition-colors hover:text-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            More
            <ChevronDown className={`h-3 w-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {moreOpen && (
            <div
              role="menu"
              aria-label="More categories"
              className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-line-subtle bg-surface-base py-1 shadow-xl"
            >
              {overflow.map((t, i) => (
                <button
                  key={t.key}
                  ref={(el) => {
                    menuItemRefs.current[i] = el
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={t.key === value}
                  onKeyDown={(e) => onMenuKey(e, i)}
                  onClick={() => {
                    onChange(t.key)
                    setMoreOpen(false)
                  }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg-primary focus:bg-surface-raised focus:outline-none"
                >
                  <span>{t.label}</span>
                  <span className="font-mono text-[10px] text-fg-muted">{t.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
