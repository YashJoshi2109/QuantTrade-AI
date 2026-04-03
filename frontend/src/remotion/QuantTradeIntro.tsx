import React from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

export const INTRO_FPS = 30
/** ~4s — enough for chart draw + climb without feeling long */
export const INTRO_DURATION_FRAMES = 120

const CANDLES = 14
const CHART_POINTS = [
  { x: 120, y: 720 },
  { x: 280, y: 640 },
  { x: 420, y: 680 },
  { x: 560, y: 520 },
  { x: 700, y: 560 },
  { x: 840, y: 400 },
  { x: 980, y: 440 },
  { x: 1120, y: 320 },
  { x: 1260, y: 360 },
  { x: 1400, y: 240 },
  { x: 1540, y: 280 },
  { x: 1680, y: 180 },
  { x: 1820, y: 200 },
] as const

function buildPath(digits: readonly { readonly x: number; readonly y: number }[]): string {
  if (digits.length === 0) return ''
  let d = `M ${digits[0].x} ${digits[0].y}`
  for (let i = 1; i < digits.length; i++) {
    d += ` L ${digits[i].x} ${digits[i].y}`
  }
  return d
}

const LINE_PATH = buildPath(CHART_POINTS)
const BASELINE_Y = 820

export const QuantTradeIntro: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()

  const entrance = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 120 },
  })

  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' })
  const taglineOpacity = interpolate(frame, [24, 44], [0, 1], { extrapolateRight: 'clamp' })
  const rallyOpacity = interpolate(frame, [50, 72], [0, 1], { extrapolateRight: 'clamp' })
  const scale = 0.92 + entrance * 0.08

  const gridScroll = -((frame * 4) % 48)
  const climbShift = interpolate(frame, [0, 90], [28, 0], { extrapolateRight: 'clamp' })

  const lineProgress = spring({
    frame: frame - 6,
    fps,
    config: { damping: 22, stiffness: 90 },
  })

  const candles: React.ReactNode[] = []
  const slotW = (width - 200) / CANDLES
  const originX = 100
  for (let i = 0; i < CANDLES; i++) {
    const cx = originX + i * slotW + slotW * 0.35
    const targetH = 80 + (i / (CANDLES - 1)) * 220 + (i % 3) * 18
    const grow = spring({
      frame: frame - 10 - i * 3,
      fps,
      config: { damping: 14, stiffness: 100 },
    })
    const h = Math.max(8, targetH * Math.min(1, grow))
    const openish = h * 0.35
    const bull = i % 5 !== 2
    const bodyTop = BASELINE_Y - h
    const wickTop = bodyTop - 14 - (i % 4) * 4
    const color = bull ? 'rgba(52, 211, 153, 0.95)' : 'rgba(248, 113, 113, 0.9)'
    const wickColor = bull ? 'rgba(167, 243, 208, 0.85)' : 'rgba(254, 202, 202, 0.75)'

    candles.push(
      <g key={i} transform={`translate(0, ${climbShift * (0.15 + i * 0.02)})`}>
        <line
          x1={cx + 10}
          y1={wickTop}
          x2={cx + 10}
          y2={BASELINE_Y + 6}
          stroke={wickColor}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <rect
          x={cx + 3}
          y={bodyTop + openish}
          width={14}
          height={Math.max(10, h - openish)}
          rx={2}
          fill={color}
          opacity={0.92}
        />
        <rect
          x={cx + 3}
          y={bodyTop}
          width={14}
          height={openish}
          rx={2}
          fill={bull ? 'rgba(16, 185, 129, 0.65)' : 'rgba(239, 68, 68, 0.55)'}
        />
      </g>,
    )
  }

  const estimatedLen = 3200
  const dashOffset = interpolate(lineProgress, [0, 1], [estimatedLen, 0])

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(168deg, #020617 0%, #0b1220 38%, #0f172a 100%)',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 90% 70% at 50% 110%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)',
        }}
      />

      <AbsoluteFill
        style={{
          opacity: 0.35,
          backgroundImage: `
            linear-gradient(rgba(51, 65, 85, 0.35) 1px, transparent 1px),
            linear-gradient(90deg, rgba(51, 65, 85, 0.22) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          backgroundPosition: `0 ${gridScroll}px`,
        }}
      />

      <AbsoluteFill style={{ transform: `translateY(${climbShift}px)` }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', bottom: 0, left: 0 }}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(34, 211, 238, 0.45)" />
              <stop offset="100%" stopColor="rgba(34, 211, 238, 0)" />
            </linearGradient>
            <linearGradient id="lineGrad" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="55%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          <path
            d={`${LINE_PATH} L ${CHART_POINTS[CHART_POINTS.length - 1].x} ${BASELINE_Y} L ${CHART_POINTS[0].x} ${BASELINE_Y} Z`}
            fill="url(#areaGrad)"
            opacity={0.55}
          />
          <path
            d={LINE_PATH}
            fill="none"
            stroke="url(#lineGrad)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={estimatedLen}
            strokeDashoffset={dashOffset}
            filter="drop-shadow(0 0 12px rgba(34, 211, 238, 0.45))"
          />
          <line
            x1={80}
            y1={BASELINE_Y}
            x2={width - 80}
            y2={BASELINE_Y}
            stroke="rgba(148, 163, 184, 0.35)"
            strokeWidth={2}
          />
          {candles}
        </svg>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            opacity,
            transform: `scale(${scale})`,
            textAlign: 'center',
            padding: 'clamp(20px, 3vw, 48px)',
            maxWidth: 980,
          }}
        >
          <div
            style={{
              fontSize: 'clamp(38px, 5.5vw, 72px)',
              fontWeight: 800,
              letterSpacing: '-0.04em',
              lineHeight: 1.05,
              background: 'linear-gradient(100deg, #22d3ee 0%, #4ade80 42%, #818cf8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 0 28px rgba(52, 211, 153, 0.35))',
            }}
          >
            QuantTrade AI
          </div>
          <div
            style={{
              marginTop: 'clamp(12px, 2vw, 22px)',
              fontSize: 'clamp(16px, 2.1vw, 26px)',
              fontWeight: 600,
              color: '#cbd5e1',
              opacity: taglineOpacity,
              letterSpacing: '0.02em',
            }}
          >
            AI-Powered Stock Research
          </div>
          <div
            style={{
              marginTop: 'clamp(18px, 2.5vw, 30px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontSize: 'clamp(15px, 1.8vw, 22px)',
                fontWeight: 700,
                color: '#4ade80',
                letterSpacing: '0.06em',
                textTransform: 'uppercase' as const,
                opacity: rallyOpacity,
                textShadow: '0 0 24px rgba(74, 222, 128, 0.45)',
              }}
            >
              Markets climbing
            </div>
            <div
              style={{
                fontSize: 'clamp(22px, 3vw, 34px)',
                fontWeight: 800,
                color: '#f8fafc',
                opacity: rallyOpacity,
                fontVariantNumeric: 'tabular-nums' as const,
              }}
            >
              +2.48%
            </div>
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(2, 6, 23, 0.65) 0%, transparent 22%, transparent 78%, rgba(2, 6, 23, 0.75) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  )
}
