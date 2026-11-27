'use client'

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useState } from 'react'
import PrefetchEngine from '@/components/loading/PrefetchEngine'
import GlobalDataLoadingBar from '@/components/loading/GlobalDataLoadingBar'
import { noteRateLimited, retryDelayMs, shouldRetryQuery } from '@/lib/queryPolicy'
import { SystemStatusProvider } from '@/components/status/SystemStatusProvider'

function makeQueryClient() {
  return new QueryClient({
    // Any 429 starts a shared cooldown that every poll respects (lib/queryPolicy).
    queryCache: new QueryCache({ onError: (error) => noteRateLimited(error) }),
    defaultOptions: {
      queries: {
        // 3min stale — data stays fresh across navigations + tab switches
        staleTime: 1000 * 180,
        // 45min cache — data survives multiple navigations
        gcTime: 1000 * 60 * 45,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        // Don't refetch on mount if data is still fresh (prevents duplicate calls)
        refetchOnMount: false,
        // Never retry 4xx (429 included): retrying a rate limit is the storm.
        retry: shouldRetryQuery,
        retryDelay: retryDelayMs,
        // Polls pause while the tab is hidden.
        refetchIntervalInBackground: false,
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
      <SystemStatusProvider>{children}</SystemStatusProvider>
    </QueryClientProvider>
  )
}
