## ADDED Requirements

### Requirement: Single SSE connection from the root layout

The dashboard SHALL open exactly one `EventSource` connection to `/api/events` from the root layout (mounted via `Providers`). All components subscribing to live updates SHALL go through a shared `useMemonEvents()` hook backed by an in-memory event emitter that fans out to React subscribers.

#### Scenario: One connection per tab
- **WHEN** the user opens the dashboard and navigates between list, detail, hypothesis, and journal pages
- **THEN** the browser DevTools network panel shows exactly one open `text/event-stream` request to `/api/events` (no duplicates, no leaked connections after navigation)

#### Scenario: Reconnect on disconnect
- **WHEN** the SSE connection drops (network blip, dev server HMR, server restart)
- **THEN** the browser's native `EventSource` reconnect kicks in within ~3 seconds and the page resumes receiving events without user action

### Requirement: Cache invalidation on experiment-change

The `useMemonEvents()` hook SHALL invalidate TanStack Query caches when an `experiment-change` SSE event arrives. At minimum:
- `['experiments']` (list view)
- `['experiment', evt.id]` (detail view)

#### Scenario: Status change propagates within 1s
- **WHEN** an experiment's status changes on disk (via CLI, agent, or another tab)
- **THEN** within ~1 second, both the list view and any open detail view for that experiment re-render with the new status, without the user clicking refresh

#### Scenario: Toast on remote create
- **WHEN** an `experiment-change` event with `type: 'set'` is received for an experiment id NOT previously in the local cache (i.e., newly discovered)
- **THEN** a `toast.info('New experiment: <id>')` appears for ~3 seconds with a `View` action that navigates to the detail page

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
