'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useMemonEvents } from './use-memon-events'
import { TerminalDrawerProvider } from './terminal-drawer-provider'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // SSE drives invalidation now. Background refetch is a fallback in
            // case SSE drops or backend's poller misses something — set it slow
            // to avoid load when SSE is healthy. Aligned with the server-side
            // prefetch staleTime (lib/get-query-client.ts) so SSR-hydrated data
            // is not refetched on mount.
            staleTime: 60_000,
            refetchInterval: 60_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  )
  return (
    <QueryClientProvider client={client}>
      <MemonEventsBridge />
      <TerminalDrawerProvider>{children}</TerminalDrawerProvider>
    </QueryClientProvider>
  )
}

/**
 * Tiny child component so `useMemonEvents()` runs INSIDE the QueryClientProvider.
 * (Hooks called directly in <Providers> would not see the QueryClient context.)
 */
function MemonEventsBridge() {
  useMemonEvents()
  return null
}
