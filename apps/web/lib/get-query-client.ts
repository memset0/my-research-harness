// Per-request QueryClient on the server, singleton in the browser.
//
// This is the canonical TanStack Query v5 pattern for Next.js App Router SSR
// prefetch + hydration. Server components call `getQueryClient()` to obtain
// a fresh QC, prefetch into it, dehydrate; the dehydrated state is hydrated
// on the client via <HydrationBoundary>.
//
// Reference: https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr

import { QueryClient, isServer } from '@tanstack/react-query'

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Match the client's defaults so dehydrated data isn't immediately
        // considered stale on the client side.
        staleTime: 60 * 1000,
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

let browserQueryClient: QueryClient | undefined = undefined

export function getQueryClient(): QueryClient {
  if (isServer) {
    // Always make a new client on the server — sharing across requests would
    // leak data between users (even though we're single-user, this is the
    // hard rule).
    return makeQueryClient()
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}
