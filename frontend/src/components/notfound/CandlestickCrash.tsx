'use client'

/**
 * Animated 404 scene: a candlestick chart climbs, crashes into a "404" and
 * recovers. Pure SVG + CSS keyframes (CandlestickCrash.module.css). Under
 * prefers-reduced-motion every animation is off and the final frame shows.
 */
import styles from './CandlestickCrash.module.css'

// Close prices: rally, crash, recovery. Fixed data, so render is deterministic.
const CLOSES = [118, 126, 122, 134, 141, 149, 158, 147, 112, 84, 72, 80, 95, 108, 121]
const CRASH_FROM = 7 // first falling candle
const CRASH_LOW = 10 // the bottom: "404" hangs here
const VIEW_W = 640
const VIEW_H = 280
const X0 = 34
const STEP = 40
const BODY_W = 20
const P_MIN = 60
const P_MAX = 170
const Y_TOP = 26
const Y_BOTTOM = 250

const y = (p: number) => Y_BOTTOM - ((p - P_MIN) / (P_MAX - P_MIN)) * (Y_BOTTOM - Y_TOP)

interface Candle {
  i: number
  x: number
  open: number
  close: number
  high: number
  low: number
  up: boolean
  phase: 'rally' | 'crash' | 'recover'
}

const CANDLES: Candle[] = CLOSES.map((close, i) => {
  const open = i === 0 ? close - 6 : CLOSES[i - 1]
  const spread = 3 + ((i * 7) % 5)
  return {
    i,
    x: X0 + i * STEP,
    open,
    close,
    high: Math.max(open, close) + spread,
    low: Math.min(open, close) - spread,
    up: close >= open,
    phase: i < CRASH_FROM ? 'rally' : i <= CRASH_LOW ? 'crash' : 'recover',
  }
})

const LINE = CANDLES.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x + BODY_W / 2},${y(c.close).toFixed(1)}`).join(' ')
const AREA = `${LINE} L${CANDLES[CANDLES.length - 1].x + BODY_W / 2},${Y_BOTTOM} L${X0 + BODY_W / 2},${Y_BOTTOM} Z`
const LOW = CANDLES[CRASH_LOW]
const LAST = CANDLES[CANDLES.length - 1]

export default function CandlestickCrash({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={`${styles.scene} ${className ?? ''}`}
      role="img"
      aria-label="Candlestick chart that rallies, crashes to 404, then recovers"
    >
      <defs>
        <linearGradient id="nf-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <filter id="nf-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grid */}
      <g className={styles.grid}>
        {[0, 1, 2, 3, 4].map((r) => (
          <line key={r} x1="0" x2={VIEW_W} y1={Y_TOP + r * 56} y2={Y_TOP + r * 56} />
        ))}
      </g>

      {/* Area + price line */}
      <path d={AREA} fill="url(#nf-area)" className={styles.area} />
      <path d={LINE} className={styles.line} pathLength={1} filter="url(#nf-glow)" />

      {/* Candles */}
      {CANDLES.map((c) => {
        const top = y(Math.max(c.open, c.close))
        const bottom = y(Math.min(c.open, c.close))
        return (
          <g
            key={c.i}
            className={`${styles.candle} ${c.up ? styles.up : styles.down} ${styles[c.phase]}`}
            style={{ ['--i' as string]: c.i, transformOrigin: `${c.x + BODY_W / 2}px ${y(c.open)}px` }}
          >
            <line x1={c.x + BODY_W / 2} x2={c.x + BODY_W / 2} y1={y(c.high)} y2={y(c.low)} className={styles.wick} />
            <rect x={c.x} y={top} width={BODY_W} height={Math.max(2, bottom - top)} rx="3" />
          </g>
        )
      })}

      {/* 404 hanging at the crash low */}
      <g className={styles.crashLabel} style={{ transformOrigin: `${LOW.x + BODY_W / 2}px ${y(LOW.low) + 26}px` }}>
        <line
          x1={LOW.x + BODY_W / 2}
          x2={LOW.x + BODY_W / 2}
          y1={y(LOW.low) + 2}
          y2={y(LOW.low) + 12}
          className={styles.leader}
        />
        <rect x={LOW.x + BODY_W / 2 - 34} y={y(LOW.low) + 12} width="68" height="24" rx="12" className={styles.badge} />
        <text x={LOW.x + BODY_W / 2} y={y(LOW.low) + 28.5} textAnchor="middle" className={styles.badgeText}>
          −404
        </text>
      </g>

      {/* Live dot on the recovered close */}
      <g className={styles.dotWrap}>
        <circle cx={LAST.x + BODY_W / 2} cy={y(LAST.close)} r="10" className={styles.dotPulse} />
        <circle cx={LAST.x + BODY_W / 2} cy={y(LAST.close)} r="4.5" className={styles.dot} />
      </g>
    </svg>
  )
}
