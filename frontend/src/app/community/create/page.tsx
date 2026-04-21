'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus } from 'lucide-react'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''
const CATEGORIES = ['stocks', 'options', 'crypto', 'forex', 'macro', 'education', 'general']

export default function CreateCommunityPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('stocks')
  const [tickerFocus, setTickerFocus] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const generateSlug = (n: string) => {
    return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/communities`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: slug || generateSlug(name),
          description,
          category,
          ticker_focus: tickerFocus || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to create community')
      }
      const community = await res.json()
      router.push(`/community/${community.slug}`)
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    }
    setSubmitting(false)
  }

  return (
    <AppLayout>
    <div className="min-h-screen">
      <div className="max-w-xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/community" className="text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold text-slate-100">Create Community</h1>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSubmit}
          className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-6 space-y-5"
        >
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Community Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (!slug) setSlug(generateSlug(e.target.value)) }}
              className="w-full px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              placeholder="e.g., Tech Stocks Daily"
              required
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Slug *</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="w-full px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-slate-200 font-mono text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              placeholder="tech-stocks-daily"
              required
              maxLength={100}
            />
            <p className="text-[10px] text-slate-600 mt-1">URL: /community/{slug || '...'}</p>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 resize-none"
              placeholder="What is this community about?"
              maxLength={2000}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Category *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Ticker Focus</label>
              <input
                type="text"
                value={tickerFocus}
                onChange={(e) => setTickerFocus(e.target.value.toUpperCase().slice(0, 10))}
                className="w-full px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                placeholder="AAPL"
                maxLength={10}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !name || !slug}
            className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {submitting ? 'Creating...' : 'Create Community'}
          </button>
        </motion.form>
      </div>
    </div>
    </AppLayout>
  )
}
