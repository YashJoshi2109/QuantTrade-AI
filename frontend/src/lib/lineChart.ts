/**
 * Geometry for the small SVG line charts (portfolio equity curve vs SPY,
 * /compare normalised performance). Pure functions so desktop and mobile draw
 * the same thing and vitest can check the math.
 *
 * Values are plain numbers (usually % return); `null` is a gap: the line breaks
 * instead of inventing a point.
 */

export interface ChartSeries {
  key: string
  label: string
  values: (number | null)[]
  /** CSS colour (hex or var()) for the stroke and legend swatch. */
  color: string
  dashed?: boolean
}

/** Min/max over all finite values, padded 8%, always containing 0. */
export function valueDomain(series: { values: (number | null)[] }[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const s of series) {
    for (const v of s.values) {
      if (v == null || !Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!Number.isFinite(lo)) return [-1, 1]
  lo = Math.min(lo, 0)
  hi = Math.max(hi, 0)
  if (hi - lo < 1e-9) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.08
  return [lo - pad, hi + pad]
}

/** Up to `count` round tick values inside [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo
  if (!(span > 0) || !Number.isFinite(span)) return []
  const raw = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    out.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toFixed(10)))
  }
  return out
}

export function scaleLinear(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  return (v: number) => r0 + (v - d0) * k
}

/** SVG path for one series; a null value ends the current segment. */
export function linePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  })
  return d
}

/** Index of the point nearest to pixel `px` for `n` evenly spaced points. */
export function nearestIndex(px: number, left: number, width: number, n: number): number {
  if (n <= 1 || width <= 0) return 0
  const t = (px - left) / width
  return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))
}

/** Last finite value in a series (null when there is none). */
export function lastValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (v != null && Number.isFinite(v)) return v
  }
  return null
}

/**
 * Rebase each series to % change from its first finite value on or after the
 * common start. Used by /compare to normalise raw closes.
 */
export function normalisePct(values: (number | null)[]): (number | null)[] {
  let base: number | null = null
  return values.map((v) => {
    if (v == null || !Number.isFinite(v) || v <= 0) return null
    if (base == null) base = v
    return (v / base - 1) * 100
  })
}

/** A few evenly spaced x-axis labels (first and last always included). */
export function xTickIndexes(n: number, max = 5): number[] {
  if (n <= 0) return []
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const out = new Set<number>()
  for (let k = 0; k < max; k++) out.add(Math.round((k * (n - 1)) / (max - 1)))
  return Array.from(out).sort((a, b) => a - b)
}

export function fmtAxisDate(iso: string, spanDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return spanDays > 400
    ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
