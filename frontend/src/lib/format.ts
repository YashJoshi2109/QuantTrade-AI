export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function formatNumber(
  value: unknown,
  decimals = 2,
  fallback = 'N/A'
): string {
  if (!isNumber(value)) return fallback
  return value.toFixed(decimals)
}

export function formatPercent(
  value: unknown,
  decimals = 2,
  fallback = 'N/A'
): string {
  if (!isNumber(value)) return fallback
  return `${value.toFixed(decimals)}%`
}
