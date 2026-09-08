'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { type RuntimeConfigPayload, RuntimeConfigProvider } from '../lib/runtime-config'
import { ResourceHeartbeatProvider } from './resource-heartbeat-provider'
import { type SessionInfo, SessionProvider } from './session-provider'
import { WorkspacePaneProvider } from './workspace-pane-provider'

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
            // No per-query polling and no refetch-on-focus: the single
            // <ResourceHeartbeatProvider /> below drives every automatic
            // refresh, so a hidden or unfocused tab issues no requests and
            // one shared batch replaces N independent timers. `staleTime`
            // still matches the SSR prefetch (lib/get-query-client.ts) so
            // hydrated data is not refetched on mount.
            staleTime: 60_000,
            retry: 1,
          },
        },
      }),
  )
  return (
    <SessionProvider value={session}>
      <RuntimeConfigProvider value={runtimeConfig}>
        <QueryClientProvider client={client}>
          <ResourceHeartbeatProvider>
            <WorkspacePaneProvider>{children}</WorkspacePaneProvider>
          </ResourceHeartbeatProvider>
        </QueryClientProvider>
      </RuntimeConfigProvider>
    </SessionProvider>
  )
}
