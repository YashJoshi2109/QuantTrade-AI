'use client'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'

function getCSSVar(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function useThemeTokens() {
  const { resolvedTheme } = useTheme()
  return useMemo(() => ({
    surface:        getCSSVar('--surface-raised'),
    surfaceBase:    getCSSVar('--surface-base'),
    textPrimary:    getCSSVar('--text-primary'),
    textMuted:      getCSSVar('--text-muted'),
    textSecondary:  getCSSVar('--text-secondary'),
    borderDefault:  getCSSVar('--border-default'),
    borderSubtle:   getCSSVar('--border-subtle'),
    up:             getCSSVar('--up'),
    down:           getCSSVar('--down'),
    accent:         getCSSVar('--accent'),
    tooltipBg:      getCSSVar('--surface-overlay'),
    tooltipBorder:  getCSSVar('--border-default'),
    tooltipText:    getCSSVar('--text-primary'),
  }), [resolvedTheme])
}
