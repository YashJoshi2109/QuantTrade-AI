/**
 * WebAuthn / Passkey browser-side helpers
 * OWASP: credentials never leave the device — only signed assertions are transmitted
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
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
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
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

// ─── Registration (Sign-Up) ───────────────────────────────────────────────────

/**
 * Full WebAuthn registration flow:
 * 1. Fetch server challenge
 * 2. Invoke navigator.credentials.create() (triggers biometric prompt)
 * 3. POST attestation to server for verification and storage
 */
export async function registerPasskey(userId: number, email: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1 — get challenge from server
    const challengeRes = await fetch(`${API_URL}/api/v1/auth/passkey/register/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (!challengeRes.ok) {
      const err = await challengeRes.json()
      return { success: false, error: err.detail || 'Failed to get registration challenge' }
    }
    const { challenge, session_token, rp_id, rp_name, user_id: userIdB64, user_name, user_display_name } = await challengeRes.json()

    // Step 2 — create credential
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
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' },  // RS256
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

    // Step 3 — verify with server
    const verifyRes = await fetch(`${API_URL}/api/v1/auth/passkey/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_token,
        credential_id: bufferToBase64url(credential.rawId),
        attestation_object: bufferToBase64url(response.attestationObject),
        client_data_json: bufferToBase64url(response.clientDataJSON),
      }),
    })

    if (!verifyRes.ok) {
      const err = await verifyRes.json()
      return { success: false, error: err.detail || 'Passkey registration verification failed' }
    }

    return { success: true }
  } catch (err: any) {
    if (err.name === 'NotAllowedError') return { success: false, error: 'Passkey setup was cancelled or timed out' }
    if (err.name === 'InvalidStateError') return { success: false, error: 'A passkey already exists for this account on this device' }
    return { success: false, error: err.message || 'Passkey registration failed' }
  }
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
    // Step 1 — get challenge
    const challengeRes = await fetch(`${API_URL}/api/v1/auth/passkey/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!challengeRes.ok) {
      const err = await challengeRes.json()
      return { success: false, error: err.detail || 'Failed to get authentication challenge' }
    }
    const { challenge, session_token, rp_id } = await challengeRes.json()

    // Step 2 — get assertion (biometric prompt)
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

    // Step 3 — verify with server, receive JWT
    const verifyRes = await fetch(`${API_URL}/api/v1/auth/passkey/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      const err = await verifyRes.json()
      return { success: false, error: err.detail || 'Passkey authentication failed' }
    }

    const data = await verifyRes.json()
    return { success: true, token: data.access_token }
  } catch (err: any) {
    if (err.name === 'NotAllowedError') return { success: false, error: 'Biometric authentication was cancelled or timed out' }
    if (err.name === 'SecurityError') return { success: false, error: 'Security error — ensure you are on HTTPS' }
    return { success: false, error: err.message || 'Passkey authentication failed' }
  }
}
