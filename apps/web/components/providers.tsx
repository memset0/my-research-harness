'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { type RuntimeConfigPayload, RuntimeConfigProvider } from '../lib/runtime-config'
import { type SessionInfo, SessionProvider } from './session-provider'
import { TerminalDrawerProvider } from './terminal-drawer-provider'
import { useMemonEvents } from './use-memon-events'

interface ProvidersProps {
  children: React.ReactNode
  session: SessionInfo
  runtimeConfig: RuntimeConfigPayload
}

export function Providers({ children, session, runtimeConfig }: ProvidersProps) {
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
    <SessionProvider value={session}>
      <RuntimeConfigProvider value={runtimeConfig}>
        <QueryClientProvider client={client}>
          <MemonEventsBridge />
          <TerminalDrawerProvider>{children}</TerminalDrawerProvider>
        </QueryClientProvider>
      </RuntimeConfigProvider>
    </SessionProvider>
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
