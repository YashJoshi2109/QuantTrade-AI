'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

interface WorldClock {
  city: string
  timezone: string
  flag: string
}

const CLOCKS: WorldClock[] = [
  { city: 'New York', timezone: 'America/New_York', flag: '🇺🇸' },
  { city: 'London', timezone: 'Europe/London', flag: '🇬🇧' },
  { city: 'Mumbai', timezone: 'Asia/Kolkata', flag: '🇮🇳' },
  { city: 'Dubai', timezone: 'Asia/Dubai', flag: '🇦🇪' },
  { city: 'Tokyo', timezone: 'Asia/Tokyo', flag: '🇯🇵' },
  { city: 'Sydney', timezone: 'Australia/Sydney', flag: '🇦🇺' },
]

function getMarketStatus(timezone: string): { open: boolean; label: string } {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short'
  })
  const parts = formatter.formatToParts(now)
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
  const day = parts.find(p => p.type === 'weekday')?.value || ''
  const isWeekend = day === 'Sat' || day === 'Sun'
  const isOpen = !isWeekend && hour >= 9 && hour < 16

  return { open: isOpen, label: isOpen ? 'OPEN' : 'CLOSED' }
}

export default function WorldClockWidget() {
  const [times, setTimes] = useState<Record<string, string>>({})
  const [dates, setDates] = useState<Record<string, string>>({})

  useEffect(() => {
    function update() {
      const now = new Date()
      const newTimes: Record<string, string> = {}
      const newDates: Record<string, string> = {}
      for (const clock of CLOCKS) {
        newTimes[clock.city] = now.toLocaleTimeString('en-US', {
          timeZone: clock.timezone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
        newDates[clock.city] = now.toLocaleDateString('en-US', {
          timeZone: clock.timezone,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
      }
      setTimes(newTimes)
      setDates(newDates)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-3">
      {CLOCKS.map((clock) => {
        const market = getMarketStatus(clock.timezone)
        return (
          <div
            key={clock.city}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/40 hover:border-slate-600/60 transition-colors"
          >
            <span className="text-sm">{clock.flag}</span>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">{clock.city}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${market.open ? 'bg-emerald-400' : 'bg-red-400/60'}`} />
              </div>
              <span className="text-[11px] font-mono font-bold text-slate-100 tabular-nums">
                {times[clock.city] || '--:--:--'}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
