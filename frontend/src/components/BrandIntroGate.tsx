'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { QuantTradeIntro, INTRO_DURATION_FRAMES, INTRO_FPS } from '@/remotion/QuantTradeIntro'

const STORAGE_KEY = 'quanttrade_brand_intro_v1'

/** Centers a 16:9 composition and scales it to cover the viewport (landscape + portrait). */
function IntroCoverFrame({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#020617]">
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: '100vw',
          height: '56.25vw',
          minWidth: '177.78vh',
          minHeight: '100%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

export default function BrandIntroGate() {
  const [mounted, setMounted] = useState(false)
  const [show, setShow] = useState(false)
  const playerRef = useRef<PlayerRef>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      if (localStorage.getItem(STORAGE_KEY) === '1') return
    } catch {
      /* private mode */
    }
    setShow(true)
  }, [mounted])

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
    setShow(false)
  }, [])

  useEffect(() => {
    if (!show) return
    let cancelled = false
    const onEnded = () => {
      if (!cancelled) dismiss()
    }
    const raf = window.requestAnimationFrame(() => {
      playerRef.current?.addEventListener('ended', onEnded)
    })
    const ms = (INTRO_DURATION_FRAMES / INTRO_FPS) * 1000 + 500
    const fallback = window.setTimeout(() => {
      if (!cancelled) dismiss()
    }, ms)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
      window.clearTimeout(fallback)
      playerRef.current?.removeEventListener('ended', onEnded)
    }
  }, [show, dismiss])

  if (!mounted || !show) return null

  return (
    <div
      className="fixed inset-0 z-[100000] flex min-h-[100dvh] w-screen flex-col bg-[#020617]"
      role="dialog"
      aria-modal="true"
      aria-label="QuantTrade AI brand intro"
    >
      <IntroCoverFrame>
        <Player
          ref={playerRef}
          component={QuantTradeIntro}
          durationInFrames={INTRO_DURATION_FRAMES}
          compositionWidth={1920}
          compositionHeight={1080}
          fps={INTRO_FPS}
          controls={false}
          autoPlay
          loop={false}
          clickToPlay={false}
          doubleClickToFullscreen={false}
          spaceKeyToPlayOrPause={false}
          style={{ width: '100%', height: '100%' }}
        />
      </IntroCoverFrame>
      <button
        type="button"
        onClick={dismiss}
        className="pointer-events-auto absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-slate-200 bg-slate-900/90 border border-slate-600/80 rounded-xl hover:border-emerald-500/50 hover:text-white transition-colors sm:bottom-8"
      >
        Skip intro
      </button>
    </div>
  )
}
