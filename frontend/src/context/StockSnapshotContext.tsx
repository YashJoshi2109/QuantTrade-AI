'use client'

import { createContext, useContext, useState, useCallback, ReactNode, lazy, Suspense } from 'react'
import type { SnapshotStock } from '@/components/StockSnapshotModal'

const StockSnapshotModal = lazy(() => import('@/components/StockSnapshotModal'))

interface SnapshotCtx {
  openSnapshot: (stock: SnapshotStock) => void
  closeSnapshot: () => void
}

const Ctx = createContext<SnapshotCtx>({ openSnapshot: () => {}, closeSnapshot: () => {} })

export function useStockSnapshot() {
  return useContext(Ctx)
}

export function StockSnapshotProvider({ children }: { children: ReactNode }) {
  const [stock, setStock] = useState<SnapshotStock | null>(null)
  // The modal chunk pulls in recharts (~110KB gz). Mount it on the first open
  // only, then keep it mounted so its close animation still runs.
  const [used, setUsed] = useState(false)

  const openSnapshot = useCallback((s: SnapshotStock) => {
    setUsed(true)
    setStock(s)
  }, [])
  const closeSnapshot = useCallback(() => setStock(null), [])

  return (
    <Ctx.Provider value={{ openSnapshot, closeSnapshot }}>
      {children}
      {used && (
        <Suspense fallback={null}>
          <StockSnapshotModal stock={stock} onClose={closeSnapshot} />
        </Suspense>
      )}
    </Ctx.Provider>
  )
}
