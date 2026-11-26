/**
 * Calendar-day helpers shared by the earnings and dividend calendars (desktop + mobile).
 * Days are YYYY-MM-DD strings; all math is in UTC so a viewer's time zone never shifts a day.
 */

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(iso: string, n: number): string {
  const d = parseDay(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return toDay(d)
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const dow = parseDay(iso).getUTCDay() // 0 = Sun
  return addDays(iso, -((dow + 6) % 7))
}

/** Mon..Fri of the week starting `monday`. */
export function weekDays(monday: string, count = 5): string[] {
  return Array.from({ length: count }, (_, i) => addDays(monday, i))
}

/** Today's date in New York (US market date), as YYYY-MM-DD. */
export function todayNY(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).slice(0, 10)
}

export function dayLabel(iso: string, style: 'short' | 'long' = 'short'): string {
  const d = parseDay(iso)
  return style === 'long'
    ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function weekRangeLabel(monday: string): string {
  const s = parseDay(monday)
  const e = parseDay(addDays(monday, 4))
  const sm = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const sameMonth = s.getUTCMonth() === e.getUTCMonth()
  const em = e.toLocaleDateString('en-US', sameMonth ? { day: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${sm} – ${em}, ${e.getUTCFullYear()}`
}
