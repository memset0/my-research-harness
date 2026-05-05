## Why

In dev, every page module under `apps/web/app/p/[project]/` calls `getQueryClient().prefetchQuery(...)` on the server before rendering. Even though those calls hit the in-process `lib/server/data.ts` (not the HTTP API), they still pay (a) the on-demand compile of every imported module on cold visits, and (b) the dehydrated state inlined into HTML. The net is "page TTFB takes the longest of N data hops + the route compile" for the first hit. Cutting the prefetch in dev lets the page render its shell as soon as the route is compiled; the client then refetches via the existing React Query path with no behavioural surprise.

This is a dev-only relaxation. In production the prefetch is what gives "no skeleton flash on first paint," and we keep it intact there.

## What Changes

- `getQueryClient()` (server-side branch) returns a `QueryClient` whose `prefetchQuery` is replaced with a no-op when `process.env.NODE_ENV !== 'production'`. Page modules continue to call `await queryClient.prefetchQuery(...)` exactly as today; the call resolves immediately in dev and runs as before in prod.
- No page.tsx / layout.tsx changes. The override is the chokepoint.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `live-updates`: extend the existing "SSR-prefetched queries do not refetch on hydration" requirement with a dev-mode carve-out describing the no-op + client-refetch fallback path.

## Impact

- Code: `apps/web/lib/get-query-client.ts` only (~6 lines).
- No API change, no on-disk change, no production behaviour change.
- The just-merged fix-rate-limit-and-stale-time change (which says "client `staleTime` ≥ server prefetch staleTime so server-fresh data is treated as fresh on the client") still holds in production. In dev, dehydrated state is empty, so the staleTime alignment is a no-op there.
