'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

export function BB8ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return <div style={{ width: 60, height: 30 }} />

  const isDark = resolvedTheme === 'dark'

  return (
    <>
      <input
        id="bb8-theme-toggle"
        className="bb8-toggle__checkbox"
        type="checkbox"
        checked={isDark}
        onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      />
      <label className="bb8-toggle__container" htmlFor="bb8-theme-toggle">
        <div className="bb8-toggle__scenery">
          <div className="bb8-toggle__star" />
          <div className="bb8-toggle__star" />
          <div className="bb8-toggle__star" />
          <div className="bb8-toggle__cloud" />
          <div className="bb8-toggle__cloud bb8-toggle__cloud--2" />
        </div>
        <div className="bb8-toggle__ball">
          <div className="bb8-toggle__ball-inner" />
        </div>
        <div className="bb8-toggle__sun" />
      </label>
    </>
  )
}
