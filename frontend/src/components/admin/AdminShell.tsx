'use client'

/**
 * Dedicated admin console shell (separate from the app shell): left sidebar
 * with sections, top bar with breadcrumb, console search (⌘K), notifications
 * and live status pill. Collapses to a drawer on mobile.
 */
import { ReactNode, useEffect, useRef, useState } from 'react'
import IntentLink from '@/components/nav/IntentLink'
import { usePathname, useRouter } from 'next/navigation'
import {
  Activity, ArrowLeft, Bell, BrainCircuit, CreditCard, Database, Gauge, Globe2, LayoutDashboard, Menu, Search,
  ShieldCheck, Users, X, BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ADMIN_PAGES, degradedCount, fmtAgo } from '@/lib/admin'
import { AdminRangeProvider, StatusPill, useAdminQuery } from './AdminUI'
import { BB8ThemeToggle } from '@/components/ui/star-wars-toggle-switch'

const ICONS: Record<string, any> = {
  '/admin': LayoutDashboard, '/admin/users': Users, '/admin/ai': BrainCircuit, '/admin/revenue': CreditCard,
  '/admin/product': BarChart3, '/admin/traffic': Globe2, '/admin/health': Activity, '/admin/data': Database,
  '/admin/security': ShieldCheck,
}

const SECTIONS = ['Overview', 'Business intelligence', 'Platform operations']

function useSystemStatus() {
  // Same public endpoint as the app's top-bar pill.
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/system/status`, { cache: 'no-store' })
        if (r.ok && !stop) setData(await r.json())
      } catch {
        /* retried below */
      }
    }
    load()
    const t = setInterval(load, 15_000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  return data
}

function Sidebar({ onNavigate, issues }: { onNavigate?: () => void; issues: number }) {
  const pathname = usePathname() || '/admin'
  const { data: me } = useAdminQuery<any>('/me')
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-cyan-500/30 bg-slate-900">
          <img src="/logo-sm.webp" width={28} height={28} decoding="async" alt="" className="h-7 w-7 object-contain" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900 dark:text-white">QuantTrade AI</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-cyan-400">Admin console</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Admin">
        {SECTIONS.map((sec) => (
          <div key={sec} className="mb-4">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{sec}</p>
            <ul className="space-y-0.5">
              {ADMIN_PAGES.filter((p) => p.section.toLowerCase() === sec.toLowerCase()).map((p) => {
                const Icon = ICONS[p.href] || Gauge
                const active = p.href === '/admin' ? pathname === '/admin' : pathname.startsWith(p.href)
                return (
                  <li key={p.href}>
                    <IntentLink href={p.href} onClick={onNavigate}
                      className={cn('flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                        active ? 'bg-blue-600/10 font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white')}>
                      <Icon className={cn('h-4 w-4', active && 'text-blue-600 dark:text-cyan-400')} />
                      <span className="flex-1 truncate">{p.label}</span>
                      {p.href === '/admin/health' && issues > 0 && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-bold tabular-nums text-amber-600 dark:text-amber-300">{issues}</span>
                      )}
                    </IntentLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <IntentLink href="/" className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-500 dark:hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to app
        </IntentLink>
      </nav>
      <div className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-800">
        {me?.env && (
          <div className="flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2 text-[11px] dark:bg-slate-900">
            <span className="text-slate-500 dark:text-slate-400">Environment</span>
            <StatusPill tone={me.env.label === 'Production' ? 'ok' : 'degraded'} label={me.env.label} />
          </div>
        )}
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
          {me?.avatar_url ? (
            <img src={me.avatar_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 text-xs font-bold text-white">
              {(me?.username || 'A').slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-slate-900 dark:text-white">{me?.full_name || me?.username || '…'}</div>
            <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">Administrator · {me?.email_masked || ''}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConsoleSearch() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 10) }, [open])
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t) }, [q])
  const { data } = useAdminQuery<any>(open && debounced ? `/search?q=${encodeURIComponent(debounced)}` : null)
  const pages = ADMIN_PAGES.filter((p) => !q || p.label.toLowerCase().includes(q.toLowerCase()))
  const go = (href: string) => { setOpen(false); setQ(''); router.push(href) }
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex w-full max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-400 hover:border-slate-300 dark:border-slate-800 dark:bg-[#0c1424] dark:hover:border-slate-700">
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 truncate">Search users, tables, pages…</span>
        <kbd className="hidden rounded border border-slate-200 px-1.5 text-[10px] sm:inline dark:border-slate-700">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 p-4 pt-[10vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#0c1424]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <Search className="h-4 w-4 text-slate-400" />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users by name / email / id, tables, pages"
                className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white" aria-label="Console search" />
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2 text-sm">
              <Group title="Pages">{pages.map((p) => <Item key={p.href} onClick={() => go(p.href)}>{p.label}</Item>)}</Group>
              {!!data?.users?.length && <Group title="Users">{data.users.map((u: any) => (
                <Item key={u.id} onClick={() => go(`/admin/users?user=${u.id}`)}>
                  <span className="font-medium">{u.username}</span> <span className="text-xs text-slate-400">#{u.id} · {u.email_masked}</span>
                </Item>))}</Group>}
              {!!data?.tables?.length && <Group title="Tables">{data.tables.map((t: string) => (
                <Item key={t} onClick={() => go(`/admin/data?table=${encodeURIComponent(t)}`)}><span className="font-mono text-xs">{t}</span></Item>))}</Group>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mb-2"><p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</p>{children}</div>
}
function Item({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="block w-full rounded-lg px-2 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">{children}</button>
}

function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const { data } = useAdminQuery<any>('/notifications', { refetchMs: 60_000 })
  const items: any[] = data?.items || []
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Notifications" aria-expanded={open}
        className="relative rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:text-slate-900 dark:border-slate-800 dark:bg-[#0c1424] dark:text-slate-400 dark:hover:text-white">
        <Bell className="h-4 w-4" />
        {!!data?.unread && <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white tabular-nums">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#0c1424]">
          <p className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-900 dark:border-slate-800 dark:text-white">Operational events (48h)</p>
          <ul className="max-h-80 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-xs text-slate-400">No events in the last 48 hours</li>}
            {items.map((i, n) => (
              <li key={n} className="border-b border-slate-100 px-4 py-2.5 last:border-0 dark:border-slate-800/70">
                <div className="flex items-center justify-between gap-2">
                  <StatusPill status={i.severity} label={i.kind.replace('_', ' ')} />
                  <span className="text-[10px] text-slate-400">{fmtAgo(i.ts)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">{i.title}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/admin'
  const [drawer, setDrawer] = useState(false)
  const status = useSystemStatus()
  const issues = degradedCount(status?.services)
  const page = ADMIN_PAGES.find((p) => (p.href === '/admin' ? pathname === '/admin' : pathname.startsWith(p.href)))
  useEffect(() => setDrawer(false), [pathname])

  return (
    <AdminRangeProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#060b16] dark:text-slate-100">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-[#08101f]">
          <Sidebar issues={issues} />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
            <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-[#08101f]">
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-3 top-5 p-1 text-slate-400"><X className="h-4 w-4" /></button>
              <Sidebar issues={issues} onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}
        <div className="lg:pl-60">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50/95 backdrop-blur dark:border-slate-800 dark:bg-[#060b16]/95">
            <div className="flex h-14 items-center gap-3 px-4 md:px-6">
              <button onClick={() => setDrawer(true)} aria-label="Open menu" className="rounded-lg p-1.5 text-slate-500 lg:hidden"><Menu className="h-5 w-5" /></button>
              <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink-0 items-center gap-1.5 text-xs md:flex">
                <IntentLink href="/admin" className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">Admin console</IntentLink>
                <span className="text-slate-400">›</span>
                <span className="truncate font-semibold text-slate-900 dark:text-white">{page?.label || 'Admin'}</span>
              </nav>
              <div className="flex min-w-0 flex-1 justify-center"><ConsoleSearch /></div>
              <div className="flex shrink-0 items-center gap-2">
                <IntentLink href="/admin/health" className="hidden sm:block">
                  {status ? (
                    <StatusPill tone={issues ? (status.overall === 'down' ? 'down' : 'degraded') : 'ok'}
                      label={issues ? `${issues} degraded service${issues === 1 ? '' : 's'}` : 'All systems operational'} />
                  ) : <StatusPill tone="pending" label="Checking status" />}
                </IntentLink>
                <NotificationsBell />
                <div className="hidden md:block"><BB8ThemeToggle /></div>
              </div>
            </div>
          </header>
          <main className="px-4 py-5 md:px-6 md:py-6">{children}</main>
        </div>
      </div>
    </AdminRangeProvider>
  )
}
