'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchEconomicCalendar, type EconomicCalendarEvent } from '@/lib/monitor-extended-api'
import { EconomicCalendar, type EconomicEvent } from '@/components/ui/economic-calendar'

function mapEvent(ev: EconomicCalendarEvent): EconomicEvent {
  return {
    countryCode: ev.country_code,
    time: ev.time,
    eventName: ev.event_name,
    actual: ev.actual,
    forecast: ev.forecast,
    prior: ev.prior,
    impact: ev.impact,
  }
}

export default function EconomicCalendarStrip({ className }: { className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['economic-calendar'],
    queryFn: fetchEconomicCalendar,
    refetchInterval: 300_000,
    staleTime: 120_000,
  })

  if (isLoading) {
    return (
      <div className={className}>
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-shrink-0 w-56 h-[120px] rounded-xl bg-slate-800/40 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const events = (data?.events || []).map(mapEvent)

  if (events.length === 0) return null

  return <EconomicCalendar events={events} className={className} />
}
