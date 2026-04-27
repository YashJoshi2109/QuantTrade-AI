"use client"

import * as React from "react"
import {
  add,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  isEqual,
  isSameDay,
  isSameMonth,
  isToday,
  parse,
  startOfToday,
  startOfWeek,
} from "date-fns"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  X,
  TrendingUp,
  TrendingDown,
  Newspaper,
  ArrowRight,
  Loader2,
  Globe,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useQuery } from "@tanstack/react-query"
import {
  fetchEconomicCalendarRange,
  type EconomicCalendarEvent,
} from "@/lib/monitor-extended-api"
import type { EconomicEvent } from "@/components/ui/economic-calendar"

/* ─── Types ─── */

interface CalendarDay {
  day: Date
  events: EconomicEvent[]
}

interface FullScreenCalendarProps {
  data?: CalendarDay[]
  onClose?: () => void
}

/* ─── Helpers ─── */

const colStartClasses = ["", "col-start-2", "col-start-3", "col-start-4", "col-start-5", "col-start-6", "col-start-7"]

const impactColor = (impact: string) =>
  impact === "high"
    ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
    : impact === "medium"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : "bg-surface-overlay/50 text-fg-muted border-line-subtle"

const impactDot = (impact: string) =>
  impact === "high" ? "bg-rose-400" : impact === "medium" ? "bg-amber-400" : "bg-fg-muted"

// Map event names to likely affected sectors/tickers
const EVENT_STOCK_MAP: Record<string, { tickers: string[]; sector: string }> = {
  "Non-Farm Payroll": { tickers: ["SPY", "QQQ", "DIA", "IWM"], sector: "Broad Market" },
  "Nonfarm Payrolls": { tickers: ["SPY", "QQQ", "DIA", "IWM"], sector: "Broad Market" },
  "CPI": { tickers: ["TLT", "GLD", "TIP", "BND"], sector: "Bonds & Commodities" },
  "Consumer Price Index": { tickers: ["TLT", "GLD", "TIP", "BND"], sector: "Bonds & Commodities" },
  "GDP": { tickers: ["SPY", "EFA", "VTI", "IWM"], sector: "Broad Market" },
  "Interest Rate Decision": { tickers: ["XLF", "KRE", "TLT", "GLD"], sector: "Financials & Bonds" },
  "Fed Interest Rate": { tickers: ["XLF", "KRE", "TLT", "GLD"], sector: "Financials & Bonds" },
  "Unemployment Rate": { tickers: ["XLY", "XLP", "SPY"], sector: "Consumer" },
  "Retail Sales": { tickers: ["XRT", "AMZN", "WMT", "TGT"], sector: "Retail" },
  "PMI": { tickers: ["XLI", "CAT", "DE", "GE"], sector: "Industrials" },
  "Manufacturing PMI": { tickers: ["XLI", "CAT", "DE", "GE"], sector: "Industrials" },
  "Crude Oil": { tickers: ["XLE", "USO", "XOM", "CVX"], sector: "Energy" },
  "Housing": { tickers: ["XHB", "ITB", "DHI", "LEN"], sector: "Housing" },
  "Trade Balance": { tickers: ["UUP", "FXE", "EEM"], sector: "Currencies & EM" },
}

function getAffectedStocks(eventName: string): { tickers: string[]; sector: string } {
  for (const [key, val] of Object.entries(EVENT_STOCK_MAP)) {
    if (eventName.toLowerCase().includes(key.toLowerCase())) return val
  }
  return { tickers: ["SPY", "QQQ"], sector: "General Market" }
}

/* ─── Event Detail Snapshot ─── */

function EventDetailSnapshot({
  event,
  onClose,
}: {
  event: EconomicEvent
  onClose: () => void
}) {
  const affected = getAffectedStocks(event.eventName)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-700/50 bg-[#0D1117] shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-slate-800/50">
          <div className="flex items-start gap-3">
            <img
              src={`https://flagcdn.com/w40/${event.countryCode.toLowerCase()}.png`}
              alt={event.countryCode}
              className="w-8 h-8 rounded-full object-cover bg-surface-raised shrink-0 mt-0.5"
            />
            <div>
              <h3 className="text-sm font-bold text-white leading-tight">{event.eventName}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border", impactColor(event.impact))}>
                  {event.time}
                </span>
                <span className={cn(
                  "text-[8px] font-bold uppercase px-1.5 py-0.5 rounded",
                  event.impact === "high" ? "bg-rose-500/10 text-rose-400" : event.impact === "medium" ? "bg-amber-500/10 text-amber-400" : "bg-surface-overlay/30 text-fg-muted"
                )}>
                  {event.impact} impact
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-raised/60 text-fg-muted hover:text-fg-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Data values */}
        <div className="p-4 border-b border-slate-800/50">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-2 rounded-xl bg-[#0F1629]/60 border border-slate-800/30">
              <div className="text-[9px] text-fg-muted uppercase font-bold mb-1">Actual</div>
              <div className={cn("text-sm font-black font-mono", event.actual ? "text-white" : "text-fg-muted")}>
                {event.actual || "—"}
              </div>
            </div>
            <div className="text-center p-2 rounded-xl bg-[#0F1629]/60 border border-slate-800/30">
              <div className="text-[9px] text-fg-muted uppercase font-bold mb-1">Forecast</div>
              <div className="text-sm font-black font-mono text-cyan-400">{event.forecast || "—"}</div>
            </div>
            <div className="text-center p-2 rounded-xl bg-[#0F1629]/60 border border-slate-800/30">
              <div className="text-[9px] text-fg-muted uppercase font-bold mb-1">Prior</div>
              <div className="text-sm font-black font-mono text-fg-muted">{event.prior || "—"}</div>
            </div>
          </div>

          {/* Beat / Miss indicator */}
          {event.actual && event.forecast && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mt-3 flex items-center gap-2"
            >
              {(() => {
                const actual = parseFloat(event.actual.replace(/[^0-9.-]/g, ""))
                const forecast = parseFloat(event.forecast.replace(/[^0-9.-]/g, ""))
                const beat = !isNaN(actual) && !isNaN(forecast) && actual > forecast
                return (
                  <div className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border",
                    beat
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                  )}>
                    {beat ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {beat ? "BEAT" : "MISS"} expectations
                  </div>
                )
              })()}
            </motion.div>
          )}
        </div>

        {/* Affected Stocks */}
        <div className="p-4 border-b border-slate-800/50">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            <h4 className="text-xs font-bold text-white">Potentially Affected</h4>
            <span className="text-[9px] text-fg-muted font-mono">{affected.sector}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {affected.tickers.map((ticker) => (
              <motion.a
                key={ticker}
                href={`/research?symbol=${ticker}`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0F1629]/80 border border-slate-700/40 hover:border-cyan-500/30 transition-colors group"
              >
                <span className="text-xs font-bold text-white font-mono group-hover:text-cyan-400 transition-colors">{ticker}</span>
                <ArrowRight className="w-3 h-3 text-fg-muted group-hover:text-cyan-400 transition-colors" />
              </motion.a>
            ))}
          </div>
        </div>

        {/* Market context */}
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Newspaper className="w-3.5 h-3.5 text-amber-400" />
            <h4 className="text-xs font-bold text-white">Market Context</h4>
          </div>
          <div className="space-y-2">
            <div className="p-2.5 rounded-xl bg-[#0F1629]/60 border border-slate-800/30">
              <p className="text-[11px] text-fg-secondary leading-relaxed">
                {event.impact === "high"
                  ? `This is a high-impact event that typically causes significant volatility in ${affected.sector} stocks. Watch for moves in ${affected.tickers.slice(0, 3).join(", ")} around the release time.`
                  : event.impact === "medium"
                    ? `Medium-impact event that may cause moderate price action in ${affected.sector}. Monitor ${affected.tickers[0]} for directional cues.`
                    : `Low-impact event with limited expected market reaction. May contribute to broader trend confirmation.`}
              </p>
            </div>
            {event.impact === "high" && (
              <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/15">
                <p className="text-[10px] text-amber-400/80 font-medium">
                  High volatility expected. Consider reducing position sizes or widening stops around this release.
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ─── Main Calendar ─── */

export function FullScreenCalendar({ data: initialData, onClose }: FullScreenCalendarProps) {
  const today = startOfToday()
  const [selectedDay, setSelectedDay] = React.useState(today)
  const [currentMonth, setCurrentMonth] = React.useState(format(today, "MMM-yyyy"))
  const [selectedEvent, setSelectedEvent] = React.useState<EconomicEvent | null>(null)
  const firstDayCurrentMonth = parse(currentMonth, "MMM-yyyy", new Date())
  const isDesktop = useMediaQuery("(min-width: 768px)")

  const rangeStart = format(startOfWeek(firstDayCurrentMonth), "yyyy-MM-dd")
  const rangeEnd = format(endOfWeek(endOfMonth(firstDayCurrentMonth)), "yyyy-MM-dd")

  // Fetch month-range events from API
  const { data: apiData, isLoading } = useQuery({
    queryKey: ["economic-calendar-range", rangeStart, rangeEnd],
    queryFn: () => fetchEconomicCalendarRange(rangeStart, rangeEnd),
    staleTime: 5 * 60 * 1000,
  })

  // Group events by date
  const calendarDays: CalendarDay[] = React.useMemo(() => {
    const eventsRaw = apiData?.events || []
    const byDate = new Map<string, EconomicEvent[]>()

    for (const ev of eventsRaw) {
      const dateKey = ev.date || format(today, "yyyy-MM-dd")
      if (!byDate.has(dateKey)) byDate.set(dateKey, [])
      byDate.get(dateKey)!.push({
        countryCode: ev.country_code,
        time: ev.time,
        eventName: ev.event_name,
        actual: ev.actual,
        forecast: ev.forecast,
        prior: ev.prior,
        impact: ev.impact as "high" | "medium" | "low",
      })
    }

    // Also include initial data (today's events from strip) as fallback
    if (initialData) {
      for (const d of initialData) {
        const dateKey = format(d.day, "yyyy-MM-dd")
        if (!byDate.has(dateKey) || byDate.get(dateKey)!.length === 0) {
          byDate.set(dateKey, d.events)
        }
      }
    }

    return Array.from(byDate.entries()).map(([dateStr, events]) => ({
      day: new Date(dateStr + "T00:00:00"),
      events,
    }))
  }, [apiData, initialData, today])

  const days = eachDayOfInterval({
    start: startOfWeek(firstDayCurrentMonth),
    end: endOfWeek(endOfMonth(firstDayCurrentMonth)),
  })

  const previousMonth = () => setCurrentMonth(format(add(firstDayCurrentMonth, { months: -1 }), "MMM-yyyy"))
  const nextMonth = () => setCurrentMonth(format(add(firstDayCurrentMonth, { months: 1 }), "MMM-yyyy"))
  const goToToday = () => { setCurrentMonth(format(today, "MMM-yyyy")); setSelectedDay(today) }

  const getEventsForDay = (day: Date) =>
    calendarDays.filter((d) => isSameDay(d.day, day)).flatMap((d) => d.events)

  const selectedDayEvents = getEventsForDay(selectedDay)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
    <motion.div
      initial={{ scale: 0.94, y: 16 }}
      animate={{ scale: 1, y: 0 }}
      exit={{ scale: 0.94, y: 16 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      onClick={(e) => e.stopPropagation()}
      className="w-full max-w-5xl h-[85vh] sm:h-[80vh] rounded-2xl border border-slate-700/50 bg-[#0A0E1A] shadow-[0_24px_80px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-b border-slate-800/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex w-14 flex-col items-center rounded-lg border border-slate-700/50 bg-[#0F1629]/80 p-0.5">
            <span className="text-[9px] font-bold uppercase text-cyan-400 p-0.5">
              {format(today, "MMM")}
            </span>
            <div className="flex w-full items-center justify-center rounded-md bg-[#0A0E1A] border border-slate-700/30 py-0.5 text-lg font-black text-white">
              {format(today, "d")}
            </div>
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-white">
              {format(firstDayCurrentMonth, "MMMM yyyy")}
            </h2>
            <p className="text-[10px] text-fg-muted font-mono">
              Economic Calendar &middot; {format(firstDayCurrentMonth, "MMM d")} &ndash; {format(endOfMonth(firstDayCurrentMonth), "MMM d, yyyy")}
            </p>
          </div>
          {isLoading && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-700/50 overflow-hidden">
            <button onClick={previousMonth} className="px-2.5 py-1.5 hover:bg-surface-raised/60 transition-colors text-fg-muted hover:text-fg-primary">
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <button onClick={goToToday} className="px-3 py-1.5 text-xs font-bold border-x border-line-subtle hover:bg-surface-raised/60 transition-colors text-fg-secondary hover:text-fg-primary">
              Today
            </button>
            <button onClick={nextMonth} className="px-2.5 py-1.5 hover:bg-surface-raised/60 transition-colors text-fg-muted hover:text-fg-primary">
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-raised/60 text-fg-muted hover:text-fg-primary transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Desktop: Full grid */}
      {isDesktop ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-800/50 text-center text-[10px] font-bold uppercase tracking-wider text-fg-muted">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2 border-r border-slate-800/30 last:border-r-0">{d}</div>
            ))}
          </div>
          <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-auto">
            {days.map((day, idx) => {
              const dayEvents = getEventsForDay(day)
              const isSelected = isEqual(day, selectedDay)
              const isCurrent = isToday(day)
              const inMonth = isSameMonth(day, firstDayCurrentMonth)

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "relative flex flex-col border-b border-r border-slate-800/30 p-1.5 text-left transition-colors min-h-[90px] cursor-pointer",
                    idx === 0 && colStartClasses[getDay(day)],
                    !inMonth && "bg-surface-base/30",
                    isSelected && "bg-cyan-500/5 ring-1 ring-inset ring-cyan-500/30",
                    !isSelected && "hover:bg-surface-raised/30",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold mb-1",
                      isCurrent && "bg-cyan-500 text-white",
                      !isCurrent && inMonth ? "text-fg-secondary" : "text-fg-muted",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  {dayEvents.slice(0, 3).map((ev, i) => (
                    <button
                      key={i}
                      onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev) }}
                      className={cn(
                        "text-[9px] font-medium truncate rounded px-1 py-0.5 mb-0.5 border text-left w-full hover:brightness-125 transition-all",
                        impactColor(ev.impact),
                      )}
                    >
                      {ev.eventName}
                    </button>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[8px] text-fg-muted font-bold">+{dayEvents.length - 3} more</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* Mobile: mini grid + event list */
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0 px-3 pt-3">
            <div className="grid grid-cols-7 text-center text-[9px] font-bold text-fg-muted uppercase mb-1">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i} className="py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {days.map((day, idx) => {
                const dayEvents = getEventsForDay(day)
                const isSelected = isEqual(day, selectedDay)
                const isCurrent = isToday(day)
                const inMonth = isSameMonth(day, firstDayCurrentMonth)

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      "flex flex-col items-center py-1.5 rounded-lg transition-all",
                      isSelected && "bg-cyan-500/15 ring-1 ring-cyan-500/30",
                      !isSelected && "hover:bg-surface-raised/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                        isCurrent && "bg-cyan-500 text-white",
                        !isCurrent && inMonth ? "text-slate-200" : "text-fg-muted",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    {dayEvents.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5">
                        {dayEvents.slice(0, 3).map((ev, i) => (
                          <span key={i} className={cn("w-1 h-1 rounded-full", impactDot(ev.impact))} />
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Selected day events */}
          <div className="flex-1 overflow-y-auto px-3 py-3 border-t border-slate-800/50 mt-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">
                {format(selectedDay, "EEEE, MMM d")}
              </h3>
              <span className="text-[10px] text-fg-muted font-mono">
                {selectedDayEvents.length} event{selectedDayEvents.length !== 1 ? "s" : ""}
              </span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedDay.toISOString()}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-2"
              >
                {selectedDayEvents.length === 0 ? (
                  <div className="text-center py-8">
                    <Globe className="w-8 h-8 text-fg-muted mx-auto mb-2" />
                    <p className="text-fg-muted text-sm">No economic events</p>
                  </div>
                ) : (
                  selectedDayEvents.map((ev, i) => (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => setSelectedEvent(ev)}
                      className="w-full flex items-start gap-3 p-3 rounded-xl bg-[#0F1629]/80 border border-slate-800/40 text-left hover:border-slate-700/60 active:scale-[0.98] transition-all"
                    >
                      <img
                        src={`https://flagcdn.com/w40/${ev.countryCode.toLowerCase()}.png`}
                        alt={ev.countryCode}
                        className="w-6 h-6 rounded-full object-cover bg-surface-raised shrink-0 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border", impactColor(ev.impact))}>
                            {ev.time}
                          </span>
                          <span className={cn("text-[8px] font-bold uppercase", ev.impact === "high" ? "text-rose-400" : ev.impact === "medium" ? "text-amber-400" : "text-fg-muted")}>
                            {ev.impact}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-200 truncate">{ev.eventName}</p>
                        <div className="flex gap-3 mt-1 text-[10px] font-mono">
                          {ev.actual && <span className="text-white">Act: <strong>{ev.actual}</strong></span>}
                          {ev.forecast && <span className="text-fg-muted">Fcst: {ev.forecast}</span>}
                          {ev.prior && <span className="text-fg-muted">Prior: {ev.prior}</span>}
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-fg-muted shrink-0 mt-1" />
                    </motion.button>
                  ))
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Event Detail Snapshot */}
      <AnimatePresence>
        {selectedEvent && (
          <EventDetailSnapshot
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
    </motion.div>
  )
}
