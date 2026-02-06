'use client'

import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  variant?: 'default' | 'circular' | 'rectangular'
  width?: string | number
  height?: string | number
  animation?: 'pulse' | 'wave' | 'none'
}

export function Skeleton({
  className,
  variant = 'default',
  width,
  height,
  animation = 'pulse',
}: SkeletonProps) {
  const baseStyles = 'bg-slate-700/50'
  
  const variantStyles = {
    default: 'rounded-md',
    circular: 'rounded-full',
    rectangular: 'rounded-none',
  }
  
  const animationStyles = {
    pulse: 'animate-pulse',
    wave: 'skeleton-wave',
    none: '',
  }

  const style: React.CSSProperties = {}
  if (width) style.width = typeof width === 'number' ? `${width}px` : width
  if (height) style.height = typeof height === 'number' ? `${height}px` : height

  return (
    <div
      className={cn(
        baseStyles,
        variantStyles[variant],
        animationStyles[animation],
        className
      )}
      style={style}
    />
  )
}

// Pre-built skeleton components for common UI patterns
export function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          width={i === lines - 1 && lines > 1 ? '75%' : '100%'}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('hud-panel p-4 space-y-3', className)}>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

export function SkeletonIndexCard() {
  return (
    <div className="hud-panel p-4 space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-4 w-16" />
    </div>
  )
}

export function SkeletonStatsRow() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="hud-card p-4">
          <Skeleton className="h-4 w-16 mb-2" />
          <Skeleton className="h-8 w-12" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonStockRow() {
  return (
    <div className="flex items-center justify-between p-3 border-b border-slate-700/50">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8" variant="circular" />
        <div className="space-y-1">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="text-right space-y-1">
        <Skeleton className="h-5 w-16 ml-auto" />
        <Skeleton className="h-4 w-12 ml-auto" />
      </div>
    </div>
  )
}

export function SkeletonTableRow({ columns = 5 }: { columns?: number }) {
  return (
    <tr className="border-b border-slate-700/50">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="p-3">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonHeatmapCell() {
  return (
    <Skeleton className="h-16 w-full rounded-md" />
  )
}

export function SkeletonNewsCard() {
  return (
    <div className="hud-card p-4 space-y-3">
      <div className="flex gap-3">
        <Skeleton className="h-16 w-16 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  )
}

export function SkeletonChart({ height = 300 }: { height?: number }) {
  return (
    <div className="hud-panel p-4">
      <div className="flex justify-between mb-4">
        <Skeleton className="h-5 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-6 w-12" />
        </div>
      </div>
      <Skeleton className="w-full" height={height} />
    </div>
  )
}

export function SkeletonWatchlistItem() {
  return (
    <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10" variant="circular" />
        <div className="space-y-1">
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right space-y-1">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-12" />
        </div>
        <Skeleton className="h-8 w-8" variant="circular" />
      </div>
    </div>
  )
}

export function SkeletonCopilotMessage() {
  return (
    <div className="flex gap-3 p-4">
      <Skeleton className="h-8 w-8 flex-shrink-0" variant="circular" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  )
}

export function SkeletonIndicators() {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonWatchlistTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-800/50">
            <th className="px-4 py-3 text-left"><Skeleton className="h-3 w-4" /></th>
            <th className="px-4 py-3 text-left"><Skeleton className="h-3 w-14" /></th>
            <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10" /></th>
            <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-12" /></th>
            <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-8" /></th>
            <th className="px-4 py-3 text-left"><Skeleton className="h-3 w-10" /></th>
            <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-14" /></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              <td className="px-4 py-4"><Skeleton className="h-4 w-4" /></td>
              <td className="px-4 py-4">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </td>
              <td className="px-4 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
              <td className="px-4 py-4 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
              <td className="px-4 py-4 text-right"><Skeleton className="h-4 w-10 ml-auto" /></td>
              <td className="px-4 py-4"><Skeleton className="h-4 w-20" /></td>
              <td className="px-4 py-4 text-right"><Skeleton className="h-4 w-4 ml-auto" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Markets page specific skeletons
export function SkeletonMarketIndices() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonIndexCard key={i} />
      ))}
    </div>
  )
}

export function SkeletonMarketStats() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="hud-card p-4 text-center">
          <Skeleton className="h-8 w-8 mx-auto mb-2" variant="circular" />
          <Skeleton className="h-6 w-12 mx-auto mb-1" />
          <Skeleton className="h-3 w-16 mx-auto" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonSectorPerformance({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8" variant="circular" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonMoversSection({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-0">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStockRow key={i} />
      ))}
    </div>
  )
}

export function SkeletonHeatmap() {
  return (
    <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 p-4">
      {Array.from({ length: 24 }).map((_, i) => (
        <SkeletonHeatmapCell key={i} />
      ))}
    </div>
  )
}

export function SkeletonNewsFeed({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonNewsCard key={i} />
      ))}
    </div>
  )
}

// Full page skeletons
export function SkeletonMarketsPage() {
  return (
    <div className="space-y-6 p-6">
      {/* Header skeleton */}
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      
      {/* Index cards */}
      <SkeletonMarketIndices />
      
      {/* Stats row */}
      <SkeletonMarketStats />
      
      {/* Main content grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SkeletonHeatmap />
        </div>
        <div className="space-y-4">
          <SkeletonMoversSection />
        </div>
      </div>
    </div>
  )
}

export function SkeletonWatchlistPage() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="hud-panel">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonWatchlistItem key={i} />
        ))}
      </div>
    </div>
  )
}

export function SkeletonResearchPage() {
  return (
    <div className="grid lg:grid-cols-3 gap-6 p-6">
      <div className="lg:col-span-2 space-y-6">
        {/* Symbol header */}
        <div className="hud-panel p-6">
          <div className="flex items-center gap-4 mb-4">
            <Skeleton className="h-12 w-12" variant="circular" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        </div>
        
        {/* Chart */}
        <SkeletonChart height={350} />
        
        {/* Key stats */}
        <div className="hud-panel p-6">
          <Skeleton className="h-5 w-28 mb-4" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Sidebar */}
      <div className="space-y-4">
        <div className="hud-panel p-4">
          <Skeleton className="h-5 w-20 mb-3" />
          <SkeletonNewsFeed />
        </div>
      </div>
    </div>
  )
}

export default Skeleton
