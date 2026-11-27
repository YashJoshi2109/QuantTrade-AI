import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import AdminShell from '@/components/admin/AdminShell'

// No admin-specific title here: a non-admin gets the regular 404 page, and
// the document title must not reveal that the route exists.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

const AUTH_COOKIE = 'qt_access_token'

/**
 * Server-side gate: non-admins (and signed-out visitors) get a real 404 for
 * every /admin route. The backend decides via /api/v1/auth/session; the
 * admin APIs enforce admin again on every request.
 */
async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) return false
  const h = await headers()
  const configured = process.env.BACKEND_INTERNAL_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || ''
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || 'http'
  const base = (configured || (host ? `${proto}://${host}` : '')).replace(/\/$/, '')
  if (!base) return false
  try {
    const res = await fetch(`${base}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return false
    const data = (await res.json()) as { is_admin?: unknown }
    return data.is_admin === true
  } catch {
    return false
  }
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await isAdmin())) notFound()
  return <AdminShell>{children}</AdminShell>
}
