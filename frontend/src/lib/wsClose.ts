/**
 * WebSocket close codes the API uses for account controls
 * (backend/app/services/ws_sessions.py):
 *   4401 — session revoked (token issued before an admin "revoke sessions")
 *   4403 — account suspended
 * Reconnecting cannot succeed with the same token, so clients stop retrying.
 */
export const WS_CLOSE_SESSION_REVOKED = 4401
export const WS_CLOSE_ACCOUNT_SUSPENDED = 4403

export function isAccountControlClose(code: number | undefined | null): boolean {
  return code === WS_CLOSE_SESSION_REVOKED || code === WS_CLOSE_ACCOUNT_SUSPENDED
}
