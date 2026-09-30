import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type RenderOptions, type RenderResult, render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { ResourceHeartbeatProvider } from '../components/resource-heartbeat-provider'

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

/** RTL render wrapped in a fresh TanStack Query client (retries off). */
export function renderWithQuery(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult & { queryClient: QueryClient } {
  const qc = freshClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient: qc }
}

/**
 * Same, plus the shared resource heartbeat. Use this when the behaviour under
 * test involves the page refresh lifecycle (manual refresh controls, page
 * freshness); it needs an App Router context for `usePathname`, so tests that
 * stub `next/navigation` should use `renderWithQuery` instead.
 */
export function renderWithHeartbeat(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult & { queryClient: QueryClient } {
  const qc = freshClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ResourceHeartbeatProvider>{children}</ResourceHeartbeatProvider>
      </QueryClientProvider>
    )
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient: qc }
}
