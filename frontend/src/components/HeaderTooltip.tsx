'use client'

import type { ReactNode } from 'react'

export function HeaderTooltip({
  label,
  detail,
  children,
}: {
  label: string
  detail: string
  children: ReactNode
}) {
  return (
    <div className="relative group">
      {children}
      <div className="pointer-events-none absolute top-full right-0 mt-2 w-52 rounded-lg border border-line-subtle bg-surface-base/95 px-3 py-2 text-[10px] opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all shadow-xl z-50">
        <div className="text-slate-200 font-semibold">{label}</div>
        <div className="text-fg-muted mt-0.5 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{detail}</div>
      </div>
    </div>
  )
}
