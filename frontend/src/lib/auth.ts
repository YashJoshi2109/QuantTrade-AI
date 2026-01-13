/**
 * Authentication utilities
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface User {
  id: number
  email: string
  username: string
  full_name: string | null
  avatar_url: string | null
  is_verified: boolean
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
}

// Token management
export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('auth_token')
}

export function setToken(token: string): void {
  localStorage.setItem('auth_token', token)
}

export function removeToken(): void {
  localStorage.removeItem('auth_token')
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
  fullName?: string
): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password, full_name: fullName })
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || 'Registration failed')
  }
  
  const data: AuthResponse = await response.json()
  setToken(data.access_token)
  setUser(data.user)
  return data
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  
  if (!response.ok) {
    const error = await response.json()
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
    body: JSON.stringify({
      google_id: googleId,
      email,
      name,
      avatar_url: avatarUrl
    })
  })
  
  if (!response.ok) {
    const error = await response.json()
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
    body: JSON.stringify({ credential })
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || 'Google verification failed')
  }
  
  const data: AuthResponse = await response.json()
  setToken(data.access_token)
  setUser(data.user)
  return data
}

export async function checkSession(): Promise<{ authenticated: boolean; user: User | null }> {
  const token = getToken()
  if (!token) {
    return { authenticated: false, user: null }
  }
  
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/session`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
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

export function logout(): void {
  removeToken()
  removeUser()
}

// Auth headers for API calls
export function getAuthHeaders(): Record<string, string> {
  const token = getToken()
  if (!token) return {}
  return { 'Authorization': `Bearer ${token}` }
}
