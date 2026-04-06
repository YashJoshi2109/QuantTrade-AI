import type { ReactNode } from 'react'

// Metadata is exported from page.tsx (overrides any layout-level metadata)
export default function PricingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
