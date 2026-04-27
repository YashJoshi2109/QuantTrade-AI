/**
 * Authentication utilities
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

/** Parse JSON only if the response has a JSON content-type. Avoids "Unexpected token '<'" errors when the backend returns HTML error pages. */
async function parseErrorJson(response: Response): Promise<{ detail?: string }> {
  const ct = response.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return {}
  try { return await response.json() } catch { return {} }
}

export interface User {
  id: number
  email: string
  username: string
  full_name: string | null
  avatar_url: string | null
  is_verified: boolean
  created_at: string
  last_login?: string | null
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
}

// Token management
// Tokens are now stored in httpOnly cookies set by the server.
// These functions are kept for backwards compatibility but no longer
// read/write localStorage for the JWT itself.

export function getToken(): string | null {
  // Token lives in httpOnly cookie — not accessible from JS.
  // Return null; cookies are sent automatically with credentials: 'include'.
  return null
}

export function setToken(_token: string): void {
  // No-op: cookie is set by the server via Set-Cookie header.
  // Kept for backwards compatibility so callers don't break.
}

export function removeToken(): void {
  // Clear any legacy localStorage token that may still exist
  if (typeof window !== 'undefined') {
    localStorage.removeItem('auth_token')
  }
}

export function getUser(): User | null {
  if (typeof window === 'undefined') return null
  const userStr = localStorage.getItem('auth_user')
  if (!userStr) return null
  try {
    return JSON.parse(userStr)
  } catch {
    return null
  }
}

export function setUser(user: User): void {
  localStorage.setItem('auth_user', JSON.stringify(user))
}

export function removeUser(): void {
  localStorage.removeItem('auth_user')
}

// API calls
export async function register(
  email: string,
  username: string,
  password: string,
  fullName?: string,
  options?: { countryCode?: string; phoneNumber?: string; otp?: string; dateOfBirth?: string; gender?: string; turnstileToken?: string }
): Promise<AuthResponse> {
  const body: Record<string, unknown> = { email, username, password, full_name: fullName }
  if (options) {
    if (options.countryCode) body.country_code = options.countryCode
    if (options.phoneNumber) body.phone_number = options.phoneNumber
    if (options.otp) body.otp = options.otp
    if (options.dateOfBirth) body.date_of_birth = options.dateOfBirth
    if (options.gender) body.gender = options.gender
    if (options.turnstileToken) body.turnstile_token = options.turnstileToken
  }
  const response = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  })
  
  if (!response.ok) {
    const error = await parseErrorJson(response)
    throw new Error(error.detail || 'Registration failed')
  }
  
  const data: AuthResponse = await response.json()
  setToken(data.access_token)
  setUser(data.user)
  return data
}

export async function login(email: string, password: string, turnstileToken?: string): Promise<AuthResponse> {
  const body: Record<string, unknown> = { email, password }
  if (turnstileToken) body.turnstile_token = turnstileToken
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  })
  
  if (!response.ok) {
    const error = await parseErrorJson(response)
    throw new Error(error.detail || 'Login failed')
  }
  
  const data: AuthResponse = await response.json()
  setToken(data.access_token)
  setUser(data.user)
  return data
}

export async function googleLogin(
  googleId: string,
  email: string,
  name: string,
  avatarUrl?: string
): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/api/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      google_id: googleId,
      email,
      name,
      avatar_url: avatarUrl
    })
  })
  
  if (!response.ok) {
    const error = await parseErrorJson(response)
    throw new Error(error.detail || 'Google login failed')
  }
  
  const data: AuthResponse = await response.json()
  setToken(data.access_token)
  setUser(data.user)
  return data
}

export async function googleVerify(credential: string): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/api/v1/auth/google/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential })
  })
  
  if (!response.ok) {
    const error = await parseErrorJson(response)
    throw new Error(error.detail || 'Google verification failed')
  }
  
  const data: AuthResponse = await response.json()
  setToken(data.access_token)
  setUser(data.user)
  return data
}

export async function checkSession(): Promise<{ authenticated: boolean; user: User | null }> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/session`, {
      credentials: 'include',
    })

    if (!response.ok) {
      removeToken()
      removeUser()
      return { authenticated: false, user: null }
    }

    return await response.json()
  } catch {
    return { authenticated: false, user: null }
  }
}

export async function validateEmail(email: string): Promise<{ valid: boolean; message: string; status: string }> {
  const fallback = { valid: true, message: '', status: 'UNKNOWN' }
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/validate-email?email=${encodeURIComponent(email)}`)
    if (!response.ok) return fallback
    const ct = response.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return fallback
    const data = await response.json()
    return { valid: data.valid ?? true, message: data.message || '', status: data.status || 'UNKNOWN' }
  } catch {
    return fallback
  }
}

export async function sendOtp(email: string, purpose: 'register' | 'reset' = 'register'): Promise<void> {
  const response = await fetch(`${API_URL}/api/v1/auth/send-otp?purpose=${purpose}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email })
  })
  if (!response.ok) {
    const err = await parseErrorJson(response)
    throw new Error(err.detail || 'Failed to send verification code')
  }
}

export async function verifyOtp(email: string, otp: string): Promise<boolean> {
  const response = await fetch(`${API_URL}/api/v1/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, otp })
  })
  if (!response.ok) return false
  const data = await response.json()
  return data.verified === true
}

export async function logout(): Promise<void> {
  // Call server to clear the httpOnly cookie
  try {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // Best-effort — clear local state even if the request fails
  }
  removeToken()
  removeUser()
}

// Auth headers for API calls
// With httpOnly cookies, the JWT is sent automatically via credentials: 'include'.
// No Authorization header needed — return empty object for backwards compatibility.
export function getAuthHeaders(): Record<string, string> {
  return {}
}
