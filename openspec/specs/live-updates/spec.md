# live-updates Specification

## Purpose
TBD - created by archiving change add-write-flow. Update Purpose after archive.

## Requirements

### Requirement: Single SSE connection from the root layout

The dashboard SHALL open exactly one `EventSource` connection to `/api/events` from the root layout (mounted via `Providers`). All components subscribing to live updates SHALL go through a shared `useMemonEvents()` hook backed by an in-memory event emitter that fans out to React subscribers.

#### Scenario: One connection per tab
- **WHEN** the user opens the dashboard and navigates between list, detail, hypothesis, and journal pages
- **THEN** the browser DevTools network panel shows exactly one open `text/event-stream` request to `/api/events` (no duplicates, no leaked connections after navigation)

#### Scenario: Reconnect on disconnect
- **WHEN** the SSE connection drops (network blip, dev server HMR, server restart)
- **THEN** the browser's native `EventSource` reconnect kicks in within ~3 seconds and the page resumes receiving events without user action

### Requirement: Cache invalidation on experiment-change

The `useMemonEvents()` hook SHALL invalidate TanStack Query caches when
events arrive on the three v3 topics. The mapping is described in the
"Experiment-doc and anomaly SSE topics" requirement; the v2 single-topic
mapping is replaced by the multi-topic mapping.

The v3 wiring drops the legacy `experiment-change` deprecated alias for
run edits — `experiment-change` events on the SSE wire mean
exp-doc events ONLY. Frontend code that previously listened to
`experiment-change` for run edits SHALL migrate to `run-change`. There
is no transition window beyond the v3 cutover.

#### Scenario: Run edit propagates to relevant queries
- **WHEN** an underlying run README is edited (locally or remotely)
- **THEN** within ~1 second, the run's parent experiment detail page
  (if open) and any list view refresh; the `['run', id]` query is
  invalidated AND, when the run carries an `experiment` parent id, the
  `['experiment', parentId]` query is also invalidated

#### Scenario: Toast on remote experiment-doc create
- **WHEN** an `experiment-change` event with `op: 'set'` is received
  for an experiment doc id NOT previously in the local cache
- **THEN** a `toast.info('New experiment: <id>')` appears for ~3
  seconds with a `View` action that navigates to the exp detail page

### Requirement: SSE-driven log streaming

LogViewer SHALL replace its current 3-second polling with an `EventSource` subscription to `/api/log/stream?path=...`. Initial 100 lines SHALL still be loaded via the existing `GET /api/log` request before SSE setup.

#### Scenario: Real-time line append
- **WHEN** the underlying log file gets 5 new lines appended while the LogViewer is open
- **THEN** the 5 new lines are pushed via the SSE `append` event and rendered within ~1 second (subject to the backend's 1.5s server-side poll cadence in `/api/log/stream`)

#### Scenario: File rotation
- **WHEN** the SSE stream emits a `rotated` event (file truncated or inode changed)
- **THEN** LogViewer clears its current line buffer and re-fetches the initial 100 lines

#### Scenario: Stream error
- **WHEN** the SSE stream emits an `error` event
- **THEN** the viewer displays a small error banner with a retry button; the existing line buffer is preserved

### Requirement: Follow mode auto-pause and resume

LogViewer SHALL track scroll position. The user is considered "at the bottom" when the distance from the visible region's end to the scroll container's bottom is < 50px. While at the bottom, follow mode is active (new lines auto-scroll into view). While not at the bottom, follow mode is paused.

#### Scenario: Pause on scroll up
- **WHEN** the user scrolls up such that the bottom is no longer in view
- **THEN** follow mode pauses, new SSE-pushed lines are still appended to the buffer but do not force scroll, and a floating badge `N new lines ↓` appears showing how many lines arrived since pause

#### Scenario: Resume on click
- **WHEN** the user clicks the `N new lines ↓` badge
- **THEN** the viewer scrolls to the bottom, the badge disappears, and follow mode resumes

#### Scenario: Resume on scroll back
- **WHEN** the user manually scrolls back to within 50px of the bottom
- **THEN** follow mode automatically resumes and the badge disappears

### Requirement: Toast feedback for write operations

All write operations from the UI (status edit, README save, note/request append, new experiment) SHALL surface their outcome via `sonner` toasts (mounted globally via a `<Toaster />` in the root layout):
- Success: `toast.success(<short message>)`, default 1s display
- Server error: `toast.error(<message>)`, 5s display, with a retry action when applicable
- Conflict (409 on README): NOT a toast — opens the conflict resolution modal

#### Scenario: Successful save
- **WHEN** a README save succeeds
- **THEN** a toast `Saved · mtime <HH:MM:SS>` appears at the bottom-right corner

#### Scenario: Network failure on save
- **WHEN** a README save fails due to network error
- **THEN** a toast `Save failed: <error message>` appears with a `Retry` action that re-issues the save

### Requirement: Loading skeletons replace text placeholders

All async data renders SHALL use animated skeleton placeholders during the initial fetch (when no cached data is available), not the literal text `loading…`.

#### Scenario: List view first load
- **WHEN** the user opens the experiment list page for the first time in the session
- **THEN** the page shows ~5 row-shaped skeleton placeholders (animated `bg-slate-200`) until the data arrives

#### Scenario: Detail view first load
- **WHEN** the user opens an experiment detail page for the first time
- **THEN** the page shows section-shaped skeletons in the front matter panel and body areas until data arrives

#### Scenario: Cached refetch
- **WHEN** the user navigates to a page whose data is already cached
- **THEN** the cached data renders immediately and no skeleton flashes

### Requirement: Error boundary and not-found page

The web app SHALL implement Next.js App Router's `error.tsx` (global error boundary) and `not-found.tsx` (404 page). Both SHALL avoid white-screen by rendering a friendly error display with at least:
- Page title (`Something went wrong` or `Page not found`)
- A short description
- A `Reload`/`Home` button

#### Scenario: Caught render error
- **WHEN** a server-side data fetch in a page throws an unhandled error
- **THEN** the global `error.tsx` boundary catches it and shows the error UI, NOT a blank page

#### Scenario: Unknown project
- **WHEN** the user navigates to `/p/nonexistent-project`
- **THEN** the not-found page is rendered (the route resolves but the project isn't in config)

### Requirement: Markdown body uses tailwindcss/typography

Rendered markdown bodies (experiment sections, hypothesis statements, journal request bodies) SHALL render with `@tailwindcss/typography` `prose` styling — meaning headings get visual hierarchy, code blocks have backgrounds, lists have proper spacing, etc.

#### Scenario: Section renders with prose
- **WHEN** an experiment's `## Method` section contains markdown with code blocks, lists, and inline links
- **THEN** the rendered output has visible heading sizes, code blocks with `bg-slate-100` shading, list bullets with proper indentation, and links underlined in blue (no plain unstyled `<h2>` / `<pre>` etc.)

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

### Requirement: Experiment-doc and anomaly SSE topics

The system SHALL extend the live-updates SSE channel with three v3
event topics. The `useMemonEvents()` hook (and the underlying
`/api/events` SSE stream) SHALL fan out exactly three topics:

- `run-change` (NEW name; replaces v2's `experiment-change` for run-doc
  edits — no alias retained)
- `experiment-change` (NEW semantics: experiment-doc edits, creates,
  deletes, binds — repurposed from the v2 run-edit topic)
- `anomaly` (NEW: per `experiment-membership-anomalies`)

The `experiment-change` event payload SHALL include `{ id, op,
projectName }` where `op` is one of `set` (create or edit), `delete`,
or `bind` (link/unlink).

The `anomaly` event payload SHALL include `{ project: string, count:
number }` where `count` is the anomaly count for the project AFTER
the recompute that triggered the event. Per-anomaly granularity
(`{ op, record }`) is explicitly NOT supported — clients receive the
coarse signal and refetch `/api/anomalies?project=…` for the diff.
Rationale: implementation simplicity (no need to diff anomaly sets
across recomputes); the anomaly list is small enough that a refetch
is cheap (<50ms locally).

The `useMemonEvents()` hook SHALL invalidate the matching TanStack
Query caches on each topic:
- `run-change` → `['runs']`, `['run', evt.id]`,
  `['experiment', evt.parentExperimentId]` (when known)
- `experiment-change` → `['experiments']`, `['experiment', evt.id]`
- `anomaly` → `['anomalies', evt.project]`

#### Scenario: Experiment-doc edit propagates within ~1s
- **GIVEN** the user has an exp detail page open in tab A
- **WHEN** the same exp doc is saved from tab B (or a CLI command)
- **THEN** within ~1 second, tab A's exp page re-renders with the new
  body content, no manual refresh required

#### Scenario: Anomaly recompute pushes a banner refetch
- **GIVEN** the user is on a project list page with the anomaly banner
  showing N records
- **WHEN** the indexer's `recomputeAnomalies(project)` runs (e.g.
  triggered by a poll-detected exp-doc edit)
- **THEN** an `anomaly` event with `{ project, count }` is pushed; the
  banner invalidates `['anomalies', project]` and refetches the list;
  the banner re-renders with the updated record set within ~1 second

#### Scenario: Run edit carries parent experiment id when bound
- **GIVEN** a run with `frontMatter.experiment = "E0001-foo"`
- **WHEN** the run README is edited
- **THEN** the SSE `run-change` event payload SHALL include
  `parentExperimentId: "E0001-foo"`; the hook invalidates BOTH
  `['run', id]` AND `['experiment', "E0001-foo"]`

### Requirement: Central fans Backend events into one browser SSE stream
Central SHALL maintain one authenticated Backend event stream per usable Host and merge them into the existing single browser SSE connection. Every relayed event SHALL carry the configured Host ID plus Project identity, and viewer filtering SHALL use the Host-qualified scope.

#### Scenario: Two Hosts emit equal Project events
- **WHEN** Host A and Host B both emit a run change for `project-x`
- **THEN** the browser receives two Host-qualified events and invalidates each Host's cache independently

### Requirement: One Backend stream failure does not close aggregate SSE
Loss, authentication failure, or incompatibility of one Backend event stream SHALL update only that Host and SHALL NOT close the browser SSE connection or stop updates from other Hosts.

#### Scenario: Other Host continues updating
- **WHEN** Host A's Backend SSE disconnects while Host B emits events
- **THEN** Host B events continue reaching the same browser connection

### Requirement: Event gaps cause Host-wide resynchronization
Central SHALL detect Backend reconnect, instance-epoch change, and sequence gaps. Before resuming incremental delivery for that Host, it SHALL emit a Host-resync signal that invalidates all live queries for that Host without invalidating another Host.

#### Scenario: Missed events cannot leave stale cache indefinitely
- **WHEN** a Backend reconnects after events may have been lost
- **THEN** all browser data for that Host is refetched before incremental assumptions resume

### Requirement: Event streams are bounded and live
Backend and browser SSE connections SHALL provide heartbeats, bounded event/frame parsing, cancellation on disconnect, and reverse-proxy-compatible flush behavior.

#### Scenario: Idle stream remains observable
- **WHEN** no Project events occur during the heartbeat interval
- **THEN** heartbeat traffic keeps the authenticated Backend and browser streams detectably live
