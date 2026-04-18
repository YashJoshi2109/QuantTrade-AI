'use client'

import type { ComponentType } from 'react'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { WeatherIconProps } from '@/components/ui/animated-weather-icons'
import {
  SunIcon,
  MoonIcon,
  SunriseIcon,
  PartlyCloudyIcon,
  CloudIcon,
  RainIcon,
  HeavyRainIcon,
  SnowIcon,
  ThunderIcon,
  FogIcon,
  WindIcon,
} from '@/components/ui/animated-weather-icons'

type Period = 'night' | 'morning' | 'afternoon' | 'evening'

function getLocalHour(d = new Date()): number {
  return d.getHours()
}

function getPeriod(h: number): Period {
  if (h >= 22 || h < 5) return 'night'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function periodLabel(p: Period): string {
  switch (p) {
    case 'night':
      return 'Night'
    case 'morning':
      return 'Morning'
    case 'afternoon':
      return 'Afternoon'
    default:
      return 'Evening'
  }
}

/** WMO weather code (Open-Meteo current). Returns icon + short label. */
function iconFromWeatherCode(
  code: number | null,
  period: Period
): { Icon: ComponentType<WeatherIconProps>; weather: string } {
  if (code == null) {
    if (period === 'night') return { Icon: MoonIcon, weather: 'Local sky' }
    if (period === 'morning') return { Icon: SunriseIcon, weather: 'Local sky' }
    if (period === 'evening') return { Icon: PartlyCloudyIcon, weather: 'Local sky' }
    return { Icon: SunIcon, weather: 'Local sky' }
  }

  // Thunderstorm
  if (code >= 95) return { Icon: ThunderIcon, weather: 'Stormy' }
  // Snow
  if (code >= 71 && code <= 77) return { Icon: SnowIcon, weather: 'Snow' }
  // Rain / showers
  if (code >= 80 && code <= 82) return { Icon: HeavyRainIcon, weather: 'Showers' }
  if (code === 85 || code === 86) return { Icon: HeavyRainIcon, weather: 'Rain showers' }
  if (code >= 61 && code <= 67) return { Icon: RainIcon, weather: 'Rain' }
  if (code >= 51 && code <= 57) return { Icon: RainIcon, weather: 'Drizzle' }
  // Fog
  if (code === 45 || code === 48) return { Icon: FogIcon, weather: 'Fog' }
  // Wind-heavy codes (rough proxy)
  if (code === 56 || code === 57) return { Icon: WindIcon, weather: 'Freezing drizzle' }
  // Cloud cover
  if (code === 3) return { Icon: CloudIcon, weather: 'Overcast' }
  if (code === 2) return { Icon: PartlyCloudyIcon, weather: 'Partly cloudy' }
  if (code === 1) return { Icon: PartlyCloudyIcon, weather: 'Mainly clear' }
  // 0 clear
  if (period === 'night') return { Icon: MoonIcon, weather: 'Clear' }
  if (period === 'morning') return { Icon: SunriseIcon, weather: 'Clear' }
  if (period === 'evening') return { Icon: PartlyCloudyIcon, weather: 'Clear' }
  return { Icon: SunIcon, weather: 'Clear' }
}

async function fetchCurrentWeatherCode(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords
          const url = new URL('https://api.open-meteo.com/v1/forecast')
          url.searchParams.set('latitude', String(latitude))
          url.searchParams.set('longitude', String(longitude))
          url.searchParams.set('current', 'weather_code')
          const r = await fetch(url.toString())
          if (!r.ok) {
            resolve(null)
            return
          }
          const j = (await r.json()) as { current?: { weather_code?: number } }
          resolve(j.current?.weather_code ?? null)
        } catch {
          resolve(null)
        }
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 900_000 }
    )
  })
}

export default function TimeWeatherMoodToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [tick, setTick] = useState(0)
  const [weatherCode, setWeatherCode] = useState<number | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchCurrentWeatherCode().then((c) => {
      if (!cancelled) setWeatherCode(c)
    })
    const refresh = setInterval(() => {
      void fetchCurrentWeatherCode().then((c) => {
        if (!cancelled) setWeatherCode(c)
      })
    }, 30 * 60_000)
    return () => {
      cancelled = true
      clearInterval(refresh)
    }
  }, [])

  const period = useMemo(() => getPeriod(getLocalHour()), [tick])
  const { Icon, weather } = useMemo(
    () => iconFromWeatherCode(weatherCode, period),
    [weatherCode, period]
  )

  const isDark = theme === 'dark'
  const nextTheme = isDark ? 'light' : 'dark'

  const title = useMemo(() => {
    const w = weatherCode == null ? 'location optional' : weather
    return `${periodLabel(period)} · ${w} · Tap for ${nextTheme} mode`
  }, [period, weather, weatherCode, nextTheme])

  const onToggle = useCallback(() => {
    setTheme(nextTheme)
  }, [setTheme, nextTheme])

  if (!mounted) {
    return (
      <div
        className={cn(
          'h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-slate-900/50 animate-pulse',
          className
        )}
        aria-hidden
      />
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border transition-colors',
        'border-white/[0.1] bg-[rgba(10,14,26,0.75)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
        'hover:border-cyan-400/30 hover:bg-[rgba(0,122,255,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
        className
      )}
    >
      <span
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-violet-500/10"
        aria-hidden
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={`${period}-${weatherCode ?? 'na'}`}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.22 }}
          className="relative z-10 flex items-center justify-center"
        >
          <Icon size={26} className="drop-shadow-[0_0_8px_rgba(34,211,238,0.15)]" />
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
