'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { ArrowLeft, Settings, Shield, Ban, Plus, Trash2, Save } from 'lucide-react'
import AppLayout from '@/components/AppLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

type Tab = 'general' | 'automod' | 'bans'

interface AutoModRule {
  type: string
  value: string
  action: string
  name: string
}

interface BanEntry {
  id: number
  user_id: number
  username: string
  reason: string | null
  expires_at: string | null
  is_permanent: boolean
}

export default function CommunitySettingsPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('general')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // General
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [iconUrl, setIconUrl] = useState('')
  const [bannerUrl, setBannerUrl] = useState('')

  // AutoMod
  const [rules, setRules] = useState<AutoModRule[]>([])
  const [newRule, setNewRule] = useState<AutoModRule>({ type: 'keyword', value: '', action: 'review', name: '' })

  // Bans
  const [bans, setBans] = useState<BanEntry[]>([])
  const [banUserId, setBanUserId] = useState('')
  const [banReason, setBanReason] = useState('')
  const [banDays, setBanDays] = useState('')

  // Load community data
  useEffect(() => {
    if (!slug) return
    fetch(`${API_URL}/api/v1/communities/${slug}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setName(data.name || '')
          setDescription(data.description || '')
          setIconUrl(data.icon_url || '')
          setBannerUrl(data.banner_url || '')
        }
      })
  }, [slug])

  // Load automod rules
  useEffect(() => {
    if (tab === 'automod' && slug) {
      fetch(`${API_URL}/api/v1/communities/${slug}/automod`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { rules: [] })
        .then(data => setRules(data.rules || []))
        .catch(() => {})
    }
  }, [tab, slug])

  // Load bans
  useEffect(() => {
    if (tab === 'bans' && slug) {
      fetch(`${API_URL}/api/v1/communities/${slug}/bans`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { bans: [] })
        .then(data => setBans(data.bans || []))
        .catch(() => {})
    }
  }, [tab, slug])

  const saveGeneral = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/communities/${slug}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, icon_url: iconUrl || undefined, banner_url: bannerUrl || undefined }),
      })
      setMessage(res.ok ? 'Saved!' : 'Failed to save')
    } catch { setMessage('Error saving') }
    setSaving(false)
    setTimeout(() => setMessage(''), 3000)
  }

  const saveRules = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/communities/${slug}/automod`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules),
      })
      setMessage(res.ok ? 'Rules saved!' : 'Failed to save')
    } catch { setMessage('Error saving') }
    setSaving(false)
    setTimeout(() => setMessage(''), 3000)
  }

  const addRule = () => {
    if (!newRule.name || !newRule.value) return
    setRules([...rules, { ...newRule }])
    setNewRule({ type: 'keyword', value: '', action: 'review', name: '' })
  }

  const removeRule = (i: number) => setRules(rules.filter((_, idx) => idx !== i))

  const banUser = async () => {
    if (!banUserId) return
    setSaving(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/communities/${slug}/ban/${banUserId}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: banReason || undefined, duration_days: banDays ? parseInt(banDays) : undefined }),
      })
      if (res.ok) {
        setBanUserId(''); setBanReason(''); setBanDays('')
        // Reload bans
        const r = await fetch(`${API_URL}/api/v1/communities/${slug}/bans`, { credentials: 'include' })
        if (r.ok) setBans((await r.json()).bans || [])
        setMessage('User banned')
      } else {
        const err = await res.json().catch(() => ({}))
        setMessage(err.detail || 'Ban failed')
      }
    } catch { setMessage('Error') }
    setSaving(false)
    setTimeout(() => setMessage(''), 3000)
  }

  const unbanUser = async (userId: number) => {
    const res = await fetch(`${API_URL}/api/v1/communities/${slug}/ban/${userId}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (res.ok) {
      setBans(bans.filter(b => b.user_id !== userId))
      setMessage('User unbanned')
      setTimeout(() => setMessage(''), 3000)
    }
  }

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'general', label: 'General', icon: Settings },
    { key: 'automod', label: 'AutoMod', icon: Shield },
    { key: 'bans', label: 'Bans', icon: Ban },
  ]

  return (
    <AppLayout>
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/community/${slug}`} className="text-fg-muted hover:text-fg-primary">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Settings className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-bold text-fg-primary">Community Settings</h1>
        </div>

        {/* Status message */}
        {message && (
          <div className="mb-4 p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-sm text-cyan-400">
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-surface-base border border-line-subtle rounded-xl p-1.5">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-1 justify-center ${
                tab === key ? 'bg-surface-active text-fg-primary' : 'text-fg-muted hover:text-fg-secondary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* General Tab */}
        {tab === 'general' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-surface-base border border-line-subtle rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-sm text-fg-secondary mb-1.5">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
            </div>
            <div>
              <label className="block text-sm text-fg-secondary mb-1.5">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary focus:outline-none focus:ring-1 focus:ring-cyan-500/50 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-fg-secondary mb-1.5">Icon URL</label>
                <input value={iconUrl} onChange={e => setIconUrl(e.target.value)} placeholder="https://..." className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
              </div>
              <div>
                <label className="block text-sm text-fg-secondary mb-1.5">Banner URL</label>
                <input value={bannerUrl} onChange={e => setBannerUrl(e.target.value)} placeholder="https://..." className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
              </div>
            </div>
            <button onClick={saveGeneral} disabled={saving} className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-white rounded-lg text-sm font-medium flex items-center gap-2">
              <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </motion.div>
        )}

        {/* AutoMod Tab */}
        {tab === 'automod' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            {/* Existing rules */}
            <div className="bg-surface-base border border-line-subtle rounded-xl p-6">
              <h3 className="text-sm font-semibold text-fg-primary mb-4">Active Rules ({rules.length})</h3>
              {rules.length === 0 ? (
                <p className="text-sm text-fg-muted">No automod rules configured</p>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-surface-raised/50 rounded-lg">
                      <div className="flex-1">
                        <div className="text-sm text-fg-primary">{rule.name}</div>
                        <div className="text-xs text-fg-muted">
                          <span className="px-1.5 py-0.5 bg-surface-raised rounded text-fg-muted mr-2">{rule.type}</span>
                          {rule.value}
                          <span className={`ml-2 px-1.5 py-0.5 rounded ${rule.action === 'remove' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
                            {rule.action}
                          </span>
                        </div>
                      </div>
                      <button onClick={() => removeRule(i)} className="text-fg-muted hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add rule */}
            <div className="bg-surface-base border border-line-subtle rounded-xl p-6">
              <h3 className="text-sm font-semibold text-fg-primary mb-4">Add Rule</h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-fg-muted mb-1">Rule Name</label>
                  <input value={newRule.name} onChange={e => setNewRule({ ...newRule, name: e.target.value })} placeholder="e.g., Block spam links" className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                </div>
                <div>
                  <label className="block text-xs text-fg-muted mb-1">Type</label>
                  <select value={newRule.type} onChange={e => setNewRule({ ...newRule, type: e.target.value })} className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50">
                    <option value="keyword">Keyword</option>
                    <option value="regex">Regex</option>
                    <option value="account_age">Account Age (days)</option>
                    <option value="karma">Min Karma</option>
                    <option value="link">Link Pattern</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-fg-muted mb-1">Value</label>
                  <input value={newRule.value} onChange={e => setNewRule({ ...newRule, value: e.target.value })} placeholder="e.g., guaranteed returns" className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                </div>
                <div>
                  <label className="block text-xs text-fg-muted mb-1">Action</label>
                  <select value={newRule.action} onChange={e => setNewRule({ ...newRule, action: e.target.value })} className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50">
                    <option value="review">Queue for Review</option>
                    <option value="remove">Auto-Remove</option>
                  </select>
                </div>
              </div>
              <button onClick={addRule} className="px-4 py-2 bg-surface-raised hover:bg-surface-active text-fg-primary rounded-lg text-sm font-medium flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add Rule
              </button>
            </div>

            {/* Save all */}
            <button onClick={saveRules} disabled={saving} className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-white rounded-lg text-sm font-medium flex items-center gap-2">
              <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save All Rules'}
            </button>
          </motion.div>
        )}

        {/* Bans Tab */}
        {tab === 'bans' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            {/* Ban form */}
            <div className="bg-surface-base border border-line-subtle rounded-xl p-6">
              <h3 className="text-sm font-semibold text-fg-primary mb-4">Ban User</h3>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-fg-muted mb-1">User ID</label>
                  <input value={banUserId} onChange={e => setBanUserId(e.target.value)} placeholder="123" className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                </div>
                <div>
                  <label className="block text-xs text-fg-muted mb-1">Reason</label>
                  <input value={banReason} onChange={e => setBanReason(e.target.value)} placeholder="Spam" className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                </div>
                <div>
                  <label className="block text-xs text-fg-muted mb-1">Days (empty=permanent)</label>
                  <input value={banDays} onChange={e => setBanDays(e.target.value)} placeholder="30" type="number" className="w-full px-3 py-2 bg-surface-raised border border-line-subtle rounded-lg text-fg-primary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                </div>
              </div>
              <button onClick={banUser} disabled={saving} className="px-4 py-2 bg-red-500/80 hover:bg-red-500 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                <Ban className="w-4 h-4" /> {saving ? 'Banning...' : 'Ban User'}
              </button>
            </div>

            {/* Ban list */}
            <div className="bg-surface-base border border-line-subtle rounded-xl p-6">
              <h3 className="text-sm font-semibold text-fg-primary mb-4">Banned Users ({bans.length})</h3>
              {bans.length === 0 ? (
                <p className="text-sm text-fg-muted">No banned users</p>
              ) : (
                <div className="space-y-2">
                  {bans.map(ban => (
                    <div key={ban.id} className="flex items-center gap-3 p-3 bg-surface-raised/50 rounded-lg">
                      <div className="flex-1">
                        <div className="text-sm text-fg-primary">{ban.username}</div>
                        <div className="text-xs text-fg-muted">
                          {ban.reason || 'No reason'}
                          {ban.is_permanent ? (
                            <span className="ml-2 text-red-400">Permanent</span>
                          ) : (
                            <span className="ml-2 text-amber-400">Expires: {new Date(ban.expires_at!).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => unbanUser(ban.user_id)} className="px-3 py-1 text-xs bg-surface-raised hover:bg-surface-active text-fg-secondary rounded-lg">
                        Unban
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
    </AppLayout>
  )
}
