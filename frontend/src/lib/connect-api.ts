import { getAuthHeaders } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...(init?.headers || {}),
  }
  return fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' })
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.detail || `HTTP ${res.status}`)
  }
  return data as T
}

export type ConnectStatus = {
  has_account: boolean
  connected_account_id?: string
  ready_to_process_payments?: boolean
  requirements_status?: string
  onboarding_complete?: boolean
}

export async function createConnectedAccount() {
  const res = await authFetch('/api/v1/connect/account', { method: 'POST', body: JSON.stringify({}) })
  return parseOrThrow<{ connected_account_id: string; already_exists?: boolean }>(res)
}

export async function getConnectedAccountStatus() {
  const res = await authFetch('/api/v1/connect/account/status')
  return parseOrThrow<ConnectStatus>(res)
}

export async function createOnboardingLink() {
  const res = await authFetch('/api/v1/connect/account/onboarding-link', { method: 'POST' })
  return parseOrThrow<{ url: string }>(res)
}

export async function createConnectedProduct(input: {
  name: string
  description?: string
  price_in_cents: number
  currency?: string
}) {
  const res = await authFetch('/api/v1/connect/products', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return parseOrThrow<{ product: any }>(res)
}

export async function listStorefrontProducts(accountId: string) {
  const res = await fetch(`${API_URL}/api/v1/connect/storefront/${encodeURIComponent(accountId)}/products`)
  return parseOrThrow<{ products: any[] }>(res)
}

export async function createStorefrontCheckout(input: {
  account_id: string
  product_name: string
  amount_cents: number
  currency?: string
}) {
  const res = await authFetch('/api/v1/connect/storefront/checkout', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return parseOrThrow<{ url: string }>(res)
}

export async function createConnectedSubscriptionCheckout(input: {
  connected_account_id: string
  price_id?: string
}) {
  const res = await authFetch('/api/v1/connect/subscription/checkout', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return parseOrThrow<{ url: string }>(res)
}

export async function createConnectedSubscriptionPortal(connectedAccountId: string) {
  const res = await authFetch(
    `/api/v1/connect/subscription/portal?connected_account_id=${encodeURIComponent(connectedAccountId)}`,
    { method: 'POST' }
  )
  return parseOrThrow<{ url: string }>(res)
}
