import type { PriceBar } from '@/lib/stockPage/types'

/** Server-rendered 1-year close line (inline SVG, no client JS). */
export function sparklinePath(closes: number[], width: number, height: number, pad = 4): string {
  if (closes.length < 2) return ''
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const span = max - min || 1
  const stepX = (width - pad * 2) / (closes.length - 1)
  return closes
    .map((c, i) => {
      const x = pad + i * stepX
      const y = pad + (1 - (c - min) / span) * (height - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export default function PriceSparkline({ bars, symbol }: { bars: PriceBar[]; symbol: string }) {
  const closes = bars.map((b) => b.close)
  if (closes.length < 20) return null
  const W = 800
  const H = 160
  const d = sparklinePath(closes, W, H)
  const up = closes[closes.length - 1] >= closes[0]
  const first = bars[0].timestamp.slice(0, 10)
  const last = bars[bars.length - 1].timestamp.slice(0, 10)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={`h-32 w-full md:h-40 ${up ? 'text-emerald-500' : 'text-rose-500'}`}
        role="img"
        aria-label={`${symbol} daily closing price from ${first} to ${last}, low ${min.toFixed(2)}, high ${max.toFixed(2)}`}
      >
        <path d={`${d} L${W - 4},${H - 4} L4,${H - 4} Z`} fill="currentColor" opacity="0.08" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-fg-muted tabular-nums">
        <span>{first}</span>
        <span>
          Low ${min.toFixed(2)} · High ${max.toFixed(2)} (daily closes)
        </span>
        <span>{last}</span>
      </figcaption>
    </figure>
  )
}
