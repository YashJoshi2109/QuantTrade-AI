'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { gameApi } from '@/lib/game-api'
import { useGameStore } from '@/lib/game-store'

/**
 * /game entry point.
 * Calls bootstrap, then routes:
 *   - new character → /game/onboarding
 *   - existing character → /game/dashboard
 */
export default function GameEntryPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  const { setBootstrap, setLoading, setError } = useGameStore()

  useEffect(() => {
    if (isLoading || !isAuthenticated) return
    setLoading(true)
    gameApi
      .bootstrap()
      .then((data) => {
        setBootstrap(data)
        if (data.is_new_character) {
          router.replace('/game/onboarding')
        } else {
          router.replace('/game/dashboard')
        }
      })
      .catch((err: Error) => {
        if (err.message === 'UNAUTHENTICATED') {
          router.replace('/auth?redirect=/game')
        } else {
          setError(err.message)
        }
      })
  }, [isAuthenticated, isLoading])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 relative">
          <div className="absolute inset-0 border-2 border-amber-500/20 border-t-amber-400 rounded-full animate-spin" />
          <div className="absolute inset-3 border border-amber-600/20 border-t-amber-500/50 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
          <div className="absolute inset-0 flex items-center justify-center text-2xl">⚔️</div>
        </div>
        <h2 className="text-amber-400 text-xl font-semibold tracking-wide mb-2">Entering the Realm</h2>
        <p className="text-amber-400/50 text-sm">Preparing your financial kingdom...</p>
      </div>
    </div>
  )
}
