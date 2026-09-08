# live-updates Specification

## Purpose
Define foreground resource heartbeat refresh and retained byte/log streaming without document/list event fan-in.

## Requirements

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

### Requirement: Foreground polling serves stale content before verification
Document/list resources SHALL return available cached content immediately and schedule appropriate file checks independently. Foreground heartbeats SHALL return semantic changed/unchanged plus freshness and queue/error status. No proactive document/list push SHALL be required or opened. Hidden or unfocused pages SHALL stop periodic resource requests; opening or reactivating SHALL trigger human attention for documents, never collections.

#### Scenario: Warm open then edit
- **WHEN** a cached Report is opened after an external edit
- **THEN** cached content renders first; after file checking a later heartbeat returns changed content

#### Scenario: No semantic change
- **WHEN** a file check changes only metadata or equivalent source formatting
- **THEN** the frontend does not replace content or display an update toast

#### Scenario: Background activation
- **WHEN** a hidden Wiki page becomes visible and focused
- **THEN** it immediately sends human attention and resumes the shared heartbeat

### Requirement: Refresh coverage is unified with manual Run bodies
Experiment documents and all three managed YAML tables, Wiki lists/details and current component dependencies, Reports, Run lists and other metadata resources SHALL use one resource polling lifecycle. Results-specific refresh timers SHALL be removed. Run README bodies SHALL load initially and through manual refresh only, not on heartbeat, focus or parent-list invalidation.

All collection GET/HEAD requests SHALL be classified as automatic on both client and server, including navigation, tab counts, main-content lists, and link-resolution inventories. Manual/focus resource pulses SHALL exclude collection queries; automatic heartbeats MAY continue refreshing them. An existing in-flight batch remains shared rather than being duplicated or having its collection requests promoted. Mutations SHALL retain write priority. This policy SHALL NOT introduce a second result cache or change primitive-cache TTLs or independent Git-status polling.

#### Scenario: Results changes
- **WHEN** results.yaml changes while the experiment page is active
- **THEN** the common resource refresh updates the table without an independent table timer

#### Scenario: Run list changes
- **WHEN** a Run status changes while its body is open
- **THEN** the list may update but the displayed Run body remains unchanged until manual refresh

### Requirement: Resource updates preserve user state
The client SHALL apply only current-page, non-obsolete responses, preserve scroll/expansion/table interaction state, and never overwrite unsaved editor text. A changed rendered content batch SHALL show one small update notification; first load and status-only changes SHALL not.

#### Scenario: Old response arrives
- **WHEN** a response from a previous page or older resource generation arrives
- **THEN** it is ignored rather than replacing newer content

#### Scenario: Unsaved editor
- **WHEN** new filesystem content is observed while an editor has local changes
- **THEN** the editor buffer is preserved and conflict/update state is shown

### Requirement: Hydrated resources register attention without duplicate content fetches
Production SSR and browser hydration SHALL share resource versions and avoid duplicate initial content fetches. Page-open attention SHALL be registered once without requiring a duplicate payload request. Subsequent visible-and-focused heartbeats SHALL query semantic versions through the common resource protocol, replacing independent per-query document timers.

#### Scenario: Hydrated page
- **WHEN** a page hydrates a prefetched resource
- **THEN** content renders without duplicate initial payload fetch and a single attention lifecycle starts

#### Scenario: Version changed
- **WHEN** a later heartbeat reports a different semantic version
- **THEN** the client obtains or applies the returned new resource data
