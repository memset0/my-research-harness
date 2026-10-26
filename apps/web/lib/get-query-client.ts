// Per-request QueryClient on the server, singleton in the browser.
//
// This is the canonical TanStack Query v5 pattern for Next.js App Router SSR
// prefetch + hydration. Server components call `getQueryClient()` to obtain
// a fresh QC, prefetch into it, dehydrate; the dehydrated state is hydrated
// on the client via <HydrationBoundary>.
//
// Reference: https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr

import { isServer, QueryClient } from '@tanstack/react-query'

// A busy or briefly unreachable file source answers 429/502/503/504. Such a
// failure gets more retries than the default three (about 35 s in all), and
// a query left in that error state keeps retrying in the background, so a page
// recovers by itself instead of staying on the error.
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504])
export function isTransientError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && TRANSIENT_STATUSES.has(status)
}
const TRANSIENT_RETRIES = 6
const TRANSIENT_REFETCH_MS = 15_000

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Match the client's defaults so dehydrated data isn't immediately
        // considered stale on the client side.
        staleTime: 30 * 1000,
        retry: (failureCount, error) =>
          failureCount < (isTransientError(error) ? TRANSIENT_RETRIES : 3),
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
        refetchInterval: (query) =>
          query.state.status === 'error' && isTransientError(query.state.error)
            ? TRANSIENT_REFETCH_MS
            : false,
      },
      dehydrate: {
        // Dehydrate even pending queries so server-streamed Suspense queries
        // can be re-attached on the client without re-fetching.
        shouldDehydrateQuery: (query) =>
          query.state.status !== 'error' && query.state.status !== 'pending',
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
  if (isServer) {
    // Always make a new client on the server — sharing across requests would
    // leak data between users (even though we're single-user, this is the
    // hard rule).
    const qc = makeQueryClient()
    if (process.env.NODE_ENV !== 'production') {
      // Dev-only: skip server-side prefetch. Page modules call prefetchQuery
      // unconditionally, but in dev the cost (compile + data-layer hops on
      // a cold route) shows up as TTFB. Returning a resolved no-op leaves the
      // dehydrated cache empty; the client refetches on mount, which is fast
      // and doesn't block first paint. Production behaviour is unchanged.
      qc.prefetchQuery = (async () => {}) as typeof qc.prefetchQuery
    }
    return qc
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}
