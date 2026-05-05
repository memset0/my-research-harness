## ADDED Requirements

### Requirement: Server-side prefetch is a no-op in dev

In dev (`process.env.NODE_ENV !== 'production'`), the server-side `QueryClient` returned by `getQueryClient()` SHALL have its `prefetchQuery` method replaced with a resolved no-op. Page modules SHALL continue to call `await queryClient.prefetchQuery(...)` and `<HydrationBoundary state={dehydrate(queryClient)}>` exactly as in production — no per-page conditionals, no helper at the call site. The dehydrated state in dev SHALL therefore be empty, and the client React Query SHALL fetch each query on mount.

This relaxation only applies to the server branch of `getQueryClient()`. The browser singleton path is unaffected. In production (`NODE_ENV === 'production'`) `prefetchQuery` SHALL behave as default and the requirement "SSR-prefetched queries do not refetch on hydration" SHALL hold as written.

#### Scenario: Dev page render does not block on prefetch
- **GIVEN** a project page whose module body calls `await queryClient.prefetchQuery({ queryKey, queryFn })`
- **WHEN** the dev server (`pnpm dev`, `NODE_ENV !== 'production'`) renders that page
- **THEN** the `prefetchQuery` call resolves immediately without invoking `queryFn`
- **AND** no entry for `queryKey` is present in the dehydrated state delivered to the client

#### Scenario: Dev client refetches missing keys on mount
- **GIVEN** a dev-rendered page whose dehydrated state is empty
- **WHEN** the client mounts and the React Query hook for one of those keys runs
- **THEN** the client fetches that key over the HTTP API exactly once
- **AND** the page transitions from skeleton/empty to data once the fetch resolves

#### Scenario: Production prefetch is unaffected
- **GIVEN** the server is running with `NODE_ENV=production`
- **WHEN** a page module calls `await queryClient.prefetchQuery({ queryKey, queryFn })`
- **THEN** `queryFn` runs on the server and the dehydrated state contains the prefetched key
- **AND** the client does NOT refetch that key on mount (per the existing "SSR-prefetched queries do not refetch on hydration" requirement)
