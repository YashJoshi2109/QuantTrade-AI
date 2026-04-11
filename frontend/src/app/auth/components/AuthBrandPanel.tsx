'use client'

import { motion, type Variants } from 'framer-motion'
import { TrendingUp, Shield, Zap, Globe, Lock } from 'lucide-react'
import { AuthLiveTickerCard } from './AuthLiveTickerCard'

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
    <div className="relative hidden lg:flex flex-col w-full h-full min-h-0 overflow-y-auto overflow-x-hidden px-10 py-8 lg:py-10">
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
        className="relative z-10 flex flex-col flex-1 min-h-0"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Logo — avoid mb-auto (creates a huge dead zone on tall viewports) */}
        <motion.div variants={itemVariants} className="flex items-center gap-3 mb-5 shrink-0">
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
        <motion.div variants={itemVariants} className="mb-5 shrink-0">
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

        <motion.div variants={itemVariants}>
          <AuthLiveTickerCard />
        </motion.div>

        {/* Stats row */}
        <motion.div variants={itemVariants} className="grid grid-cols-3 gap-3 mb-3 shrink-0">
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
        <motion.div variants={itemVariants} className="grid grid-cols-2 gap-2 shrink-0 pb-1">
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
