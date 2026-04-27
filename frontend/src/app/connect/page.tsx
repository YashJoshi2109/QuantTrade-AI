'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import {
  createConnectedAccount,
  createConnectedProduct,
  createConnectedSubscriptionCheckout,
  createConnectedSubscriptionPortal,
  createOnboardingLink,
  getConnectedAccountStatus,
  listStorefrontProducts,
  type ConnectStatus,
  createStorefrontCheckout,
} from '@/lib/connect-api'

export default function ConnectPage() {
  const [status, setStatus] = useState<ConnectStatus | null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [productName, setProductName] = useState('Starter Product')
  const [productPrice, setProductPrice] = useState('999')
  const [storefrontProducts, setStorefrontProducts] = useState<any[]>([])

  const accountId = useMemo(() => status?.connected_account_id || '', [status])

  async function refreshStatus() {
    try {
      const next = await getConnectedAccountStatus()
      setStatus(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Connect status')
    }
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  useEffect(() => {
    if (!accountId) return
    listStorefrontProducts(accountId)
      .then((d) => setStorefrontProducts(d.products || []))
      .catch(() => setStorefrontProducts([]))
  }, [accountId])

  async function run<T>(fn: () => Promise<T>) {
    setError('')
    setLoading(true)
    try {
      return await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
      return null
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-surface-base -mx-4 md:-mx-6 -my-4 md:-my-6 px-4 py-6 md:px-8 md:py-10">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="rounded-2xl border border-line-subtle bg-surface-raised p-5 md:p-6">
            <h1 className="text-xl md:text-2xl font-bold text-fg-primary">Stripe Connect Control Center</h1>
            <p className="text-fg-muted text-sm mt-1">
              Create connected accounts, onboard, publish products, and charge customers/subscriptions.
            </p>
            {error && <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                disabled={loading}
                onClick={() => run(async () => { await createConnectedAccount(); await refreshStatus() })}
                className="h-11 rounded-xl bg-cyan-500 text-slate-950 font-semibold"
              >
                Create Connected Account
              </button>
              <button
                disabled={loading || !accountId}
                onClick={() =>
                  run(async () => {
                    const res = await createOnboardingLink()
                    if (res?.url) window.location.href = res.url
                  })
                }
                className="h-11 rounded-xl border border-cyan-500/40 text-cyan-300 font-semibold disabled:opacity-50"
              >
                Onboard to Collect Payments
              </button>
              <button disabled={loading} onClick={() => run(refreshStatus)} className="h-11 rounded-xl border border-line-default text-fg-primary font-semibold">
                Refresh Status
              </button>
            </div>
            <div className="mt-4 text-xs text-fg-primary space-y-1">
              <p><span className="text-fg-muted">Account:</span> {accountId || 'Not created yet'}</p>
              <p><span className="text-fg-muted">Onboarding complete:</span> {String(Boolean(status?.onboarding_complete))}</p>
              <p><span className="text-fg-muted">Card payments:</span> {status?.ready_to_process_payments ? 'active' : 'not active yet'}</p>
              <p><span className="text-fg-muted">Requirements:</span> {status?.requirements_status || 'unknown'}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-line-subtle bg-surface-raised p-5 md:p-6">
            <h2 className="text-lg font-semibold text-fg-primary">Create Product (Connected Account)</h2>
            <p className="text-fg-muted text-xs mt-1">Uses Stripe-Account header via server endpoint.</p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <input value={productName} onChange={(e) => setProductName(e.target.value)} className="h-11 rounded-xl bg-surface-raised border border-line-default px-3 text-sm text-fg-primary" />
              <input value={productPrice} onChange={(e) => setProductPrice(e.target.value)} className="h-11 rounded-xl bg-surface-raised border border-line-default px-3 text-sm text-fg-primary" />
              <button
                disabled={loading || !accountId}
                onClick={() =>
                  run(async () => {
                    await createConnectedProduct({
                      name: productName,
                      price_in_cents: Number(productPrice || '0'),
                      currency: 'usd',
                    })
                    if (accountId) {
                      const d = await listStorefrontProducts(accountId)
                      setStorefrontProducts(d.products || [])
                    }
                  })
                }
                className="h-11 rounded-xl bg-emerald-500 text-slate-950 font-semibold disabled:opacity-50"
              >
                Create Product
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-line-subtle bg-surface-raised p-5 md:p-6">
            <h2 className="text-lg font-semibold text-fg-primary">Storefront</h2>
            <p className="text-fg-muted text-xs mt-1">
              Demo page uses connected account ID in URL. Replace with your own seller slug for production.
            </p>
            <div className="mt-4 space-y-3">
              {storefrontProducts.length === 0 && <p className="text-xs text-fg-muted">No products yet.</p>}
              {storefrontProducts.map((p) => {
                const amount = p?.default_price?.unit_amount || 0
                return (
                  <div key={p.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-xl border border-line-subtle bg-surface-hover p-3">
                    <div>
                      <p className="text-sm text-fg-primary font-medium">{p.name}</p>
                      <p className="text-xs text-fg-muted">{p.description || 'No description'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-emerald-300 font-semibold">${(amount / 100).toFixed(2)}</span>
                      <button
                        className="h-9 px-4 rounded-lg bg-cyan-500 text-fg-primary text-sm font-semibold"
                        onClick={() =>
                          run(async () => {
                            if (!accountId) return
                            const res = await createStorefrontCheckout({
                              account_id: accountId,
                              product_name: p.name,
                              amount_cents: amount,
                              currency: p?.default_price?.currency || 'usd',
                            })
                            if (res?.url) window.location.href = res.url
                          })
                        }
                      >
                        Buy
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-line-subtle bg-surface-raised p-5 md:p-6">
            <h2 className="text-lg font-semibold text-fg-primary">Connected Account Subscription</h2>
            <p className="text-fg-muted text-xs mt-1">Platform charges connected account via hosted Checkout and customer_account.</p>
            <div className="mt-4 flex flex-col md:flex-row gap-3">
              <button
                disabled={loading || !accountId}
                className="h-11 px-5 rounded-xl bg-violet-500 text-white font-semibold disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    if (!accountId) return
                    const res = await createConnectedSubscriptionCheckout({ connected_account_id: accountId })
                    if (res?.url) window.location.href = res.url
                  })
                }
              >
                Subscribe Connected Account
              </button>
              <button
                disabled={loading || !accountId}
                className="h-11 px-5 rounded-xl border border-violet-500/40 text-violet-300 font-semibold disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    if (!accountId) return
                    const res = await createConnectedSubscriptionPortal(accountId)
                    if (res?.url) window.location.href = res.url
                  })
                }
              >
                Open Billing Portal
              </button>
              <Link href="/pricing" className="h-11 px-5 rounded-xl border border-line-default text-fg-primary font-semibold inline-flex items-center justify-center">
                Existing Pricing Page
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
