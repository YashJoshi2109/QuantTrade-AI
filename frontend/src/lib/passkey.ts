/**
 * WebAuthn / Passkey browser-side helpers
 * OWASP: credentials never leave the device — only signed assertions are transmitted
 */

const CONFIGURED_API = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')

/**
 * API base for passkey calls. On production (real hostname), use same-origin `/api`
 * so requests go through nginx and match the browser's WebAuthn origin.
 * On localhost, call the FastAPI server directly.
 */
function passkeyApiBase(): string {
  if (typeof window === 'undefined') {
    return CONFIGURED_API || ''
  }
  const host = window.location.hostname
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  if (isLocal) {
    return CONFIGURED_API || ''
  }
  return ''
}

function passkeyUrl(path: string): string {
  const base = passkeyApiBase()
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=')
  const binary = atob(padded)
  const buffer = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i)
  return buffer.buffer
}

// ─── Support Detection ────────────────────────────────────────────────────────

export async function isPasskeySupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!window.PublicKeyCredential) return false
  try {
    if (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) {
      return true
    }
  } catch {
    /* continue */
  }
  // Security keys / cross-device passkeys (no platform UV)
  return true
}

export async function getBiometricType(): Promise<'face' | 'fingerprint' | 'device' | null> {
  const supported = await isPasskeySupported()
  if (!supported) return null

  const ua = navigator.userAgent.toLowerCase()
  const isMobile = /iphone|android|ipad/.test(ua)
  const isMac = /macintosh|mac os/.test(ua)

  if (isMobile || isMac) return 'fingerprint'
  return 'device'
}

function getDeviceName(): string {
  if (typeof window === 'undefined') return 'Unknown Device'
  const ua = navigator.userAgent
  if (/iphone/i.test(ua)) return 'iPhone'
  if (/ipad/i.test(ua)) return 'iPad'
  if (/android/i.test(ua)) return 'Android Device'
  if (/macintosh|mac os/i.test(ua)) return 'MacBook / Mac'
  if (/windows/i.test(ua)) return 'Windows PC'
  if (/linux/i.test(ua)) return 'Linux Machine'
  return 'Unknown Device'
}

// ─── Registration (Sign-Up) ───────────────────────────────────────────────────

/**
 * Full WebAuthn registration flow:
 * 1. Fetch server challenge
 * 2. Invoke navigator.credentials.create() (triggers biometric prompt)
 * 3. POST attestation to server for verification and storage
 *
 * @param accessToken JWT for the signed-in user (required by API)
 */
export async function registerPasskey(
  userId: number,
  email: string,
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    // Include Bearer token if available (backwards compat), otherwise cookie is sent via credentials
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`
    }

    const challengeRes = await fetch(passkeyUrl('/api/v1/auth/passkey/register/challenge'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ user_id: userId }),
    })
    if (!challengeRes.ok) {
      const err = await challengeRes.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to get registration challenge' }
    }
    const { challenge, session_token, rp_id, rp_name, user_id: userIdB64, user_name, user_display_name } =
      await challengeRes.json()

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: base64urlToBuffer(challenge),
        rp: { name: rp_name || 'QuantTrade AI', id: rp_id || window.location.hostname },
        user: {
          id: base64urlToBuffer(userIdB64),
          name: user_name || email,
          displayName: user_display_name || email,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'required',
        },
        timeout: 60000,
        attestation: 'none',
      },
    }) as PublicKeyCredential | null

    if (!credential) return { success: false, error: 'Passkey creation was cancelled' }

    const response = credential.response as AuthenticatorAttestationResponse

    const verifyRes = await fetch(passkeyUrl('/api/v1/auth/passkey/register/verify'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        session_token,
        credential_id: bufferToBase64url(credential.rawId),
        attestation_object: bufferToBase64url(response.attestationObject),
        client_data_json: bufferToBase64url(response.clientDataJSON),
        device_name: getDeviceName(),
      }),
    })

    if (!verifyRes.ok) {
      const err = await verifyRes.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Passkey registration verification failed' }
    }

    return { success: true }
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string }
    if (e.name === 'NotAllowedError') return { success: false, error: 'Passkey setup was cancelled or timed out' }
    if (e.name === 'InvalidStateError')
      return { success: false, error: 'A passkey already exists for this account on this device' }
    return { success: false, error: e.message || 'Passkey registration failed' }
  }
}

export interface PasskeyCredentialSummary {
  id: number
  credential_id_suffix: string
  created_at: string | null
  sign_count: number
  device_name?: string | null
}

export async function listPasskeys(accessToken: string): Promise<PasskeyCredentialSummary[]> {
  const headers: Record<string, string> = {}
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }
  const res = await fetch(passkeyUrl('/api/v1/auth/passkey/list'), {
    method: 'GET',
    headers,
    credentials: 'include',
  })
  if (!res.ok) return []
  const data = await res.json().catch(() => ({ items: [] }))
  return Array.isArray(data?.items) ? data.items : []
}

// ─── Authentication (Sign-In) ─────────────────────────────────────────────────

/**
 * Full WebAuthn authentication flow:
 * 1. Fetch server challenge
 * 2. Invoke navigator.credentials.get() (triggers biometric prompt)
 * 3. POST assertion to server — receive JWT on success
 */
export async function authenticatePasskey(): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const challengeRes = await fetch(passkeyUrl('/api/v1/auth/passkey/auth/challenge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
    if (!challengeRes.ok) {
      const err = await challengeRes.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to get authentication challenge' }
    }
    const { challenge, session_token, rp_id } = await challengeRes.json()

    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: base64urlToBuffer(challenge),
        rpId: rp_id || window.location.hostname,
        userVerification: 'required',
        timeout: 60000,
      },
    }) as PublicKeyCredential | null

    if (!credential) return { success: false, error: 'Passkey authentication was cancelled' }

    const response = credential.response as AuthenticatorAssertionResponse

    const verifyRes = await fetch(passkeyUrl('/api/v1/auth/passkey/auth/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        session_token,
        credential_id: bufferToBase64url(credential.rawId),
        authenticator_data: bufferToBase64url(response.authenticatorData),
        client_data_json: bufferToBase64url(response.clientDataJSON),
        signature: bufferToBase64url(response.signature),
        user_handle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
      }),
    })

    if (!verifyRes.ok) {
      const err = await verifyRes.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Passkey authentication failed' }
    }

    const data = await verifyRes.json()
    return { success: true, token: data.access_token }
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string }
    if (e.name === 'NotAllowedError')
      return { success: false, error: 'Biometric authentication was cancelled or timed out' }
    if (e.name === 'SecurityError')
      return { success: false, error: 'Security error — ensure you are on HTTPS' }
    return { success: false, error: e.message || 'Passkey authentication failed' }
  }
}
