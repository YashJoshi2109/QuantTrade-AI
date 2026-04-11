import React, { useMemo } from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

export const AUTH_TICKER_SPARK_FPS = 30
/** One loop: draw in, breathe, repeat */
export const AUTH_TICKER_SPARK_DURATION = 120

export type AuthTickerSparkProps = {
  closes: number[]
  positive: boolean
}

function buildPoints(
  closes: number[],
  width: number,
  height: number,
): { x: number; y: number }[] {
  const padX = 6
  const padY = 10
  const data = closes.length >= 2 ? closes : [1, 1]
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const innerW = width - padX * 2
  const innerH = height - padY * 2
  return data.map((c, i) => ({
    x: padX + (i / (data.length - 1)) * innerW,
    y: padY + (1 - (c - min) / range) * innerH,
  }))
}

function pathFromPoints(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x} ${pts[i].y}`
  }
  return d
}

export const AuthTickerSpark: React.FC<AuthTickerSparkProps> = ({ closes, positive }) => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()

  const points = useMemo(() => buildPoints(closes, width, height), [closes, width, height])
  const linePath = useMemo(() => pathFromPoints(points), [points])
  const last = points[points.length - 1]
  const first = points[0]

  const areaPath = useMemo(() => {
    if (!linePath || !last || !first) return ''
    return `${linePath} L ${last.x} ${height - 2} L ${first.x} ${height - 2} Z`
  }, [linePath, last, first, height])

  const draw = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 95 },
  })

  const estimatedLen = 1200
  const dashOffset = interpolate(draw, [0, 1], [estimatedLen, 0])

  const breathe = interpolate(
    Math.sin((frame / fps) * Math.PI * 2 * 0.35),
    [-1, 1],
    [0.92, 1],
  )

  const tailGlow = interpolate(frame % 90, [0, 20, 50, 90], [0.35, 1, 0.55, 0.35], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const lineColor = positive ? '#00E5A0' : '#FF6B7A'
  const fillTop = positive ? 'rgba(0, 229, 160, 0.35)' : 'rgba(255, 107, 122, 0.28)'
  const fillBot = positive ? 'rgba(0, 229, 160, 0)' : 'rgba(255, 107, 122, 0)'

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
        <defs>
          <linearGradient id="authSparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillTop} />
            <stop offset="100%" stopColor={fillBot} />
          </linearGradient>
          <filter id="authSparkGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {areaPath ? (
          <path
            d={areaPath}
            fill="url(#authSparkFill)"
            opacity={0.55 * breathe}
          />
        ) : null}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={estimatedLen}
            strokeDashoffset={dashOffset}
            filter="url(#authSparkGlow)"
            opacity={0.95}
          />
        ) : null}
        {last ? (
          <circle
            cx={last.x}
            cy={last.y}
            r={4}
            fill={lineColor}
            opacity={0.15 + 0.55 * tailGlow}
          />
        ) : null}
        {last ? (
          <circle
            cx={last.x}
            cy={last.y}
            r={2}
            fill="#F0F6FF"
            opacity={0.85 * breathe}
          />
        ) : null}
      </svg>
    </AbsoluteFill>
  )
}
