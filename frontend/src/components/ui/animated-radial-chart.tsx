"use client"

import { motion, useMotionValue, useTransform, animate } from "framer-motion"
import { useEffect, useId } from "react"
import { cn } from "@/lib/utils"

interface AnimatedRadialChartProps {
  /** 0–100 progress value */
  value?: number
  size?: number
  strokeWidth?: number
  className?: string
  showLabels?: boolean
  duration?: number
  /** Two-stop gradient for the progress arc [start, end] */
  gradientColors?: [string, string]
  /** Color for the center value text */
  valueColor?: string
  /** Text shown inside the arc instead of percentage */
  centerLabel?: string
  /** Small label below the value */
  bottomLabel?: string
}

export function AnimatedRadialChart({
  value = 74,
  size = 300,
  strokeWidth: customStrokeWidth,
  className,
  showLabels = true,
  duration = 2,
  gradientColors = ["#f97316", "#dc2626"],
  valueColor,
  centerLabel,
  bottomLabel,
}: AnimatedRadialChartProps) {
  const uid = useId().replace(/:/g, "")
  const strokeWidth = customStrokeWidth ?? Math.max(12, size * 0.06)
  const radius = size * 0.35
  const center = size / 2
  const circumference = Math.PI * radius

  const innerLineRadius = radius - strokeWidth - 4

  const animatedValue = useMotionValue(0)
  const offset = useTransform(animatedValue, [0, 100], [circumference, 0])

  const progressAngle = useTransform(animatedValue, [0, 100], [-Math.PI, 0])
  const innerRadius = radius - strokeWidth / 2

  useEffect(() => {
    const controls = animate(animatedValue, value, {
      duration,
      ease: "easeOut",
    })
    return controls.stop
  }, [value, animatedValue, duration])

  const fontSize = Math.max(16, size * 0.1)
  const labelFontSize = Math.max(10, size * 0.035)

  const textColor = valueColor ?? gradientColors[1]

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size * 0.7 }}>
      <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`} className="overflow-visible">
        <defs>
          <linearGradient id={`baseGrad-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#475569" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#1e293b" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id={`progGrad-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={gradientColors[0]} />
            <stop offset="100%" stopColor={gradientColors[1]} />
          </linearGradient>
          <linearGradient id={`textGrad-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.7" />
            <stop offset="50%" stopColor="#d1d5db" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#6b7280" stopOpacity="0.3" />
          </linearGradient>
          <filter id={`shadow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000000" floodOpacity="0.4" />
          </filter>
          <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Inner thin reference arc */}
        <path
          d={`M ${center - innerLineRadius} ${center} A ${innerLineRadius} ${innerLineRadius} 0 0 1 ${center + innerLineRadius} ${center}`}
          fill="none"
          stroke="#475569"
          strokeWidth="0.5"
          opacity="0.4"
        />

        {/* Background track */}
        <path
          d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
          fill="none"
          stroke={`url(#baseGrad-${uid})`}
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
          filter={`url(#shadow-${uid})`}
        />

        {/* Animated progress arc */}
        <motion.path
          d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
          fill="none"
          stroke={`url(#progGrad-${uid})`}
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          filter={`url(#glow-${uid})`}
        />

        {/* Progress tip marker line */}
        <motion.line
          x1={useTransform(progressAngle, (a) => center + Math.cos(a) * innerRadius)}
          y1={useTransform(progressAngle, (a) => center + Math.sin(a) * innerRadius)}
          x2={useTransform(progressAngle, (a) => center + Math.cos(a) * innerRadius - Math.cos(a) * (size * 0.08))}
          y2={useTransform(progressAngle, (a) => center + Math.sin(a) * innerRadius - Math.sin(a) * (size * 0.08))}
          stroke={`url(#textGrad-${uid})`}
          strokeWidth="1"
          strokeLinecap="butt"
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          className="flex flex-col items-center"
          style={{ marginTop: size * 0.14 }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: duration * 0.75 }}
        >
          {centerLabel ? (
            <span
              className="font-extrabold tracking-tight"
              style={{ fontSize: `${fontSize}px`, color: textColor, textShadow: `0 0 20px ${textColor}33` }}
            >
              {centerLabel}
            </span>
          ) : (
            <span className="font-bold tracking-tight" style={{ fontSize: `${fontSize}px` }}>
              <span style={{ background: `linear-gradient(to right, #ffffff, ${textColor})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                <motion.span>{useTransform(animatedValue, (v) => Math.round(v))}</motion.span>%
              </span>
            </span>
          )}
          {bottomLabel && (
            <span className="text-fg-muted font-mono font-bold uppercase tracking-wider" style={{ fontSize: `${labelFontSize}px` }}>
              {bottomLabel}
            </span>
          )}
        </motion.div>
      </div>

      {/* 0% / 100% end labels */}
      {showLabels && (
        <>
          <motion.div
            className="absolute text-fg-muted font-mono font-medium"
            style={{ fontSize: `${labelFontSize}px`, left: center - radius - 5, top: center + strokeWidth / 2 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: duration * 0.25 }}
          >
            0%
          </motion.div>
          <motion.div
            className="absolute text-fg-muted font-mono font-medium"
            style={{ fontSize: `${labelFontSize}px`, left: center + radius - (labelFontSize * 2.2), top: center + strokeWidth / 2 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: duration * 0.25 }}
          >
            100%
          </motion.div>
        </>
      )}
    </div>
  )
}
