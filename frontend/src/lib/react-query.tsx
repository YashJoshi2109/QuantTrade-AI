'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useState } from 'react'
import PrefetchEngine from '@/components/loading/PrefetchEngine'
import GlobalDataLoadingBar from '@/components/loading/GlobalDataLoadingBar'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 2min stale — data stays fresh across tab switches
        staleTime: 1000 * 120,
        // 45min cache — data survives multiple navigations
        gcTime: 1000 * 60 * 45,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        // Don't refetch on mount if data is still fresh (prevents duplicate calls)
        refetchOnMount: 'always',
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
      <PrefetchEngine />
      <GlobalDataLoadingBar />
      {children}
    </QueryClientProvider>
  )
}
