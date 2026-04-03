'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useState } from 'react'
import MarketPrefetchBoot from '@/components/loading/MarketPrefetchBoot'
import GlobalDataLoadingBar from '@/components/loading/GlobalDataLoadingBar'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 90,
        gcTime: 1000 * 60 * 30,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchOnMount: true,
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
        structuralSharing: true,
      },
    },
  })
}

export function ReactQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <MarketPrefetchBoot />
      <GlobalDataLoadingBar />
      {children}
    </QueryClientProvider>
  )
}
