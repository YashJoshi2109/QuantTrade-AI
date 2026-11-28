import { describe, expect, it } from 'vitest'
import { isAccountControlClose, WS_CLOSE_ACCOUNT_SUSPENDED, WS_CLOSE_SESSION_REVOKED } from './wsClose'

describe('isAccountControlClose', () => {
  it('stops reconnects only for suspended / revoked closes', () => {
    expect(isAccountControlClose(WS_CLOSE_ACCOUNT_SUSPENDED)).toBe(true)
    expect(isAccountControlClose(WS_CLOSE_SESSION_REVOKED)).toBe(true)
    for (const code of [1000, 1006, 1008, 1011, undefined, null]) {
      expect(isAccountControlClose(code)).toBe(false)
    }
  })
})
