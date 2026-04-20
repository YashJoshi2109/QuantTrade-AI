'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell } from 'lucide-react'
import Link from 'next/link'
import { fetchUnreadCount } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useCommunityWS } from '@/hooks/useCommunityWS'

export default function NotificationBell() {
  const [count, setCount] = useState(0)
  const { user } = useAuth()

  const poll = useCallback(async () => {
    try {
      const data = await fetchUnreadCount()
      setCount(data.count ?? 0)
    } catch {
      // Silently ignore errors
    }
  }, [])

  useEffect(() => {
    poll()
    const interval = setInterval(poll, 30_000)
    return () => clearInterval(interval)
  }, [poll])

  // Real-time: increment unread count instantly on WebSocket events
  const handleWSMessage = useCallback((msg: { type: string }) => {
    if (msg.type === 'new_comment' || msg.type === 'mention' || msg.type === 'new_post') {
      setCount(prev => prev + 1)
    }
  }, [])

  useCommunityWS(user?.id ? `user:${user.id}` : null, handleWSMessage)

  return (
    <Link
      href="/notifications"
      className="relative p-2 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 border border-transparent hover:border-slate-700/50 transition-colors"
      aria-label={count > 0 ? `${count} unread notifications` : 'Notifications'}
      title="Notifications"
    >
      <Bell className="w-5 h-5" aria-hidden />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full text-[10px] font-bold bg-red-500 text-white border-2 border-[#0d1321] leading-none">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
