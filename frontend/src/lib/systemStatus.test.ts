import { describe, expect, it } from 'vitest'
import {
  appendHistory,
  copilotBanner,
  formatAge,
  formatLatency,
  groupServices,
  issueServices,
  pillView,
  pollInterval,
  quotaPercent,
  secondsSince,
  sparklinePath,
  type ServiceStatus,
  type SystemStatus,
} from './systemStatus'

function svc(id: string, status: ServiceStatus['status'], extra: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    id,
    name: id.toUpperCase(),
    group: 'core',
    status,
    latency_ms: 5,
    last_ok_at: '2026-11-27T16:00:00Z',
    last_checked_at: '2026-11-27T16:00:00Z',
    detail: 'detail',
    quota: null,
    ...extra,
  }
}

function snap(overall: SystemStatus['overall'], services: ServiceStatus[]): SystemStatus {
  return { generated_at: '2026-11-27T16:00:05Z', overall, services }
}

describe('pillView', () => {
  it('normal / degraded with count / outage', () => {
    expect(pillView(snap('ok', [svc('a', 'ok'), svc('b', 'not_configured')]), false)).toMatchObject({
      tone: 'ok',
      label: 'All systems normal',
    })
    expect(pillView(snap('degraded', [svc('a', 'degraded'), svc('b', 'down'), svc('c', 'ok')]), false)).toMatchObject({
      tone: 'degraded',
      label: 'Degraded: 2',
    })
    expect(pillView(snap('down', [svc('db', 'down')]), false).tone).toBe('down')
  })

  it('unreachable status API without a snapshot is an outage; loading is neutral', () => {
    expect(pillView(undefined, true)).toMatchObject({ tone: 'down', short: 'Outage' })
    expect(pillView(undefined, false).tone).toBe('unknown')
  })

  it('keeps showing the last snapshot when a later poll fails', () => {
    expect(pillView(snap('ok', [svc('a', 'ok')]), true).tone).toBe('ok')
  })
})

it('pollInterval backs off to 10 s after an error', () => {
  expect(pollInterval(false)).toBe(1000)
  expect(pollInterval(true)).toBe(10000)
})

it('issueServices ignores not_configured and pending', () => {
  const s = snap('degraded', [svc('a', 'not_configured'), svc('b', 'pending'), svc('c', 'degraded')])
  expect(issueServices(s).map((x) => x.id)).toEqual(['c'])
})

it('groupServices keeps Core / Market data / Intelligence order', () => {
  const s = snap('ok', [
    svc('llm', 'ok', { group: 'intelligence' }),
    svc('fmp', 'ok', { group: 'market_data' }),
    svc('db', 'ok', { group: 'core' }),
  ])
  expect(groupServices(s).map((g) => g.label)).toEqual(['Core', 'Market data', 'Intelligence'])
})

it('secondsSince uses the server clock and ticks with local time', () => {
  // checked 5 s before generated_at; snapshot received 3 s ago
  const age = secondsSince('2026-11-27T16:00:00Z', '2026-11-27T16:00:05Z', 10_000, 13_000)
  expect(age).toBe(8)
  expect(secondsSince(null, '2026-11-27T16:00:05Z', 0, 0)).toBeNull()
})

it('formats ages and latencies', () => {
  expect(formatAge(null)).toBe('—')
  expect(formatAge(4.6)).toBe('4s')
  expect(formatAge(125)).toBe('2m 5s')
  expect(formatAge(3 * 3600 + 120)).toBe('3h 2m')
  expect(formatLatency(null)).toBe('—')
  expect(formatLatency(1.23)).toBe('1.2 ms')
  expect(formatLatency(250.4)).toBe('250 ms')
  expect(formatLatency(2500)).toBe('2.5 s')
})

it('quotaPercent', () => {
  expect(quotaPercent(null)).toBeNull()
  expect(quotaPercent({ used: 230, limit: 250, remaining: 20, resets_at: null, window: 'day' })).toBe(92)
  expect(quotaPercent({ used: 300, limit: 250, remaining: 0, resets_at: null, window: 'day' })).toBe(100)
})

describe('appendHistory', () => {
  it('adds a point only when the service was re-checked and drops old points', () => {
    const t0 = Date.parse('2026-11-27T16:00:00Z')
    let h = appendHistory({}, snap('ok', [svc('a', 'ok', { latency_ms: 4 })]), t0)
    h = appendHistory(h, snap('ok', [svc('a', 'ok', { latency_ms: 4 })]), t0 + 1000)
    expect(h.a).toHaveLength(1)
    h = appendHistory(h, snap('ok', [svc('a', 'ok', { latency_ms: 9, last_checked_at: '2026-11-27T16:00:05Z' })]), t0 + 5000)
    expect(h.a.map((p) => p.latency)).toEqual([4, 9])
    h = appendHistory(h, snap('ok', [svc('a', 'ok', { last_checked_at: '2026-11-27T16:06:00Z' })]), t0 + 6 * 60_000)
    expect(h.a).toHaveLength(1)
  })

  it('sparklinePath needs two samples', () => {
    expect(sparklinePath([{ t: 0, latency: 1, status: 'ok' }], 100, 20)).toBe('')
    const p = sparklinePath(
      [
        { t: 0, latency: 10, status: 'ok' },
        { t: 300_000, latency: 20, status: 'ok' },
      ],
      100,
      20,
    )
    expect(p.split(' ')).toHaveLength(2)
  })
})

describe('copilotBanner', () => {
  it('only for degraded / down Copilot LLM', () => {
    expect(copilotBanner(snap('ok', [svc('copilot_llm', 'ok')]))).toBeNull()
    expect(copilotBanner(snap('ok', [svc('copilot_llm', 'not_configured')]))).toBeNull()
    expect(copilotBanner(undefined)).toBeNull()
    const down = copilotBanner(snap('degraded', [svc('copilot_llm', 'down', { detail: 'last 3 answers failed.' })]))
    expect(down?.tone).toBe('down')
    expect(down?.body).toBe('last 3 answers failed. Answers may fail until it recovers.')
    expect(copilotBanner(snap('degraded', [svc('copilot_llm', 'degraded')]))?.tone).toBe('degraded')
  })
})
