'use client'

import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

// Dynamically import UnicornScene to avoid SSR issues with WebGL
const UnicornScene = dynamic(
  () => import('unicornstudio-react/next'),
  { ssr: false }
)

const PROJECT_ID = 'm9yCIl2L4itRoFvmf85D'
const SDK_URL =
  'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.1.9/dist/unicornStudio.umd.js'

/**
 * Premium loading animation shown while the AI copilot generates a response.
 * Renders a Unicorn Studio WebGL scene with overlay status text.
 */
export default function CopilotLoadingScene({
  stage,
  symbol,
}: {
  stage: 'intent' | 'data' | 'streaming'
  symbol?: string | null
}) {
  const stageLabel =
    stage === 'intent'
      ? 'Analyzing intent...'
      : stage === 'data'
        ? symbol
          ? `Fetching ${symbol} data...`
          : 'Retrieving market data...'
        : 'Generating analysis...'

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col items-center gap-3"
    >
      {/* WebGL Scene */}
      <div className="relative w-full max-w-[320px] sm:max-w-[400px] aspect-[16/9] rounded-2xl overflow-hidden border border-line-subtle shadow-[0_0_40px_rgba(0,122,255,0.12)]">
        <UnicornScene
          projectId={PROJECT_ID}
          sdkUrl={SDK_URL}
          width="100%"
          height="100%"
          lazyLoad
          production
        />
        {/* Gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0E1A]/80 via-transparent to-transparent pointer-events-none" />

        {/* Stage indicator overlay */}
        <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-2 pointer-events-none">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          </motion.div>
          <span className="text-[11px] font-medium text-white/80 font-mono tracking-wide">
            {stageLabel}
          </span>
        </div>
      </div>

      {/* Pulse dots beneath */}
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[#007AFF]"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.2,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
    </motion.div>
  )
}
