'use client'

import { motion, type Variants } from 'framer-motion'
import { TrendingUp, Shield, Zap, Globe, Lock } from 'lucide-react'

// Animated candlestick data for the brand panel
const CANDLES = [
  { open: 60, close: 80, high: 85, low: 55 },
  { open: 80, close: 70, high: 88, low: 65 },
  { open: 70, close: 95, high: 100, low: 68 },
  { open: 95, close: 85, high: 102, low: 80 },
  { open: 85, close: 110, high: 115, low: 82 },
  { open: 110, close: 105, high: 120, low: 100 },
  { open: 105, close: 130, high: 135, low: 102 },
  { open: 130, close: 120, high: 138, low: 115 },
  { open: 120, close: 145, high: 150, low: 118 },
]

const CHART_H = 120
const PRICE_MIN = 50
const PRICE_MAX = 160
const scale = (v: number) => ((v - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * CHART_H

const TRUST_BADGES = [
  { icon: Shield, label: 'Bank-grade encryption' },
  { icon: Lock, label: 'SOC 2 compliant' },
  { icon: Globe, label: 'Global market access' },
  { icon: Zap, label: 'Real-time execution' },
]

const STATS = [
  { label: 'Assets Analyzed', value: '12,400+' },
  { label: 'Avg. Accuracy', value: '94.2%' },
  { label: 'Markets Covered', value: '60+' },
]

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  },
}

export function AuthBrandPanel() {
  return (
    <div className="relative hidden lg:flex flex-col justify-between h-full overflow-hidden px-10 py-12">
      {/* Deep layered background */}
      <div className="absolute inset-0 bg-[#060B12]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(0,212,255,0.08)_0%,transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(10,124,255,0.06)_0%,transparent_60%)]" />

      {/* Subtle grid lines */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,212,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,1) 1px,transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Scan line */}
      <motion.div
        className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent"
        initial={{ top: '0%' }}
        animate={{ top: '100%' }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear', repeatDelay: 2 }}
      />

      <motion.div
        className="relative z-10 flex flex-col h-full"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Logo */}
        <motion.div variants={itemVariants} className="flex items-center gap-3 mb-auto">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-[#00D4FF]/10 border border-[#00D4FF]/30 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-[#00D4FF]" />
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#00E5A0] shadow-[0_0_8px_#00E5A0]" />
          </div>
          <div>
            <span className="text-white font-bold text-lg tracking-tight" style={{ fontFamily: 'Syne, sans-serif' }}>
              QuantTrade
            </span>
            <span className="text-[#00D4FF] font-bold text-lg tracking-tight" style={{ fontFamily: 'Syne, sans-serif' }}>
              {' '}AI
            </span>
          </div>
        </motion.div>

        {/* Main headline */}
        <motion.div variants={itemVariants} className="my-8">
          <p className="text-[10px] font-semibold tracking-[3px] text-[#00D4FF]/60 uppercase mb-3">
            Institutional Intelligence
          </p>
          <h1
            className="text-4xl font-bold leading-tight mb-4"
            style={{ fontFamily: 'Syne, sans-serif', color: '#F0F6FF' }}
          >
            Trade Smarter.
            <br />
            <span className="text-[#00D4FF]">Think Faster.</span>
          </h1>
          <p className="text-[#64748B] text-sm leading-relaxed max-w-xs">
            AI-powered market intelligence, real-time analysis, and institutional-grade tools for the modern trader.
          </p>
        </motion.div>

        {/* Live Chart */}
        <motion.div
          variants={itemVariants}
          className="rounded-2xl border border-[#00D4FF]/10 bg-[#08101E]/80 backdrop-blur-sm p-4 mb-8"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] text-[#475569] tracking-widest uppercase">NVDA · LIVE</p>
              <p className="text-xl font-bold text-white" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                $875.48
              </p>
            </div>
            <div className="text-right">
              <p className="text-[#00E5A0] text-sm font-semibold">+4.21%</p>
              <p className="text-[#475569] text-xs">+$35.28 today</p>
            </div>
          </div>

          {/* Animated SVG candlestick chart */}
          <svg width="100%" height={CHART_H} viewBox={`0 0 ${CANDLES.length * 30} ${CHART_H}`} className="overflow-visible">
            {/* Grid lines */}
            {[0.25, 0.5, 0.75].map((p) => (
              <line
                key={p}
                x1="0"
                x2={CANDLES.length * 30}
                y1={CHART_H * (1 - p)}
                y2={CHART_H * (1 - p)}
                stroke="rgba(0,212,255,0.08)"
                strokeWidth="1"
              />
            ))}
            {CANDLES.map((c, i) => {
              const x = i * 30 + 15
              const isGreen = c.close >= c.open
              const color = isGreen ? '#00E5A0' : '#FF4757'
              const bodyTop = CHART_H - scale(Math.max(c.open, c.close))
              const bodyBot = CHART_H - scale(Math.min(c.open, c.close))
              const bodyH = Math.max(bodyBot - bodyTop, 2)
              return (
                <motion.g
                  key={i}
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ delay: i * 0.07, duration: 0.4, ease: 'easeOut' }}
                  style={{ transformOrigin: `${x}px ${CHART_H}px` }}
                >
                  {/* Wick */}
                  <line x1={x} x2={x} y1={CHART_H - scale(c.high)} y2={CHART_H - scale(c.low)} stroke={color} strokeWidth="1.5" opacity="0.6" />
                  {/* Body */}
                  <rect x={x - 6} y={bodyTop} width={12} height={bodyH} fill={color} rx="2" />
                </motion.g>
              )
            })}
          </svg>
        </motion.div>

        {/* Stats row */}
        <motion.div variants={itemVariants} className="grid grid-cols-3 gap-3 mb-8">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-[#1E293B] bg-[#0D1828]/50 p-3 text-center"
            >
              <p className="text-white text-sm font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {s.value}
              </p>
              <p className="text-[#475569] text-[10px] mt-0.5">{s.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Trust badges */}
        <motion.div variants={itemVariants} className="grid grid-cols-2 gap-2">
          {TRUST_BADGES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-lg border border-[#1E293B] bg-[#0D1828]/30 px-3 py-2"
            >
              <Icon className="w-3.5 h-3.5 text-[#00D4FF] shrink-0" />
              <span className="text-[#64748B] text-[11px]">{label}</span>
            </div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  )
}
