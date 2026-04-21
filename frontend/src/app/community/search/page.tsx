'use client'

import { useState, useCallback } from 'react'
import { Search as SearchIcon, MessageSquare, Users, Hash } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import AppLayout from '@/components/AppLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

type SearchResults = {
  posts?: Array<{ id: number; title: string; body: string; sentiment?: string; upvote_count: number; comment_count: number; created_at: string }>
  comments?: Array<{ id: number; post_id: number; body: string; upvote_count: number; created_at: string }>
  communities?: Array<{ slug: string; name: string; description: string; category: string; member_count: number }>
  users?: Array<{ id: number; username: string; full_name?: string; avatar_url?: string; reputation: number }>
}

type TabKey = 'all' | 'posts' | 'comments' | 'communities' | 'users'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>({})
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [searched, setSearched] = useState(false)

  const doSearch = useCallback(async (q: string, type?: string) => {
    if (q.length < 2) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ q })
      if (type && type !== 'all') params.set('type', type)
      const res = await fetch(`${API_URL}/api/v1/search?${params}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setResults(data.results || {})
      }
    } catch { /* silent */ }
    setLoading(false)
    setSearched(true)
  }, [])

  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: 'all', label: 'All', icon: SearchIcon },
    { key: 'posts', label: 'Posts', icon: Hash },
    { key: 'comments', label: 'Comments', icon: MessageSquare },
    { key: 'communities', label: 'Communities', icon: Users },
    { key: 'users', label: 'Users', icon: Users },
  ]

  return (
    <AppLayout>
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Search Bar */}
        <div className="relative mb-6">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch(query, activeTab)}
            placeholder="Search posts, comments, communities, users..."
            className="w-full pl-12 pr-4 py-3 bg-[#0D1117] border border-white/[0.06] rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30"
            autoFocus
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[#0D1117] border border-white/[0.06] rounded-xl p-1.5">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); if (query.length >= 2) doSearch(query, key) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-1 justify-center ${
                activeTab === key ? 'bg-white/[0.06] text-slate-100' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Results */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 animate-pulse">
                <div className="h-4 w-3/4 bg-slate-800 rounded mb-2" />
                <div className="h-3 w-1/2 bg-slate-800/50 rounded" />
              </div>
            ))}
          </div>
        ) : !searched ? (
          <div className="text-center py-16 text-slate-500">
            <SearchIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Search across the entire community</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Posts */}
            {results.posts && results.posts.length > 0 && (activeTab === 'all' || activeTab === 'posts') && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Posts</h3>
                {results.posts.map(p => (
                  <Link key={p.id} href={`/community/post/${p.id}`} className="block bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 mb-2 hover:border-white/[0.12] transition-colors">
                    <h4 className="text-sm font-medium text-slate-200 mb-1">{p.title}</h4>
                    <p className="text-xs text-slate-400 line-clamp-2">{p.body}</p>
                    <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
                      <span>{p.upvote_count} votes</span>
                      <span>{p.comment_count} comments</span>
                      {p.sentiment && <span className={p.sentiment === 'bullish' ? 'text-emerald-400' : p.sentiment === 'bearish' ? 'text-red-400' : ''}>{p.sentiment}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Comments */}
            {results.comments && results.comments.length > 0 && (activeTab === 'all' || activeTab === 'comments') && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Comments</h3>
                {results.comments.map(c => (
                  <Link key={c.id} href={`/community/post/${c.post_id}`} className="block bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 mb-2 hover:border-white/[0.12] transition-colors">
                    <p className="text-xs text-slate-300 line-clamp-2">{c.body}</p>
                    <span className="text-[10px] text-slate-500 mt-1 block">{c.upvote_count} votes</span>
                  </Link>
                ))}
              </div>
            )}

            {/* Communities */}
            {results.communities && results.communities.length > 0 && (activeTab === 'all' || activeTab === 'communities') && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Communities</h3>
                {results.communities.map(c => (
                  <Link key={c.slug} href={`/community/${c.slug}`} className="block bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 mb-2 hover:border-white/[0.12] transition-colors">
                    <h4 className="text-sm font-medium text-slate-200">{c.name}</h4>
                    <p className="text-xs text-slate-400 line-clamp-1">{c.description}</p>
                    <div className="flex gap-2 mt-1 text-[10px] text-slate-500">
                      <span>{c.member_count} members</span>
                      <span className="px-1.5 py-0.5 bg-slate-800/50 rounded">{c.category}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Users */}
            {results.users && results.users.length > 0 && (activeTab === 'all' || activeTab === 'users') && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Users</h3>
                {results.users.map(u => (
                  <Link key={u.id} href={`/community/user/${u.username}`} className="flex items-center gap-3 bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 mb-2 hover:border-white/[0.12] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
                      {u.username[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm text-slate-200">{u.username}</div>
                      {u.full_name && <div className="text-xs text-slate-500">{u.full_name}</div>}
                    </div>
                    <span className="ml-auto text-xs text-slate-500">{u.reputation} rep</span>
                  </Link>
                ))}
              </div>
            )}

            {/* No results */}
            {Object.values(results).every(arr => !arr || arr.length === 0) && (
              <div className="text-center py-12 text-slate-500">
                <p>No results found for &quot;{query}&quot;</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </AppLayout>
  )
}
