'use client'

import { useState, useRef, useEffect } from 'react'
import { Activity, ChevronDown, Plus, X, Search } from 'lucide-react'
import {
  INDICATOR_REGISTRY,
  OVERLAY_IDS,
  PANE_IDS,
  type OverlayIndicatorId,
  type PaneIndicatorId,
} from '@/lib/indicators'

interface IndicatorToolbarProps {
  activeOverlays: OverlayIndicatorId[]
  activePanes: PaneIndicatorId[]
  onToggleOverlay: (id: OverlayIndicatorId) => void
  onTogglePane: (id: PaneIndicatorId) => void
  extendedHours?: boolean
  onToggleExtendedHours?: () => void
}

export default function IndicatorToolbar({
  activeOverlays,
  activePanes,
  onToggleOverlay,
  onTogglePane,
  extendedHours,
  onToggleExtendedHours,
}: IndicatorToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const allActive = [
    ...activeOverlays.map((id) => ({ id, type: 'overlay' as const })),
    ...activePanes.map((id) => ({ id, type: 'pane' as const })),
  ]

  const filtered = INDICATOR_REGISTRY.filter((i) =>
    search ? i.label.toLowerCase().includes(search.toLowerCase()) : true
  )

  const overlayItems = filtered.filter((i) => i.type === 'overlay')
  const paneItems = filtered.filter((i) => i.type === 'pane')

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800/40 bg-[#0a0e1a]/60 overflow-x-auto">
      {/* Add indicator button */}
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 border border-slate-700/50 transition-colors"
        >
          <Activity className="w-3 h-3" />
          Indicators
          <ChevronDown className={`w-3 h-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>

        {menuOpen && (
          <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-slate-700/70 bg-[#0c1018]/98 shadow-xl z-50 overflow-hidden">
            {/* Search */}
            <div className="px-2 py-2 border-b border-slate-800/50">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800/60 border border-slate-700/40">
                <Search className="w-3 h-3 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search indicators..."
                  className="flex-1 bg-transparent text-[11px] text-slate-200 placeholder-slate-600 outline-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto py-1">
              {overlayItems.length > 0 && (
                <>
                  <div className="px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-slate-600 font-semibold">Overlays</div>
                  {overlayItems.map(({ id, label, color }) => {
                    const isActive = activeOverlays.includes(id as OverlayIndicatorId)
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => { onToggleOverlay(id as OverlayIndicatorId) }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors ${
                          isActive ? 'text-white bg-slate-800/50' : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: isActive ? (color || '#888') : 'transparent', border: `2px solid ${color || '#888'}` }} />
                        {label}
                        {isActive && <span className="ml-auto text-[9px] text-cyan-400">ON</span>}
                      </button>
                    )
                  })}
                </>
              )}
              {paneItems.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-0.5 text-[9px] uppercase tracking-wider text-slate-600 font-semibold">Sub-Charts</div>
                  {paneItems.map(({ id, label, color }) => {
                    const isActive = activePanes.includes(id as PaneIndicatorId)
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => { onTogglePane(id as PaneIndicatorId) }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors ${
                          isActive ? 'text-white bg-slate-800/50' : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: isActive ? (color || '#888') : 'transparent', border: `2px solid ${color || '#888'}` }} />
                        {label}
                        {isActive && <span className="ml-auto text-[9px] text-cyan-400">ON</span>}
                      </button>
                    )
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Active indicator pills */}
      {/* Extended hours toggle */}
      {onToggleExtendedHours && (
        <button
          type="button"
          onClick={onToggleExtendedHours}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors shrink-0 ${
            extendedHours
              ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
              : 'text-slate-500 hover:text-slate-300 border-slate-700/50 hover:bg-slate-800/50'
          }`}
          title="Pre-market & After-hours data (1D/5D only)"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          Ext. Hours
        </button>
      )}

      <span className="w-px h-4 bg-slate-800/60 shrink-0 mx-0.5" />

      {allActive.map(({ id, type }) => {
        const cfg = INDICATOR_REGISTRY.find((i) => i.id === id)
        if (!cfg) return null
        return (
          <span
            key={id}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800/60 border border-slate-700/40 text-slate-300 shrink-0"
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color || '#888' }} />
            {cfg.label}
            <button
              type="button"
              onClick={() => {
                if (type === 'overlay') onToggleOverlay(id as OverlayIndicatorId)
                else onTogglePane(id as PaneIndicatorId)
              }}
              className="ml-0.5 text-slate-600 hover:text-red-400 transition-colors"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        )
      })}
    </div>
  )
}
