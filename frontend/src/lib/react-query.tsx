'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useState } from 'react'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Performance optimizations for fintech real-time data
        staleTime: 1000 * 60, // 1 minute - data is fresh
        gcTime: 1000 * 60 * 10, // 10 minutes - keep in cache
        refetchOnWindowFocus: false, // Don't refetch on tab focus
        refetchOnReconnect: true, // Refetch when network reconnects
        retry: 2, // Retry failed requests twice
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
        // Structural sharing for performance
        structuralSharing: true,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient()
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important so we don't re-make a new client on navigation
    if (!browserQueryClient) browserQueryClient = makeQueryClient()
    return browserQueryClient
  }
}

export function ReactQueryProvider({ children }: { children: ReactNode }) {
  // Use getQueryClient() for proper SSR/CSR handling
  const queryClient = getQueryClient()
  
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
