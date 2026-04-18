'use client'

import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

export interface WeatherIconProps {
  size?: number
  className?: string
}

/* ─── SUN ─── */
export function SunIcon({ size = 48, className }: WeatherIconProps) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
  return (
    <motion.svg
      viewBox="0 0 48 48"
      fill="none"
      className={cn(className)}
      style={{ width: size, height: size }}
    >
      <motion.g
        style={{ transformOrigin: '24px 24px' }}
        animate={{ rotate: 360 }}
        transition={{ duration: 48, ease: 'linear', repeat: Infinity }}
      >
        {rays.map((deg) => (
          <g key={deg} transform={`rotate(${deg} 24 24)`}>
            <line x1="24" y1="6" x2="24" y2="10" stroke="#FBBF24" strokeWidth={2} strokeLinecap="round" />
          </g>
        ))}
      </motion.g>
      <motion.circle
        cx="24"
        cy="24"
        r="8"
        fill="#FBBF24"
        fillOpacity={0.2}
        stroke="#FBBF24"
        strokeWidth={2}
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.svg>
  )
}

/* ─── MOON ─── */
export function MoonIcon({ size = 48, className }: WeatherIconProps) {
  const stars = [
    { cx: 34, cy: 10, d: 0 },
    { cx: 38, cy: 18, d: 0.5 },
    { cx: 30, cy: 6, d: 1 },
    { cx: 40, cy: 12, d: 1.5 },
  ]
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      <path d="M28 8a14 14 0 100 28 10 10 0 01 0-28z" fill="#A78BFA" fillOpacity={0.15} />
      <path
        d="M28 8a14 14 0 100 28 10 10 0 01 0-28z"
        stroke="#A78BFA"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {stars.map((s) => (
        <motion.circle
          key={`${s.cx}-${s.cy}`}
          cx={s.cx}
          cy={s.cy}
          r={1}
          fill="#A78BFA"
          animate={{ opacity: [0.25, 1, 0.25], scale: [0.85, 1.15, 0.85] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: s.d }}
        />
      ))}
    </svg>
  )
}

/* ─── CLOUD ─── */
export function CloudIcon({ size = 48, className }: WeatherIconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      <motion.g
        animate={{ x: [0, 1.5, 0, -1.5, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path
          d="M36 30H14a8 8 0 01-.5-16A10 10 0 0134 16a7 7 0 012 14z"
          fill="#94A3B8"
          fillOpacity={0.12}
        />
        <path
          d="M36 30H14a8 8 0 01-.5-16A10 10 0 0134 16a7 7 0 012 14z"
          stroke="#94A3B8"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </motion.g>
    </svg>
  )
}

/* ─── RAIN ─── */
export function RainIcon({ size = 48, className }: WeatherIconProps) {
  const drops = [
    { x: 16, d: 0 },
    { x: 22, d: 0.25 },
    { x: 28, d: 0.5 },
    { x: 34, d: 0.12 },
  ]
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      <path d="M36 22H14a7 7 0 01-.5-14A9 9 0 0134 10a6 6 0 012 12z" fill="#60A5FA" fillOpacity={0.1} />
      <path
        d="M36 22H14a7 7 0 01-.5-14A9 9 0 0134 10a6 6 0 012 12z"
        stroke="#60A5FA"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {drops.map((drop) => (
        <motion.g
          key={drop.x}
          animate={{ y: [0, 10] }}
          transition={{ duration: 0.75, repeat: Infinity, delay: drop.d, ease: 'easeIn' }}
        >
          <line
            x1={drop.x}
            y1="26"
            x2={drop.x}
            y2="31"
            stroke="#60A5FA"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </motion.g>
      ))}
    </svg>
  )
}

/* ─── HEAVY RAIN ─── */
export function HeavyRainIcon({ size = 48, className }: WeatherIconProps) {
  const drops = [
    { x: 14, d: 0 },
    { x: 19, d: 0.12 },
    { x: 24, d: 0.24 },
    { x: 29, d: 0.08 },
    { x: 34, d: 0.36 },
  ]
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      <path d="M36 20H14a7 7 0 01-.5-14A9 9 0 0134 8a6 6 0 012 12z" fill="#3B82F6" fillOpacity={0.1} />
      <path
        d="M36 20H14a7 7 0 01-.5-14A9 9 0 0134 8a6 6 0 012 12z"
        stroke="#3B82F6"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {drops.map((drop) => (
        <motion.g
          key={drop.x}
          animate={{ y: [0, 14], x: [0, -1] }}
          transition={{ duration: 0.55, repeat: Infinity, delay: drop.d, ease: 'easeIn' }}
        >
          <line
            x1={drop.x}
            y1="24"
            x2={drop.x - 1}
            y2="32"
            stroke="#3B82F6"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </motion.g>
      ))}
    </svg>
  )
}

/* ─── SNOW ─── */
export function SnowIcon({ size = 48, className }: WeatherIconProps) {
  const flakes = [
    { x: 16, d: 0, o: 1 },
    { x: 22, d: 0.4, o: -1 },
    { x: 28, d: 0.15, o: 1 },
    { x: 34, d: 0.55, o: -1 },
  ]
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      <path d="M36 22H14a7 7 0 01-.5-14A9 9 0 0134 10a6 6 0 012 12z" fill="#CBD5E1" fillOpacity={0.14} />
      <path
        d="M36 22H14a7 7 0 01-.5-14A9 9 0 0134 10a6 6 0 012 12z"
        stroke="#CBD5E1"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {flakes.map((f, i) => (
        <motion.circle
          key={i}
          cx={f.x}
          cy={26}
          r={1.5}
          fill="#E2E8F0"
          animate={{ y: [0, 12], x: [0, f.o * 3, 0], opacity: [0.85, 0.2] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: f.d, ease: 'easeIn' }}
        />
      ))}
    </svg>
  )
}

/* ─── THUNDER ─── */
export function ThunderIcon({ size = 48, className }: WeatherIconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      <path d="M36 20H14a7 7 0 01-.5-14A9 9 0 0134 8a6 6 0 012 12z" fill="#F59E0B" fillOpacity={0.08} />
      <path
        d="M36 20H14a7 7 0 01-.5-14A9 9 0 0134 8a6 6 0 012 12z"
        stroke="#94A3B8"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <motion.path
        d="M26 20l-3 8h6l-3 10"
        stroke="#FBBF24"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        animate={{ opacity: [0.2, 1, 1, 0.25, 0.2] }}
        transition={{ duration: 2.4, repeat: Infinity }}
      />
    </svg>
  )
}

/* ─── WIND ─── */
export function WindIcon({ size = 48, className }: WeatherIconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      <motion.path
        d="M6 18h26a4 4 0 000-8"
        stroke="#94A3B8"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
        animate={{ opacity: [0.45, 1, 0.45] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.path
        d="M6 26h30a3 3 0 010 6"
        stroke="#94A3B8"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
        animate={{ opacity: [0.35, 0.95, 0.35] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
      />
      <motion.path
        d="M8 32h20"
        stroke="#64748B"
        strokeWidth={2}
        strokeLinecap="round"
        animate={{ opacity: [0.3, 0.85, 0.3] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.45 }}
      />
    </svg>
  )
}

/* ─── FOG ─── */
export function FogIcon({ size = 48, className }: WeatherIconProps) {
  const lines = [
    { y: 18, w: 26, d: 0 },
    { y: 24, w: 32, d: 0.4 },
    { y: 30, w: 22, d: 0.9 },
  ]
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      {lines.map((l) => (
        <motion.line
          key={l.y}
          x1={24 - l.w / 2}
          y1={l.y}
          x2={24 + l.w / 2}
          y2={l.y}
          stroke="#94A3B8"
          strokeWidth={2.5}
          strokeLinecap="round"
          animate={{ opacity: [0.25, 0.65, 0.25] }}
          transition={{ duration: 3.2, repeat: Infinity, delay: l.d, ease: 'easeInOut' }}
        />
      ))}
    </svg>
  )
}

/* ─── PARTLY CLOUDY ─── */
export function PartlyCloudyIcon({ size = 48, className }: WeatherIconProps) {
  const rays = [0, 60, 120, 180, 240, 300]
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      <motion.g
        style={{ transformOrigin: '16px 16px' }}
        animate={{ rotate: 360 }}
        transition={{ duration: 56, ease: 'linear', repeat: Infinity }}
      >
        {rays.map((deg) => (
          <g key={deg} transform={`rotate(${deg} 16 16)`}>
            <line x1="16" y1="5" x2="16" y2="8" stroke="#FBBF24" strokeWidth={1.5} strokeLinecap="round" />
          </g>
        ))}
      </motion.g>
      <circle cx="16" cy="16" r="6" stroke="#FBBF24" strokeWidth={1.5} fill="#FBBF24" fillOpacity={0.12} />
      <motion.g animate={{ x: [0, 1.2, 0, -1.2, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}>
        <path
          d="M38 34H18a7 7 0 01-.5-14A9 9 0 0136 22a6 6 0 012 12z"
          fill="#94A3B8"
          fillOpacity={0.12}
        />
        <path
          d="M38 34H18a7 7 0 01-.5-14A9 9 0 0136 22a6 6 0 012 12z"
          stroke="#94A3B8"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </motion.g>
    </svg>
  )
}

/* ─── SUNRISE ─── */
export function SunriseIcon({ size = 48, className }: WeatherIconProps) {
  const rays = [0, 30, 60, 90, 120, 150, 180]
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn(className)} style={{ width: size, height: size }}>
      <line x1="6" y1="34" x2="42" y2="34" stroke="#64748B" strokeWidth={2} strokeLinecap="round" />
      <motion.g animate={{ y: [1, -0.5, 1] }} transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}>
        <path d="M12 34a12 12 0 0124 0" fill="#FBBF24" fillOpacity={0.14} />
        <path d="M12 34a12 12 0 0124 0" stroke="#FBBF24" strokeWidth={2} strokeLinecap="round" />
        {rays.map((deg) => (
          <g key={deg} transform={`rotate(${deg - 90} 24 34)`}>
            <line x1="24" y1="14" x2="24" y2="17" stroke="#FBBF24" strokeWidth={1.5} strokeLinecap="round" />
          </g>
        ))}
      </motion.g>
      <motion.path
        d="M18 36h12"
        stroke="#FBBF24"
        strokeWidth={2}
        strokeLinecap="round"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </svg>
  )
}
