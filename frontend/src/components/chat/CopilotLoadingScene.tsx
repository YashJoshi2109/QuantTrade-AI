'use client'

import { motion } from 'framer-motion'

const STAGES = ['intent', 'data', 'streaming'] as const
type Stage = (typeof STAGES)[number]

const STAGE_IDX: Record<Stage, number> = { intent: 0, data: 1, streaming: 2 }

/**
 * Production-grade loading animation — no external CDN deps.
 * Pure Framer Motion + SVG. Replaces UnicornStudio WebGL scene.
 */
export default function CopilotLoadingScene({
  stage,
  symbol,
}: {
  stage: Stage
  symbol?: string | null
}) {
  const stageLabel =
    stage === 'intent'
      ? 'Detecting intent…'
      : stage === 'data'
        ? symbol
          ? `Fetching ${symbol} data…`
          : 'Retrieving market data…'
        : 'Generating analysis…'

  const activeIdx = STAGE_IDX[stage]

  // Node positions for neural-net overlay [x%, y%]
  const nodes: [number, number, number][] = [
    [8, 55, 0],
    [22, 28, 0.4],
    [38, 68, 0.15],
    [54, 22, 0.6],
    [70, 58, 0.25],
    [85, 32, 0.8],
    [50, 45, 0.5],
  ]

  // Connections between node indices
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 6], [3, 6], [4, 6], [5, 4], [6, 3],
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col gap-3 w-full max-w-[340px]"
    >
      {/* ── Main Scene Card ── */}
      <div className="relative rounded-2xl border border-[rgba(0,122,255,0.18)] bg-[#080C18] overflow-hidden"
           style={{ height: 140 }}>

        {/* Ambient glow */}
        <div className="absolute -top-6 -left-6 w-36 h-36 rounded-full bg-[#007AFF]/6 blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-28 h-28 rounded-full bg-cyan-500/5 blur-xl pointer-events-none" />

        {/* Horizontal grid lines */}
        {[0.28, 0.55, 0.80].map((f, i) => (
          <motion.div
            key={i}
            className="absolute left-0 right-0 h-px bg-[rgba(255,255,255,0.04)]"
            style={{ top: `${f * 100}%` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 * i }}
          />
        ))}

        {/* Price chart SVG */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 340 140"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="chartLine" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#007AFF" stopOpacity="0.15" />
              <stop offset="60%" stopColor="#007AFF" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#00D9FF" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="chartFill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#007AFF" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#007AFF" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Fill under chart */}
          <motion.path
            d="M0,110 C30,105 60,85 100,78 S150,55 200,58 S260,38 300,30 S325,22 340,18 L340,140 L0,140 Z"
            fill="url(#chartFill)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />

          {/* Chart line */}
          <motion.path
            d="M0,110 C30,105 60,85 100,78 S150,55 200,58 S260,38 300,30 S325,22 340,18"
            fill="none"
            stroke="url(#chartLine)"
            strokeWidth="1.5"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.4, ease: 'easeInOut' }}
          />

          {/* Animated dot at chart head */}
          <motion.circle
            cx="340" cy="18" r="3"
            fill="#00D9FF"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 1, 0.6, 1], scale: [0, 1.2, 0.9, 1.1] }}
            transition={{ delay: 1.2, duration: 1, repeat: Infinity, repeatType: 'mirror' }}
          />
        </svg>

        {/* Neural-net node layer */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 340 140" preserveAspectRatio="none">
          {edges.map(([a, b], i) => {
            const [ax, ay] = nodes[a]
            const [bx, by] = nodes[b]
            return (
              <motion.line
                key={i}
                x1={`${ax * 3.4}`} y1={`${ay * 1.4}`}
                x2={`${bx * 3.4}`} y2={`${by * 1.4}`}
                stroke="rgba(0,122,255,0.18)"
                strokeWidth="0.8"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.6, 0.2, 0.5] }}
                transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
              />
            )
          })}
        </svg>

        {/* Node dots */}
        {nodes.map(([x, y, delay], i) => (
          <motion.div
            key={i}
            className="absolute rounded-full bg-[#007AFF]"
            style={{ left: `${x}%`, top: `${y}%`, width: 5, height: 5, marginLeft: -2.5, marginTop: -2.5 }}
            animate={{
              opacity: [0.2, 0.9, 0.2],
              scale: [0.7, 1.3, 0.7],
              boxShadow: ['0 0 0px #007AFF', '0 0 6px #007AFF', '0 0 0px #007AFF'],
            }}
            transition={{ duration: 2, repeat: Infinity, delay, ease: 'easeInOut' }}
          />
        ))}

        {/* Bottom status row */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gradient-to-t from-[#080C18] to-transparent">
          {/* Pulse indicator */}
          <div className="flex items-center gap-1.5">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-cyan-400"
              animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-[10px] font-mono text-white/55 tracking-wider">
              {stageLabel}
            </span>
          </div>

          {/* Candlestick mini bars */}
          <div className="flex items-end gap-0.5 h-5">
            {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
              <motion.div
                key={i}
                className={`w-1 rounded-sm ${h > 60 ? 'bg-emerald-500/70' : 'bg-red-500/60'}`}
                style={{ height: `${h * 0.22}px` }}
                initial={{ scaleY: 0, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ delay: 0.06 * i + 0.3, duration: 0.3, ease: 'easeOut' }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Stage progress bar ── */}
      <div className="flex gap-1.5">
        {STAGES.map((s, i) => (
          <motion.div
            key={s}
            className="flex-1 h-[2px] rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.07)' }}
          >
            <motion.div
              className="h-full rounded-full bg-[#007AFF]"
              initial={{ width: '0%' }}
              animate={{
                width: i < activeIdx ? '100%' : i === activeIdx ? '60%' : '0%',
                opacity: i === activeIdx ? [1, 0.5, 1] : 1,
              }}
              transition={{
                width: { duration: 0.5, ease: 'easeOut' },
                opacity: { duration: 1.2, repeat: i === activeIdx ? Infinity : 0 },
              }}
            />
          </motion.div>
        ))}
      </div>

      {/* ── Streaming skeleton lines (only on streaming stage) ── */}
      {stage === 'streaming' && (
        <motion.div
          className="space-y-2 px-0.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {[90, 75, 85, 50].map((w, i) => (
            <motion.div
              key={i}
              className="h-2 rounded-full bg-[rgba(255,255,255,0.05)]"
              style={{ width: `${w}%` }}
              animate={{ opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
            />
          ))}
        </motion.div>
      )}
    </motion.div>
  )
}
