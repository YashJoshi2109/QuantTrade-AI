'use client'

import { useState, useEffect, useRef } from 'react'

const AVATARS: string[] = [
  'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/People/Woman%20Technologist.png',
  'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/People/Man%20Student.png',
  'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/People/Man%20Mechanic.png',
  'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/People/Woman%20Student.png',
  'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/People/Woman%20Teacher.png',
  'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/People/Person%20With%20Blond%20Hair.png',
  'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/People/Woman%20Technologist.png',
]

const AVATAR_COLORS: string[] = ['#1e3a5f', '#1a3d2e', '#3d1a35', '#3d2e1a', '#1e293b']

interface DigitPlaceProps {
  place: number
  value: number
}

function DigitPlace({ place, value }: DigitPlaceProps) {
  const [offset, setOffset] = useState<number>(0)
  const targetRef = useRef<number>(0)
  const currentRef = useRef<number>(0)

  useEffect(() => {
    const valueRoundedToPlace = Math.floor(value / place)
    targetRef.current = valueRoundedToPlace % 10

    let animationFrame: number
    const animate = () => {
      const diff = targetRef.current - currentRef.current
      if (Math.abs(diff) > 0.01) {
        currentRef.current += diff * 0.15
        setOffset(currentRef.current)
        animationFrame = requestAnimationFrame(animate)
      } else {
        currentRef.current = targetRef.current
        setOffset(targetRef.current)
      }
    }

    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [value, place])

  if (value < place) return null

  return (
    <div className="relative w-[12px] h-[20px] overflow-hidden">
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
        let digitOffset = (10 + num - offset) % 10
        let translateY = digitOffset * 20
        if (digitOffset > 5) translateY -= 10 * 20

        return (
          <span
            key={num}
            className="absolute left-0 w-full text-center text-[14px] font-bold font-mono leading-[20px] text-white"
            style={{
              transform: `translateY(${translateY}px)`,
              transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {num}
          </span>
        )
      })}
    </div>
  )
}

interface LiveVisitorCounterProps {
  /** Real count from backend (/live-visitors: GA4, Cloudflare GraphQL, or Worker); if null, simulates */
  gaCount?: number | null
}

export default function LiveVisitorCounter({ gaCount }: LiveVisitorCounterProps = {}) {
  const [simulatedCount, setSimulatedCount] = useState<number>(132)

  // Use GA real count if available, otherwise simulate
  const visitorCount = gaCount != null ? gaCount : simulatedCount

  useEffect(() => {
    // Only run simulation if no GA data
    if (gaCount != null) return
    const interval = setInterval(() => {
      setSimulatedCount((prev) => {
        const change = Math.floor(Math.random() * 11) - 5
        return Math.max(95, Math.min(180, prev + change))
      })
    }, 2500)
    return () => clearInterval(interval)
  }, [gaCount])

  const displayLimit = Math.min(
    5,
    Math.max(1, 3 + Math.floor((visitorCount - 100) / 15))
  )
  const visibleAvatars = AVATARS.slice(0, displayLimit)

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06] backdrop-blur-md">
      {/* "Live" label + pulse dot */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold text-slate-300 tracking-wide">Live</span>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      </div>

      {/* Rolling digit counter */}
      <div className="flex items-center gap-[2px]">
        {[100, 10, 1].map((place) => (
          <DigitPlace key={place} place={place} value={visitorCount} />
        ))}
      </div>

      {/* Avatar stack */}
      <div className="flex -space-x-2">
        {visibleAvatars.map((url, index) => (
          <div
            key={index}
            className="w-5 h-5 rounded-full border border-slate-800 overflow-hidden"
            style={{
              zIndex: 10 + index,
              backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length],
              animation: `popInRight 0.4s ease-out ${index * 0.08}s both`,
            }}
          >
            <img
              src={url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
