'use client'

import { useEffect, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * Thin indeterminate bar while any query is actively fetching (avoids flash on sub-200ms requests).
 */
export default function GlobalDataLoadingBar() {
  const fetching = useIsFetching({ fetchStatus: 'fetching' })
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (fetching === 0) {
      setVisible(false)
      return
    }
    const t = window.setTimeout(() => setVisible(true), 280)
    return () => window.clearTimeout(t)
  }, [fetching])

  return (
    <AnimatePresence>
      {visible && fetching > 0 && (
        <motion.div
          initial={{ opacity: 0, scaleX: 0.2 }}
          animate={{ opacity: 1, scaleX: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed top-0 left-0 right-0 z-[60] h-[3px] pointer-events-none overflow-hidden origin-left"
          aria-hidden
        >
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/90 via-blue-500/90 to-violet-500/90" />
          <motion.div
            className="absolute inset-y-0 w-1/3 bg-white/30 blur-sm"
            animate={{ x: ['-20%', '120%'] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
