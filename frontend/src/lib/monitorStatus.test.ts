import { describe, expect, it } from 'vitest'
import { eventFeedState, isSourceUnavailable } from './monitorStatus'

describe('eventFeedState', () => {
  it('is ok whenever there are events', () => {
    expect(eventFeedState('offline', 3)).toBe('ok')
  })
  it('treats zero events with no successful ingestion as offline, not quiet', () => {
    expect(eventFeedState('offline', 0)).toBe('offline')
    expect(eventFeedState('stale', 0)).toBe('stale')
  })
  it('is empty when ingestion is healthy but nothing happened', () => {
    expect(eventFeedState('ok', 0)).toBe('empty')
  })
  it('is loading before either query answers', () => {
    expect(eventFeedState(undefined, undefined)).toBe('loading')
  })
})

describe('isSourceUnavailable', () => {
  it('flags an empty list whose sources all failed', () => {
    expect(isSourceUnavailable({ source_status: 'unavailable' }, 0)).toBe(true)
    expect(isSourceUnavailable({}, 0)).toBe(true)
  })
  it('does not flag when rows exist or the source says ok', () => {
    expect(isSourceUnavailable({ source_status: 'unavailable' }, 2)).toBe(false)
    expect(isSourceUnavailable({ source_status: 'ok' }, 0)).toBe(false)
    expect(isSourceUnavailable(undefined, 0)).toBe(false)
  })
})
