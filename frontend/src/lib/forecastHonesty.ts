/**
 * Honesty helpers for the price forecast (shared by desktop + mobile research,
 * both of which render components/research/ForecastPanel).
 *
 * Rules:
 * - The forecast is always labelled experimental / not investment advice.
 * - A horizon whose backtest did not beat the no-change baseline gets no
 *   direction colour and no P(up): its midpoint is noise, the range is the forecast.
 * - Band calibration is shown as measured: if past outcomes fell inside the
 *   80% range far less (or more) often than 80%, say so.
 * - Older cached payloads without the new fields fall back to the same rules.
 */

export const EXPERIMENTAL_LABEL = 'Experimental · Not investment advice'

export type Reliability = 'edge_in_backtest' | 'no_edge'
export type CalibrationStatus = 'calibrated' | 'under_covered' | 'over_covered' | 'insufficient_data'

export interface HonestyInput {
  beats_naive?: Record<string, boolean>
  backtest?: { origins?: number; band_coverage?: Record<string, Record<string, number | null>> }
  horizons?: Array<{ h: number; reliability?: Reliability; calibration?: { status?: CalibrationStatus } }>
}

const TOL: Record<'80' | '95', number> = { '80': 0.1, '95': 0.07 }
const MIN_ORIGINS = 20

export function horizonReliability(data: HonestyInput, h: number): Reliability {
  const row = data.horizons?.find((r) => r.h === h)
  if (row?.reliability) return row.reliability
  return data.beats_naive?.[String(h)] ? 'edge_in_backtest' : 'no_edge'
}

/** Mirrors backend app/services/model_status.band_calibration. */
export function bandCalibration(data: HonestyInput, h: number): CalibrationStatus {
  const row = data.horizons?.find((r) => r.h === h)
  if (row?.calibration?.status) return row.calibration.status
  const origins = data.backtest?.origins ?? 0
  const cov = data.backtest?.band_coverage?.[String(h)]
  if (!cov || origins < MIN_ORIGINS) return 'insufficient_data'
  let worst = 0
  let status: CalibrationStatus = 'calibrated'
  for (const lvl of ['80', '95'] as const) {
    const c = cov[lvl]
    if (c == null) return 'insufficient_data'
    const gap = c - Number(lvl) / 100
    if (Math.abs(gap) > TOL[lvl] && Math.abs(gap) > Math.abs(worst)) {
      worst = gap
      status = gap < 0 ? 'under_covered' : 'over_covered'
    }
  }
  return status
}

export const CALIBRATION_TEXT: Record<CalibrationStatus, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  calibrated: { label: 'Range held up in tests', tone: 'ok' },
  under_covered: { label: 'Range too narrow in tests — real moves were wider', tone: 'warn' },
  over_covered: { label: 'Range wider than needed in tests', tone: 'muted' },
  insufficient_data: { label: 'Too few tests to check the range', tone: 'muted' },
}

export interface MlModelStatus {
  used_in_forecast?: boolean
  promoted?: boolean
  gates_passed?: number | null
  gates_total?: number
  gates_required?: number
  note?: string
}

/** One plain sentence on whether our ML model is involved and why not. */
export function mlStatusSentence(ml?: MlModelStatus | null): string {
  if (ml?.note) return ml.note
  return 'Our ML price model is experimental and is not used in this forecast.'
}
