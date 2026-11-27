/**
 * Unit helpers for the classic backtester (/api/v1/backtest, /backtest/compare).
 *
 * The classic API reports every percentage already in percent units:
 * total_return 286.04 means +286.04%, win_rate 60 means 60%, max_drawdown
 * 31.43 is a 31.43% peak-to-trough fall (a positive magnitude), var_95 -2.22
 * is a -2.22% one-day loss and annualized_volatility 23.4 means 23.4%/yr.
 * Several classic panels treated them as fractions (x100 again), so a +286%
 * return showed as 28604.00% and a 60% win rate fed Kelly as W = 60.
 * Everything that needs a fraction goes through here.
 */

/** Percent units (60 = 60%) -> fraction (0.6). */
export function pctToFraction(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v / 100 : 0
}

/** Format a value that is already in percent units. */
export function fmtPctUnits(v: number | null | undefined, digits = 2, signed = false): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  const s = v.toFixed(digits)
  return `${signed && v > 0 ? '+' : ''}${s}%`
}

/** Max drawdown is a positive magnitude in the classic API; show it as a loss. */
export function fmtDrawdown(v: number | null | undefined, digits = 2): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${v === 0 ? '' : '-'}${Math.abs(v).toFixed(digits)}%`
}

export interface BlendMetrics {
  total_return: number // percent
  cagr: number // percent, trading-day years (bars / 252)
  annualized_volatility: number // percent
  sharpe_ratio: number
  sortino_ratio: number
  max_drawdown: number // percent, positive magnitude
  calmar_ratio: number
  bars: number
}

/**
 * A fixed-weight mix of strategies run on the same symbol and dates,
 * rebalanced to its weights every day: r_p(t) = sum_i w_i r_i(t).
 *
 * Sharpe, drawdown and Calmar of a mix are NOT the weighted averages of the
 * parts (diversification lowers volatility and drawdowns), which is what the
 * classic "Combined" panel used to show. rf = 0, annualised with sqrt(252).
 */
export function blendEquityCurves(curves: number[][], weights: number[], ppy = 252): BlendMetrics | null {
  const used = curves.map((c, i) => ({ c, w: weights[i] ?? 0 })).filter((x) => x.w > 0 && x.c.length > 1)
  if (!used.length) return null
  const totalW = used.reduce((a, x) => a + x.w, 0)
  const n = Math.min(...used.map((x) => x.c.length))
  const rets: number[] = []
  for (let t = 1; t < n; t++) {
    let r = 0
    for (const { c, w } of used) {
      const prev = c[t - 1]
      r += prev > 0 ? (w / totalW) * (c[t] / prev - 1) : 0
    }
    rets.push(r)
  }
  if (rets.length < 2) return null
  let eq = 1
  let peak = 1
  let mdd = 0
  for (const r of rets) {
    eq *= 1 + r
    peak = Math.max(peak, eq)
    mdd = Math.min(mdd, eq / peak - 1)
  }
  const mean = rets.reduce((a, r) => a + r, 0) / rets.length
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1))
  const dd = Math.sqrt(rets.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / rets.length)
  const years = rets.length / ppy
  const cagr = years > 0 && eq > 0 ? eq ** (1 / years) - 1 : 0
  return {
    total_return: (eq - 1) * 100,
    cagr: cagr * 100,
    annualized_volatility: sd * Math.sqrt(ppy) * 100,
    sharpe_ratio: sd > 1e-12 ? (mean / sd) * Math.sqrt(ppy) : 0,
    sortino_ratio: dd > 1e-12 ? (mean / dd) * Math.sqrt(ppy) : 0,
    max_drawdown: Math.abs(mdd) * 100,
    calmar_ratio: mdd < 0 ? cagr / Math.abs(mdd) : 0,
    bars: n,
  }
}
