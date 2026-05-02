"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { ChevronLeft, ChevronRight, Calendar, Maximize2 } from "lucide-react"
import { AnimatePresence } from "framer-motion"
import { FullScreenCalendar } from "@/components/ui/fullscreen-calendar"
import { startOfToday } from "date-fns"
import { cn } from "@/lib/utils"

export interface EconomicEvent {
  countryCode: string
  time: string
  eventName: string
  actual: string | null
  forecast: string | null
  prior: string | null
  impact: "high" | "medium" | "low"
}

interface EconomicCalendarProps {
  title?: string
  events: EconomicEvent[]
  className?: string
}

function ImpactBars({ impact }: { impact: EconomicEvent["impact"] }) {
  const n = impact === "high" ? 3 : impact === "medium" ? 2 : 1
  const color =
    impact === "high"
      ? "bg-rose-400"
      : impact === "medium"
        ? "bg-amber-400"
        : "bg-fg-muted"
  return (
    <div className="flex items-end gap-[2px] h-3.5" title={`${impact} impact`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-sm",
            i === 0 ? "h-1.5" : i === 1 ? "h-2.5" : "h-3.5",
            i < n ? color : "bg-surface-overlay",
          )}
        />
      ))}
    </div>
  )
}

export const EconomicCalendar = React.forwardRef<HTMLDivElement, EconomicCalendarProps>(
  ({ title = "Economic Calendar", events, className }, ref) => {
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const [canLeft, setCanLeft] = React.useState(false)
    const [canRight, setCanRight] = React.useState(true)
    const [fullscreen, setFullscreen] = React.useState(false)

    // Build calendar data for fullscreen view (group events by today)
    const calendarData = React.useMemo(() => {
      const today = startOfToday()
      return [{ day: today, events }]
    }, [events])

    const check = React.useCallback(() => {
      const el = scrollRef.current
      if (!el) return
      setCanLeft(el.scrollLeft > 0)
      setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
    }, [])

    const scroll = (dir: "left" | "right") => {
      const el = scrollRef.current
      if (!el) return
      el.scrollBy({ left: dir === "left" ? -el.clientWidth * 0.8 : el.clientWidth * 0.8, behavior: "smooth" })
    }

    React.useEffect(() => {
      const el = scrollRef.current
      if (!el) return
      el.addEventListener("scroll", check)
      check()
      return () => el.removeEventListener("scroll", check)
    }, [events, check])

    return (
      <div ref={ref} className={cn("w-full", className)}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <span className="text-[8px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 rounded-full">
              TODAY
            </span>
          </div>
          <div className="flex items-center gap-1">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setFullscreen(true)}
              aria-label="Open fullscreen calendar"
              className="p-1 rounded-full bg-surface-raised/80 border border-slate-700/50 hover:bg-surface-overlay/80 transition-colors mr-1"
            >
              <Maximize2 className="h-3.5 w-3.5 text-fg-secondary" />
            </motion.button>
            {canLeft && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => scroll("left")}
                aria-label="Scroll left"
                className="p-1 rounded-full bg-surface-raised/80 border border-slate-700/50 hover:bg-surface-overlay/80 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5 text-fg-secondary" />
              </motion.button>
            )}
            {canRight && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => scroll("right")}
                aria-label="Scroll right"
                className="p-1 rounded-full bg-surface-raised/80 border border-slate-700/50 hover:bg-surface-overlay/80 transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5 text-fg-secondary" />
              </motion.button>
            )}
          </div>
        </div>

        {/* Scrollable cards */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-2 scroll-smooth scrollbar-hide"
        >
          <motion.div
            className="flex flex-nowrap gap-3"
            initial="hidden"
            animate="visible"
            variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.06 } } }}
          >
            {events.map((ev, i) => (
              <motion.div
                key={i}
                variants={{
                  hidden: { y: 14, opacity: 0 },
                  visible: { y: 0, opacity: 1, transition: { type: "spring" as const, stiffness: 120, damping: 16 } },
                }}
                className="flex-shrink-0 w-56 rounded-xl border border-line-subtle bg-surface-base/60 p-3 hover:border-line-default transition-colors duration-200"
              >
                {/* Top row: time + impact */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-fg-muted font-mono">Today</span>
                    <span
                      className={cn(
                        "text-[10px] font-bold font-mono px-1.5 py-0.5 rounded",
                        ev.impact === "high"
                          ? "bg-rose-500/15 text-rose-400"
                          : ev.impact === "medium"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-surface-overlay/50 text-fg-muted",
                      )}
                    >
                      {ev.time}
                    </span>
                  </div>
                  <ImpactBars impact={ev.impact} />
                </div>

                {/* Country flag + event name */}
                <div className="flex items-center gap-2 mb-3">
                  <img
                    src={`https://flagcdn.com/w40/${ev.countryCode.toLowerCase()}.png`}
                    alt={ev.countryCode}
                    className="h-6 w-6 rounded-full object-cover bg-surface-raised shrink-0"
                  />
                  <span className="text-[11px] font-semibold text-fg-primary truncate leading-tight">
                    {ev.eventName}
                  </span>
                </div>

                {/* Actual / Forecast / Prior */}
                <div className="grid grid-cols-3 text-center gap-1">
                  {[
                    { label: "Actual", value: ev.actual },
                    { label: "Forecast", value: ev.forecast },
                    { label: "Prior", value: ev.prior },
                  ].map((d) => (
                    <div key={d.label}>
                      <p className="text-[8px] text-fg-muted uppercase tracking-wider">{d.label}</p>
                      <p
                        className={cn(
                          "text-[11px] font-bold font-mono mt-0.5",
                          d.value ? "text-fg-primary" : "text-fg-muted",
                        )}
                      >
                        {d.value ?? "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Fullscreen Calendar Portal */}
        <AnimatePresence>
          {fullscreen && (
            <FullScreenCalendar
              data={calendarData}
              onClose={() => setFullscreen(false)}
            />
          )}
        </AnimatePresence>
      </div>
    )
  },
)

EconomicCalendar.displayName = "EconomicCalendar"
