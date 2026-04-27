'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Bell, TrendingDown, TrendingUp } from 'lucide-react'
import { fetchPredictionAlerts, type PredictionAlert } from '@/lib/api'
import { useToast } from '@/components/Toast'

export default function PredictionAlertCenter() {
  const [open, setOpen] = useState(false)
  const { warning } = useToast()
  const { data: alerts = [] } = useQuery<PredictionAlert[]>({
    queryKey: ['predictionAlerts'],
    queryFn: () => fetchPredictionAlerts(0.65, 2.0),
    refetchInterval: 90000,
    staleTime: 45000,
  })

  const topAlerts = useMemo(() => alerts.slice(0, 8), [alerts])
  const unseenHigh = useMemo(
    () => topAlerts.filter((a) => a.severity === 'high'),
    [topAlerts]
  )

  useEffect(() => {
    if (unseenHigh.length === 0) return
    const key = `pred-alert-${unseenHigh[0].symbol}-${unseenHigh[0].timeframe}-${unseenHigh[0].direction}`
    const prev = localStorage.getItem(key)
    if (!prev) {
      warning(`Signal alert: ${unseenHigh[0].message}`, 6000)
      localStorage.setItem(key, '1')
    }
  }, [unseenHigh, warning])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hud-button p-2 hidden sm:flex relative"
        aria-label="Prediction alerts"
      >
        <Bell className="w-5 h-5" />
        {topAlerts.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
            {Math.min(topAlerts.length, 9)}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-line-default bg-surface-overlay/95 shadow-theme-lg z-50">
          <div className="px-3 py-2 border-b border-line-subtle flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-primary">Prediction Alerts</span>
            <span className="text-[10px] text-fg-muted">Auto-refresh 2m</span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {topAlerts.length === 0 ? (
              <div className="p-3 text-xs text-fg-muted">No active alerts.</div>
            ) : (
              topAlerts.map((a, i) => (
                <Link
                  key={`${a.symbol}-${a.timeframe}-${a.direction}-${i}`}
                  href={`/research?symbol=${a.symbol}`}
                  className="block px-3 py-2 border-b last:border-b-0 border-line-subtle hover:bg-surface-hover transition-colors"
                  onClick={() => setOpen(false)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-fg-primary">{a.symbol}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      a.severity === 'high'
                        ? 'bg-red-500/20 text-red-300'
                        : a.severity === 'medium'
                        ? 'bg-yellow-500/20 text-yellow-300'
                        : 'bg-surface-raised text-fg-secondary'
                    }`}>
                      {a.severity.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-fg-secondary flex items-center gap-1">
                    {String(a.direction ?? '')
                      .trim()
                      .toUpperCase() === 'UP' ? (
                      <TrendingUp className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-3 h-3 text-red-400" />
                    )}
                    {a.message}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
