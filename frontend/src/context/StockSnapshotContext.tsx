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

  const openSnapshot = useCallback((s: SnapshotStock) => setStock(s), [])
  const closeSnapshot = useCallback(() => setStock(null), [])

  return (
    <Ctx.Provider value={{ openSnapshot, closeSnapshot }}>
      {children}
      <Suspense fallback={null}>
        <StockSnapshotModal stock={stock} onClose={closeSnapshot} />
      </Suspense>
    </Ctx.Provider>
  )
}
