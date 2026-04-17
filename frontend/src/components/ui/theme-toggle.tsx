'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sun, Moon } from 'lucide-react'

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const isDark = theme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`relative w-14 h-7 rounded-full transition-colors duration-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
        isDark
          ? 'bg-slate-800 border border-white/10'
          : 'bg-sky-100 border border-sky-200'
      } ${className}`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={isDark ? 'dark' : 'light'}
          initial={{ x: isDark ? 24 : 2, scale: 0.6, opacity: 0 }}
          animate={{
            x: isDark ? 2 : 24,
            scale: 1,
            opacity: 1,
          }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.175, 0.885, 0.32, 1.275] }}
          className={`absolute top-0.5 w-6 h-6 rounded-full flex items-center justify-center shadow-md ${
            isDark
              ? 'bg-slate-700 text-cyan-400'
              : 'bg-white text-amber-500'
          }`}
        >
          {isDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
        </motion.div>
      </AnimatePresence>
    </button>
  )
}
