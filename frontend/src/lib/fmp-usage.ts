/**
 * FMP API usage counter — tracks daily call count in-memory.
 * Resets at midnight UTC. Server-side only (Next.js API routes).
 */

let _count = 0
let _dateKey = ''

function todayKey(): string {
  return new Date().toISOString().split('T')[0]
}

export function incrementFmpUsage(calls = 1): void {
  const today = todayKey()
  if (_dateKey !== today) {
    _count = 0
    _dateKey = today
  }
  _count += calls
}

export function getFmpUsage(): { used: number; limit: number; date: string } {
  const today = todayKey()
  if (_dateKey !== today) {
    _count = 0
    _dateKey = today
  }
  return { used: _count, limit: 250, date: today }
}
