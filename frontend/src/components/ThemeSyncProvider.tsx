'use client'
import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

async function fetchThemePreference(token: string): Promise<'light' | 'dark'> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/user/me/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return 'light'
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return 'light'
    const data = await res.json()
    return data.theme === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

async function saveThemePreference(theme: string, token: string): Promise<void> {
  await fetch(`${API_BASE}/api/v1/user/me/preferences`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ theme }),
  }).catch(() => {}) // silent failure — localStorage is source of truth
}

export function ThemeSyncProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstMount = useRef(true)

  // On mount: if user is logged in, sync theme from backend
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    fetchThemePreference(token).then((serverTheme) => {
      // Only override if server has a preference different from current
      if (serverTheme !== resolvedTheme) {
        setTheme(serverTheme)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // On theme change: debounced save to backend
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      return
    }
    const token = localStorage.getItem('access_token')
    if (!token || !theme) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveThemePreference(theme, token)
    }, 1000)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [theme])

  return <>{children}</>
}
