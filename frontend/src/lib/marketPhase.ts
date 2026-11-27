/**
 * US equity market phase (regular / extended / closed), from the backend
 * market-status payload when available, else from the New York wall clock.
 * Holidays are only known to the backend; the clock fallback treats them as
 * weekdays, which only means slightly faster polling on a holiday.
 */
import type { MarketPhase } from './queryPolicy'

function nyMinutesAndDay(now: Date): { minutes: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hour = parseInt(get('hour'), 10) % 24
  const minute = parseInt(get('minute'), 10)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { minutes: hour * 60 + minute, day }
}

/** Phase from the New York clock alone. */
export function clockMarketPhase(now: Date = new Date()): MarketPhase {
  const { minutes, day } = nyMinutesAndDay(now)
  if (day === 0 || day === 6) return 'closed'
  if (minutes >= 570 && minutes < 960) return 'open' // 9:30-16:00
  if (minutes >= 240 && minutes < 1200) return 'extended' // 4:00-9:30, 16:00-20:00
  return 'closed'
}

interface StatusLike {
  is_open?: boolean | null
  is_weekday?: boolean | null
}

/**
 * Backend status wins for "open" (it knows holidays and early closes). When the
 * backend says closed on a weekday, the clock decides between extended/closed.
 */
export function marketPhaseFrom(status: StatusLike | null | undefined, now: Date = new Date()): MarketPhase {
  const clock = clockMarketPhase(now)
  if (!status || typeof status.is_open !== 'boolean') return clock
  if (status.is_open) return 'open'
  if (status.is_weekday === false) return 'closed'
  return clock === 'open' ? 'extended' : clock
}
