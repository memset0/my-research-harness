## ADDED Requirements

### Requirement: SSR-prefetched queries do not refetch on hydration

The web app SHALL prefetch React Query data on the server (via `getQueryClient()` + `prefetchQuery()`) and hydrate that data on the client (via `<HydrationBoundary>`) WITHOUT triggering an immediate refetch of every prefetched key on mount. The client-side default `staleTime` SHALL be greater than or equal to the server-side prefetch `staleTime` (today: 60 seconds), so server-fresh data remains fresh on the client until either an SSE invalidation event arrives or the per-query background `refetchInterval` (default 60 s) fires.

Per-query overrides SHALL be allowed: a `useQuery({ staleTime: <smaller> })` call may opt into shorter freshness if the data semantics demand it.

#### Scenario: Page open does not double-fetch prefetched queries
- **GIVEN** a project page whose server component prefetches `['experiments', project]`, `['hypotheses', project]`, `['journal', project, …countOnly]`, `['reports', project]`, `['digests', project]`
- **WHEN** the user opens that page (cold or warm) and the client mounts the `<HydrationBoundary>`
- **THEN** none of the prefetched query keys SHALL fire a network request on mount (the dev server log SHALL NOT show a duplicate GET for any of them within 1 second of the page-level GET)

#### Scenario: Per-query opt-in to shorter freshness still works
- **GIVEN** a `useQuery({ queryKey: [...], staleTime: 5_000 })` call in a component
- **WHEN** the query has been in cache for 6 s
- **THEN** the next render of that component refetches that specific query (the per-query override beats the default)

#### Scenario: SSE invalidation still drives updates
- **WHEN** an SSE `experiment-change` event arrives for a query already in cache
- **THEN** the affected `queryKey` is invalidated and refetched as before — the alignment of `staleTime` does NOT delay live updates
