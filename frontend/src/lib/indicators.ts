/**
 * Technical indicator calculations for charting.
 * All functions accept arrays of OHLCV candle data and return indicator series.
 */

export interface Candle {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface IndicatorPoint {
  time: number
  value: number
}

export interface MACDPoint {
  time: number
  macd: number
  signal: number
  histogram: number
}

export interface BollingerPoint {
  time: number
  upper: number
  middle: number
  lower: number
}

export interface StochasticPoint {
  time: number
  k: number
  d: number
}

export interface IchimokuPoint {
  time: number
  tenkan: number
  kijun: number
  senkouA: number
  senkouB: number
  chikou: number
}

// ─── Simple Moving Average ──────────────────────────────────────────
export function sma(candles: Candle[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  if (candles.length < period) return result
  let sum = 0
  for (let i = 0; i < period; i++) sum += candles[i].close
  result.push({ time: candles[period - 1].time, value: sum / period })
  for (let i = period; i < candles.length; i++) {
    sum += candles[i].close - candles[i - period].close
    result.push({ time: candles[i].time, value: sum / period })
  }
  return result
}

// ─── Exponential Moving Average ─────────────────────────────────────
export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  if (candles.length < period) return result
  const multiplier = 2 / (period + 1)
  // Seed with SMA
  let sum = 0
  for (let i = 0; i < period; i++) sum += candles[i].close
  let prev = sum / period
  result.push({ time: candles[period - 1].time, value: prev })
  for (let i = period; i < candles.length; i++) {
    prev = (candles[i].close - prev) * multiplier + prev
    result.push({ time: candles[i].time, value: prev })
  }
  return result
}

// ─── Volume Weighted Average Price ──────────────────────────────────
export function vwap(candles: Candle[]): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  let cumVolPrice = 0
  let cumVol = 0
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3
    cumVolPrice += tp * c.volume
    cumVol += c.volume
    if (cumVol > 0) {
      result.push({ time: c.time, value: cumVolPrice / cumVol })
    }
  }
  return result
}

// ─── RSI (Relative Strength Index) ──────────────────────────────────
export function rsi(candles: Candle[], period: number = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  if (candles.length < period + 1) return result

  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close
    if (diff >= 0) gainSum += diff
    else lossSum -= diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  const rsiVal = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  result.push({ time: candles[period].time, value: rsiVal })

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close
    const gain = diff >= 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    const val = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    result.push({ time: candles[i].time, value: val })
  }
  return result
}

// ─── MACD ───────────────────────────────────────────────────────────
export function macd(
  candles: Candle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDPoint[] {
  const fastEma = ema(candles, fastPeriod)
  const slowEma = ema(candles, slowPeriod)
  if (fastEma.length === 0 || slowEma.length === 0) return []

  // Align by time
  const slowMap = new Map(slowEma.map((p) => [p.time, p.value]))
  const macdLine: IndicatorPoint[] = []
  for (const fp of fastEma) {
    const sv = slowMap.get(fp.time)
    if (sv !== undefined) {
      macdLine.push({ time: fp.time, value: fp.value - sv })
    }
  }
  if (macdLine.length < signalPeriod) return []

  // Signal line = EMA of MACD line
  const mult = 2 / (signalPeriod + 1)
  let sigSum = 0
  for (let i = 0; i < signalPeriod; i++) sigSum += macdLine[i].value
  let sig = sigSum / signalPeriod

  const result: MACDPoint[] = []
  result.push({
    time: macdLine[signalPeriod - 1].time,
    macd: macdLine[signalPeriod - 1].value,
    signal: sig,
    histogram: macdLine[signalPeriod - 1].value - sig,
  })
  for (let i = signalPeriod; i < macdLine.length; i++) {
    sig = (macdLine[i].value - sig) * mult + sig
    result.push({
      time: macdLine[i].time,
      macd: macdLine[i].value,
      signal: sig,
      histogram: macdLine[i].value - sig,
    })
  }
  return result
}

// ─── Bollinger Bands ────────────────────────────────────────────────
export function bollingerBands(
  candles: Candle[],
  period = 20,
  stdDevMult = 2
): BollingerPoint[] {
  const result: BollingerPoint[] = []
  if (candles.length < period) return result

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close
    const mean = sum / period
    let sqSum = 0
    for (let j = i - period + 1; j <= i; j++) sqSum += (candles[j].close - mean) ** 2
    const stdDev = Math.sqrt(sqSum / period)
    result.push({
      time: candles[i].time,
      upper: mean + stdDevMult * stdDev,
      middle: mean,
      lower: mean - stdDevMult * stdDev,
    })
  }
  return result
}

// ─── Stochastic Oscillator ──────────────────────────────────────────
export function stochastic(
  candles: Candle[],
  kPeriod = 14,
  dPeriod = 3
): StochasticPoint[] {
  const result: StochasticPoint[] = []
  if (candles.length < kPeriod) return result

  const kValues: IndicatorPoint[] = []
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let high = -Infinity
    let low = Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > high) high = candles[j].high
      if (candles[j].low < low) low = candles[j].low
    }
    const k = high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100
    kValues.push({ time: candles[i].time, value: k })
  }

  // %D = SMA of %K
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    let sum = 0
    for (let j = i - dPeriod + 1; j <= i; j++) sum += kValues[j].value
    result.push({
      time: kValues[i].time,
      k: kValues[i].value,
      d: sum / dPeriod,
    })
  }
  return result
}

// ─── ATR (Average True Range) ───────────────────────────────────────
export function atr(candles: Candle[], period = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  if (candles.length < period + 1) return result

  const trValues: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    )
    trValues.push(tr)
  }

  let sum = 0
  for (let i = 0; i < period; i++) sum += trValues[i]
  let prev = sum / period
  result.push({ time: candles[period].time, value: prev })

  for (let i = period; i < trValues.length; i++) {
    prev = (prev * (period - 1) + trValues[i]) / period
    result.push({ time: candles[i + 1].time, value: prev })
  }
  return result
}

// ─── OBV (On-Balance Volume) ────────────────────────────────────────
export function obv(candles: Candle[]): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  if (candles.length === 0) return result
  let vol = 0
  result.push({ time: candles[0].time, value: vol })
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) vol += candles[i].volume
    else if (candles[i].close < candles[i - 1].close) vol -= candles[i].volume
    result.push({ time: candles[i].time, value: vol })
  }
  return result
}

// ─── Williams %R ────────────────────────────────────────────────────
export function williamsR(candles: Candle[], period = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  if (candles.length < period) return result
  for (let i = period - 1; i < candles.length; i++) {
    let high = -Infinity
    let low = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > high) high = candles[j].high
      if (candles[j].low < low) low = candles[j].low
    }
    const wr = high === low ? -50 : ((high - candles[i].close) / (high - low)) * -100
    result.push({ time: candles[i].time, value: wr })
  }
  return result
}

// ─── CCI (Commodity Channel Index) ──────────────────────────────────
export function cci(candles: Candle[], period = 20): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  if (candles.length < period) return result
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    const tps: number[] = []
    for (let j = i - period + 1; j <= i; j++) {
      const tp = (candles[j].high + candles[j].low + candles[j].close) / 3
      tps.push(tp)
      sum += tp
    }
    const mean = sum / period
    let madSum = 0
    for (const tp of tps) madSum += Math.abs(tp - mean)
    const mad = madSum / period
    const cciVal = mad === 0 ? 0 : (tps[tps.length - 1] - mean) / (0.015 * mad)
    result.push({ time: candles[i].time, value: cciVal })
  }
  return result
}

// ─── Indicator Registry ─────────────────────────────────────────────
export type OverlayIndicatorId = 'sma20' | 'sma50' | 'sma200' | 'ema12' | 'ema26' | 'ema50' | 'vwap' | 'bbands'
export type PaneIndicatorId = 'rsi' | 'macd' | 'stochastic' | 'atr' | 'obv' | 'williamsR' | 'cci' | 'volume'

export interface IndicatorConfig {
  id: OverlayIndicatorId | PaneIndicatorId
  label: string
  type: 'overlay' | 'pane'
  color?: string
  defaultEnabled?: boolean
}

export const INDICATOR_REGISTRY: IndicatorConfig[] = [
  // Overlays (drawn on price chart)
  { id: 'sma20', label: 'SMA 20', type: 'overlay', color: '#3b82f6' },
  { id: 'sma50', label: 'SMA 50', type: 'overlay', color: '#f97316' },
  { id: 'sma200', label: 'SMA 200', type: 'overlay', color: '#a855f7' },
  { id: 'ema12', label: 'EMA 12', type: 'overlay', color: '#06b6d4' },
  { id: 'ema26', label: 'EMA 26', type: 'overlay', color: '#ec4899' },
  { id: 'ema50', label: 'EMA 50', type: 'overlay', color: '#f97316' },
  { id: 'vwap', label: 'VWAP', type: 'overlay', color: '#eab308' },
  { id: 'bbands', label: 'Bollinger Bands', type: 'overlay', color: '#8b5cf6' },
  // Pane indicators (separate sub-chart)
  { id: 'volume', label: 'Volume', type: 'pane', defaultEnabled: true },
  { id: 'rsi', label: 'RSI (14)', type: 'pane', color: '#f59e0b' },
  { id: 'macd', label: 'MACD', type: 'pane' },
  { id: 'stochastic', label: 'Stochastic', type: 'pane' },
  { id: 'atr', label: 'ATR (14)', type: 'pane', color: '#14b8a6' },
  { id: 'obv', label: 'OBV', type: 'pane', color: '#6366f1' },
  { id: 'williamsR', label: 'Williams %R', type: 'pane', color: '#f43f5e' },
  { id: 'cci', label: 'CCI (20)', type: 'pane', color: '#84cc16' },
]

export const OVERLAY_IDS = INDICATOR_REGISTRY.filter((i) => i.type === 'overlay').map((i) => i.id) as OverlayIndicatorId[]
export const PANE_IDS = INDICATOR_REGISTRY.filter((i) => i.type === 'pane').map((i) => i.id) as PaneIndicatorId[]
