'use client'

import { motion } from 'framer-motion'
import { Radio } from 'lucide-react'

const rowVariants = {
  hidden: { opacity: 0, x: -12 },
  show: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
  }),
}

export default function BrandedNewsLoading({ rows = 12 }: { rows?: number }) {
  return (
    <div className="relative flex flex-col min-h-[280px] p-3 sm:p-4 overflow-hidden">
      {/* Aurora background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        aria-hidden
      >
        <div className="absolute -top-1/2 left-1/4 h-[120%] w-[60%] rounded-full bg-cyan-500/15 blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/3 right-1/4 h-[80%] w-[50%] rounded-full bg-violet-500/10 blur-3xl animate-pulse [animation-delay:400ms]" />
        <div className="absolute inset-0 opacity-60 animate-shimmer" />
      </div>

      <div className="relative flex items-center gap-2 mb-4">
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.25)]"
        >
          <Radio className="h-4 w-4 text-cyan-300" />
        </motion.div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-400/90">
            Hydrating feed
          </p>
          <p className="text-[10px] text-fg-muted mt-0.5">
            Pulling headlines from the wire — cached results appear first when available
          </p>
        </div>
      </div>

      <div className="relative space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <motion.div
            key={i}
            custom={i}
            variants={rowVariants}
            initial="hidden"
            animate="show"
            className="flex gap-3 rounded-lg border border-line-subtle bg-surface-base/40 p-3 overflow-hidden"
          >
            <div className="mt-0.5 h-9 w-9 shrink-0 rounded-lg bg-surface-raised/80 skeleton-shimmer" />
            <div className="flex-1 space-y-2 min-w-0">
              <div className="h-3.5 rounded-md bg-surface-raised/90 skeleton-shimmer w-[92%]" />
              <div className="h-3 rounded-md bg-surface-raised/70 skeleton-shimmer w-[70%]" />
              <div className="h-2.5 rounded-md bg-surface-raised/50 w-[40%]" />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
