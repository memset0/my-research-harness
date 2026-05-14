# web-layout Specification

## Purpose
TBD - created by archiving change add-sidebar-and-log-tools. Update Purpose after archive.
## Requirements
### Requirement: shadcn Sidebar as primary project navigation

The dashboard SHALL use shadcn/ui's `Sidebar` family of components as its primary navigation container on desktop viewports, replacing the current top-bar project tabs. The Sidebar SHALL list every project from the resolved config.

#### Scenario: All projects visible
- **WHEN** the dashboard loads with N projects configured
- **THEN** the sidebar shows N collapsible groups, one per project, in config-declared order

#### Scenario: Sidebar collapses on narrow viewports
- **WHEN** the viewport width drops below the shadcn `Sidebar` mobile breakpoint (~768px)
- **THEN** the sidebar collapses behind a `<SidebarTrigger>` (hamburger) button placed in the AppBar; tapping the trigger slides the sidebar in as a drawer overlay

### Requirement: Per-project collapsed-by-default with on-demand run list

Each project group in the sidebar SHALL be collapsed by default.
Clicking the project's header SHALL toggle expansion. When expanded,
the group SHALL display the project's most recent **at most 5
experiments**, each as a clickable row that navigates to
`/p/<project>/e/<exp-id>`.

The expanded group SHALL render **exactly one** sub-section under the
project header — the experiments list. The sidebar SHALL NOT render a
separate `Runs` sub-section under any project group, and SHALL NOT
show a separate "All Runs" entry anywhere in the sidebar. Runs are
reachable only through their parent experiment page (or the orphan
cards on the project list page).

The experiment list SHALL be sorted by `effectiveUpdatedAt`
descending so the most recently active experiment appears at the top.
This matches the default order on the `Experiments` list page
(`experiment-card-grid.tsx`); the two surfaces SHALL stay in sync on
sort key and direction.

The expanded group MAY omit a sub-section heading label (e.g. an
uppercase "Experiments" caption above the list) since there is only
one sub-section per project group; the project group header itself
provides sufficient context.

The per-project counter badge in the sidebar SHALL show the number of
**experiments** in that project (not the number of runs).

Each rendered experiment row MAY display a small right-aligned badge
with the count of runs bound to that experiment (`runs.length`). The
badge is a passive number — it is not a separate clickable target.

#### Scenario: Initial load
- **WHEN** the user opens the dashboard for the first time (no prior
  expanded state)
- **THEN** every project group is collapsed; no experiment rows are
  rendered in the sidebar

#### Scenario: Click to expand shows experiments not runs
- **WHEN** the user clicks a project header
- **THEN** the project expands and shows up to 5 experiment rows; each
  row's link target is `/p/<project>/e/<exp-id>` (NOT a run dir)

#### Scenario: Counter badge reflects experiment count
- **GIVEN** a project with 12 experiments containing 47 runs total
- **WHEN** the sidebar renders
- **THEN** the project's counter badge shows `12` (not `47`)

#### Scenario: No Runs sub-section is rendered when expanded
- **WHEN** the user expands a project that has both v3 exp docs and
  legacy run dirs
- **THEN** the sidebar group renders the experiments list and nothing
  else under that project header — no `Runs` caption, no run rows, no
  link to a per-run URL

#### Scenario: Experiments rendered in `effectiveUpdatedAt`-descending order
- **GIVEN** a project with three exp docs A, B, C whose
  `effectiveUpdatedAt` are
  `2026-05-04T10:00:00+08:00` (A), `2026-05-06T08:00:00+08:00` (B),
  `2026-05-05T15:00:00+08:00` (C)
- **WHEN** the user expands the project's group
- **THEN** the rendered row order is B, C, A (top to bottom) — newest
  first, matching the default sort on the experiments list page

### Requirement: "View more" temporary expansion past 5 runs

The sidebar SHALL provide a non-persistent "View more" affordance for
projects with more than 5 experiments. When a project has more than 5
experiments and is expanded, the sidebar SHALL render a `View more`
link below the 5 visible rows. Clicking the link SHALL temporarily
reveal all the project's experiments inside the sidebar group; the
expansion is NOT persisted across reloads.

When the link is in its "all visible" state, its label SHALL change
to `Show fewer`; clicking it SHALL collapse back to the first 5 rows.

The 5-row cap and the "View more" affordance apply equally to
projects whose experiments exceed 5; pagination is independent of the
sort key (which is `effectiveUpdatedAt` descending per the previous
requirement).

#### Scenario: Show all rows
- **WHEN** a project with 12 experiments is expanded and the user
  clicks `View more`
- **THEN** the sidebar group renders all 12 experiment rows in place;
  the `View more` link is replaced by `Show fewer`

#### Scenario: Reset on reload
- **WHEN** the user reloads the page after clicking `View more`
- **THEN** the project group still expands to only 5 rows again

#### Scenario: View more preserves descending sort
- **GIVEN** a project with 12 experiments expanded; the user clicks
  `View more`
- **THEN** all 12 rows are rendered top-to-bottom in
  `effectiveUpdatedAt`-descending order — the newer 5 still appear
  above the older 7

### Requirement: Sidebar expansion state persistence

The set of currently-expanded project groups SHALL persist across reloads via `localStorage` under key `memon:sidebar:expanded` (a JSON array of project names).

#### Scenario: Persistence across reload
- **WHEN** the user expands `project-a` and `project-c`, then reloads
- **THEN** `project-a` and `project-c` are still expanded after reload; `project-b` is still collapsed

#### Scenario: Stale entries
- **WHEN** the localStorage value contains a project name that is no longer in the config
- **THEN** the stale name is silently ignored (and pruned on next save)

### Requirement: Active highlight tracks URL

The sidebar SHALL visually highlight:
- The currently-active **project** (matching the URL's `[project]`
  segment), regardless of expansion state
- The currently-active **experiment** (matching the URL's exp id when
  on `/p/<project>/e/<exp-id>` or `/p/<project>/e/<exp-id>?run=...`
  routes), only when its project is expanded

#### Scenario: On exp detail page
- **WHEN** the URL is `/p/project-a/e/E0001-foo` or
  `/p/project-a/e/E0001-foo?run=bar-260501-100000`
- **THEN** the `project-a` group header has the "active project"
  treatment AND, if `project-a` is expanded, the `E0001-foo` row has
  the "active row" treatment

### Requirement: Top AppBar with view tab switcher

The dashboard SHALL render a sticky **AppBar** above the main content area containing:
- The memon brand on the left
- A `Tabs`-style switcher for `Experiments` / `Hypotheses` / `Journal` / `Reports` / `Digests`, scoped to the current project, in that left-to-right order
- A `+ New experiment` action on the right

#### Scenario: Tab navigation
- **WHEN** the user is on `/p/project-a/experiments/foo-260501-100000` and clicks the `Hypotheses` tab in the AppBar
- **THEN** the URL updates to `/p/project-a/hypotheses`; the AppBar's `Hypotheses` tab is now active

#### Scenario: New experiment from AppBar
- **WHEN** the user clicks `+ New experiment` while on any view of `project-a`
- **THEN** the existing new-experiment modal opens with `project-a` pre-selected

#### Scenario: Reports tab navigates to inbox
- **WHEN** the user clicks the `Reports` tab from any per-project view
- **THEN** the URL updates to `/p/<project>/reports`; the AppBar's `Reports` tab is active and the inbox shell renders

#### Scenario: Digests tab navigates to inbox
- **WHEN** the user clicks the `Digests` tab from any per-project view
- **THEN** the URL updates to `/p/<project>/digests`; the AppBar's `Digests` tab is active and the inbox shell renders

### Requirement: Existing routes continue working unchanged

The pre-existing v2 URL routes SHALL be preserved or redirected. The URL
structure `/p/[project]`, `/p/[project]/hypotheses`,
`/p/[project]/journal`, `/p/[project]/reports[/<id>]`, and
`/p/[project]/digests[/<id>]` SHALL be preserved.

The new route `/p/[project]/e/[exp-id]` is added for experiment detail.

The legacy route `/p/[project]/experiments/[run-dir]` SHALL respond
with a redirect to `/p/[project]/e/<E-id-of-parent>?run=<run-dir>` per
`web-dashboard`'s redirect requirement.

#### Scenario: Direct exp URL navigation
- **WHEN** the user types `/p/project-a/e/E0001-foo` directly into the
  address bar
- **THEN** the experiment detail view renders at that URL

#### Scenario: Legacy run URL redirects
- **WHEN** the user types `/p/project-a/experiments/bar-260501-100000`
- **THEN** the URL is rewritten to
  `/p/project-a/e/<exp-of-bar>?run=bar-260501-100000`

<!-- The v2 requirements `Per-project collapsed-by-default with on-demand
run list` and `"View more" temporary expansion past 5 runs` are NOT
removed; they are MODIFIED in-place above to switch from "5 runs" to
"5 experiments" navigation semantics. -->

### Requirement: shadcn primitives replace hand-rolled UI components

The repo SHALL adopt shadcn/ui versions of `Button`, `Card`, `Badge`, `Dialog`, `Tabs`, `Tooltip`, `Collapsible`, `DropdownMenu`, `ScrollArea`, `Separator`, and `Sidebar`. The previous hand-rolled components in `components/ui.tsx` SHALL be replaced or re-exported from the new files so that import paths remain stable.

#### Scenario: No breaking import changes
- **WHEN** other components (e.g. `experiment-list.tsx`) `import { Button, Card, Badge, StatusPill } from './ui'`
- **THEN** those imports continue to resolve without code changes; the underlying implementation is now backed by shadcn

#### Scenario: Manual install (not interactive)
- **WHEN** adding shadcn components to the repo
- **THEN** component sources are committed directly under `apps/web/components/ui/*.tsx` (NOT installed via interactive `shadcn init` which has previously failed in this environment)

### Requirement: Typography size convention

Within content areas (cards, list rows, journal entries, log meta), all field **values** SHALL render at `text-xs` (~12px). Field **labels** (the small uppercase captions like `name`, `project`, `created`) SHALL render at `text-[10px] uppercase tracking-wide`. Card titles, page titles, and section headings keep their default shadcn sizes (`CardTitle` defaults, `text-base`, `text-lg`, `text-xl`).

The intent is a stable visual hierarchy — tiny label → small value → medium-large title — that scans densely without looking uneven. The previous mix of `font-mono text-sm` for some Field values and `text-xs` for others (timestamps, command code, artifact paths) made fields visibly stair-step in the same row.

#### Scenario: Experiment detail meta grid
- **WHEN** rendering the experiment-detail meta card with name / project / created / finished / host / pid / gpus / entry / command / wandb / tags / hypotheses
- **THEN** every value cell uses `text-xs`; labels use `text-[10px] uppercase tracking-wide text-muted-foreground`; visual hierarchy is uniform across rows

#### Scenario: Experiment list row cells
- **WHEN** rendering an experiment row in the list view (id / name / created / tags / hypotheses)
- **THEN** all cell values use `text-xs`

#### Scenario: Journal event row cells
- **WHEN** rendering a journal event row (timestamp / tag / experiment-id + body)
- **THEN** all cell values use `text-xs`

### Requirement: Status display uses colored Badge with lucide icon

Run status (`PENDING` / `RUNNING` / `FINISHED` / `INTERRUPTED` / `FAILED` / `UNKNOWN`), experiment-doc status (`OPEN` / `RESOLVED` / `ABANDONED`), and hypothesis status (`CONFIRMED` / `REFUTED` / `PARTIAL` / `OPEN` / `DEFERRED`) SHALL render in the UI as a `<Badge variant="outline">` with a `lucide-react` icon plus the enum string. The on-disk `docs/journal.md` / `docs/hypotheses.md` / `README.md` / experiment-doc files continue to use the canonical emoji per the parsing spec; the **emoji is never shown in the rendered UI**.

Run-status color and icon mapping:

| Status | Badge color (Tailwind / shadcn) | Lucide icon |
|---|---|---|
| `PENDING` | `bg-muted text-muted-foreground border-border` (neutral gray) | `Circle` |
| `RUNNING` | `bg-sky-100 text-sky-800 border-sky-300` (blue) | `Loader2` (spinning) |
| `FINISHED` | `bg-emerald-100 text-emerald-800 border-emerald-300` (green) | `CheckCircle2` |
| `INTERRUPTED` | `bg-amber-100 text-amber-800 border-amber-300` (yellow / amber) | `PauseCircle` |
| `FAILED` | `bg-red-100 text-red-800 border-red-300` (red) | `XCircle` |
| `UNKNOWN` | `bg-rose-50 text-rose-900 border-rose-200` (deeper / muted-red, distinct from `FAILED`) | `HelpCircle` |

`UNKNOWN` SHALL render in a deeper / muted-red tone (the rose family) so it is visually separable from `FAILED` (the red family) at-a-glance, while still reading as "needs attention" rather than "neutral."

ExperimentStatus color and icon mapping:

| Status | Badge color | Lucide icon |
|---|---|---|
| `OPEN` | `bg-sky-100 text-sky-800 border-sky-300` (blue, mirrors `RUNNING`'s family) | `CircleDot` |
| `RESOLVED` | `bg-emerald-100 text-emerald-800 border-emerald-300` (green) | `CheckCircle2` |
| `ABANDONED` | `bg-stone-100 text-stone-800 border-stone-300` (warm gray) | `XCircle` |

Each status SHALL be composed via `cn()` over shadcn `Badge` (never by forking `badge.tsx`). Hypothesis-status mapping is unchanged from the prior version of this requirement.

Stale-RUNNING marker SHALL render as a `lucide-react AlertTriangle` icon next to (or inside) the badge — not the ⚠ emoji.

Archived items (per `archive-frontmatter`'s "Visual treatment of archived items") SHALL render their status pill in a desaturated variant of the same color family (e.g. `bg-emerald-50 text-emerald-600 border-emerald-200` for `RESOLVED`-archived in place of the active variant), prefixed by a `lucide Archive` icon.

#### Scenario: Run status pill — PENDING
- **WHEN** rendering a run with status PENDING
- **THEN** the pill shows a `Circle` icon + the text `PENDING` on a neutral-gray Badge

#### Scenario: Run status pill — RUNNING
- **WHEN** rendering a run with status RUNNING
- **THEN** the pill shows a spinning `Loader2` icon + the text `RUNNING` on a sky-tinted Badge; the text `🟢` does not appear in the DOM

#### Scenario: Run status pill — FINISHED
- **WHEN** rendering a run with status FINISHED
- **THEN** the pill shows a `CheckCircle2` icon + the text `FINISHED` on an emerald Badge

#### Scenario: Run status pill — INTERRUPTED
- **WHEN** rendering a run with status INTERRUPTED
- **THEN** the pill shows a `PauseCircle` icon + the text `INTERRUPTED` on an amber Badge; the text `⏸` does not appear in the DOM

#### Scenario: Run status pill — FAILED
- **WHEN** rendering a run with status FAILED
- **THEN** the pill shows an `XCircle` icon + the text `FAILED` on a red Badge

#### Scenario: Run status pill — UNKNOWN distinct from FAILED
- **WHEN** rendering a run with status UNKNOWN
- **THEN** the pill shows a `HelpCircle` icon + the text `UNKNOWN` on a rose Badge (deeper / muted-red)
- **AND** the badge color resolves to a different oklch() value than the FAILED pill on the same page

#### Scenario: Stale-RUNNING marker
- **WHEN** the experiment status is RUNNING and `stale` is true (no directory activity for >1h)
- **THEN** an `AlertTriangle` lucide icon is rendered immediately adjacent to the badge in an amber color; the text `⚠` does not appear in the DOM

#### Scenario: Hypothesis status pill
- **WHEN** rendering a hypothesis card with status PARTIAL
- **THEN** the pill shows a `CircleDot` icon + the text `PARTIAL` on an amber-tinted Badge; the text `🟡` does not appear in the DOM

#### Scenario: Experiment status pill — OPEN
- **WHEN** rendering an experiment card with status OPEN
- **THEN** the pill shows a `CircleDot` icon + the text `OPEN` on a sky Badge
- **AND** if a sibling RUNNING run pill is on the same page, the OPEN exp pill and the RUNNING run pill share the sky color family but are distinguishable by icon (`CircleDot` vs spinning `Loader2`) and label

#### Scenario: Experiment status pill — RESOLVED
- **WHEN** rendering an experiment card with status RESOLVED
- **THEN** the pill shows a `CheckCircle2` icon + the text `RESOLVED` on an emerald Badge

#### Scenario: Experiment status pill — ABANDONED
- **WHEN** rendering an experiment card with status ABANDONED
- **THEN** the pill shows an `XCircle` icon + the text `ABANDONED` on a stone-gray Badge
- **AND** the gray reads as "moved on," not as an error (the red color is reserved for FAILED runs)

#### Scenario: Archived overlay desaturates the status pill
- **WHEN** rendering any item with `archived: true` (run or exp)
- **THEN** the status pill SHALL render in the desaturated variant of its color family (e.g. `bg-emerald-50` instead of `bg-emerald-100` for a RESOLVED-archived exp)
- **AND** a `lucide Archive` icon prefixes the status pill in the same Badge

### Requirement: Hypothesis summary uses structured tags, not raw markdown

The hypothesis summary table at the top of `/p/<project>/hypotheses` SHALL be rendered as a structured component (one row per parsed `HypothesisEntry`) with columns `id` / `status` / `statement` / `experiments`. The `status` cell SHALL use `<HypothesisStatusPill>` (not the raw emoji from disk). Each `experiment` cell SHALL render the experiment id as a Next.js `<Link>` to `/p/<project>/experiments/<id>`. The raw `summaryTableBlock` from `docs/hypotheses.md` is NOT rendered as markdown in the UI.

#### Scenario: Summary row with multiple experiments
- **WHEN** a hypothesis is associated with `foo-260501-100000` and `bar-260502-150000`
- **THEN** the summary row shows both ids as Next.js `<Link>` elements; clicking either navigates client-side (no full page reload) to that experiment

### Requirement: SPA-style cross-page navigation between experiments and hypotheses

All cross-resource links (experiment → hypothesis, hypothesis → experiment, summary table → experiment, in-page TOC) SHALL use Next.js `<Link>` so navigation occurs without a full browser reload. Hash-only navigation (`#H<NNNN>`, `#motivation`) SHALL preserve the SPA boundary AND the browser SHALL scroll the target into view.

The hypothesis card anchor SHALL use the canonical padded id form: `<Card id="H0001">`. Cross-resource links SHALL emit the padded form. The web app SHALL NOT carry a client-side fallback for unpadded fragments — strict format everywhere.

#### Scenario: Click a hypothesis ref from experiment detail
- **WHEN** an experiment's `hypotheses` field lists `H0001` and the user clicks the `H0001` badge
- **THEN** the URL becomes `/p/<project>/hypotheses#H0001`, the navigation is client-side (no white flash / full reload), and the page scrolls so `<Card id="H0001">` is in view

#### Scenario: Click an experiment ref from hypothesis summary
- **WHEN** the summary row for `H0001` shows `foo-260501-100000` and the user clicks it
- **THEN** the URL becomes `/p/<project>/experiments/foo-260501-100000` via Next `<Link>` (no full reload)

### Requirement: Anchor ids for deep linking into experiment sections

Each section card on the experiment detail page (Motivation / Setup / Method / Result / Conclusion / Caveats / Artifacts / New Hypotheses / Resources) SHALL render with an `id` attribute matching the section name in lowercase kebab-case (`motivation`, `setup`, `method`, `result`, `conclusion`, `caveats`, `artifacts`, `new-hypotheses`, `resources`). This enables permalinks like `/p/<project>/experiments/<id>#method`.

Hypothesis cards on the hypotheses page SHALL render with an `id` attribute matching the hypothesis's canonical padded id (e.g. `<Card id="H0003">`).

#### Scenario: Permalink to a section
- **WHEN** the user pastes `/p/project-a/experiments/foo-260501-100000#method` into a new tab
- **THEN** the page loads and scrolls so the `Method` card is in view

#### Scenario: Permalink to a hypothesis card
- **WHEN** the user pastes `/p/project-a/hypotheses#H0003` into a new tab
- **THEN** the page loads and scrolls so the `<Card id="H0003">` for hypothesis H0003 is in view

### Requirement: Experiment list columns and density

The experiment list table SHALL render the following columns in this order: `id` (col-span-3, truncating run-directory name) / `status` (col-span-2, `StatusPill`) / `created` (col-span-2, `TimestampLocal`) / `updated` (col-span-2, `TimestampLocal` of `exp.mtime`) / `tags` (col-span-1) / `hypotheses` (col-span-2). The `name` column from the previous design is dropped — the front-matter `name` is redundant with the run-directory `id` and added visual noise without value.

Rows SHALL be visually compact — `px-3 py-1.5` on the inner grid (no nested `Card` padding), so a row at 12px text height occupies roughly 28–32px total height. Rows DO NOT use `<Card>` (which carries its own `py-4` padding); they use a plain bordered `<Link>` styled as `rounded-md border bg-card`.

#### Scenario: Updated column reflects file mtime
- **WHEN** an experiment's directory has `mtime` 2026-05-03 10:30
- **THEN** the row's `updated` column renders `2026-05-03 10:30` (formatted by `TimestampLocal`)

#### Scenario: Row density
- **WHEN** the experiment list shows 10 rows on a 1080p viewport
- **THEN** all 10 rows fit comfortably in the visible area without padding-induced wasted vertical space; an individual row is ≤ 36px tall

### Requirement: Page background distinct from card background

In the light theme, `--background` SHALL render slightly off-white (target lightness ≈ 0.97 in oklch) while `--card` remains pure white (lightness 1.0). The result: cards visually float on top of the page bg without needing a heavy shadow. In the dark theme, the existing `--background` (~0.148) and `--card` (~0.218) already provide adequate separation.

#### Scenario: Light theme card pop
- **WHEN** the dashboard is rendered in light mode
- **THEN** a `<Card>` placed inside a `bg-background` page area is visibly distinct from its surroundings (its white surface contrasts with the off-white background)

### Requirement: Top navigation progress bar

The dashboard SHALL render a global, fixed-position progress bar across the very top of the viewport that becomes visible whenever an App-Router soft navigation is in flight, providing immediate feedback that the user's click was registered. The bar SHALL be mounted once at the root layout (alongside the existing `<Toaster />`), be `pointer-events: none`, and be visually layered above all page content (z-index higher than the AppBar, lower than toasts).

The filled portion of the bar SHALL use the project's `--primary` theme color (bound via a CSS override on the bar's selector, not via a hard-coded color in JS); the unfilled portion SHALL be fully transparent (no track, no background fill, no shadow / peg). The bar SHALL be approximately 2 px tall.

The bar SHALL run an **indeterminate** animation curve (no real progress measurement): it SHALL grow rapidly on start, decelerate toward ~90 %, snap to 100 % when the new route commits, then fade out and reset.

The bar SHALL trigger on every App-Router soft-navigation path: `<Link>` clicks, programmatic `router.push` / `router.replace`, and browser back/forward. The bar SHALL NOT trigger on hash-only navigation, on clicks that open in a new tab/window (modifier-key clicks, `target="_blank"`, non-primary mouse button), or on external-origin clicks.

#### Scenario: Soft navigation via Link click
- **WHEN** the user clicks a `<Link>` whose destination differs from the current pathname or search string, with no modifier keys and primary mouse button
- **THEN** within ≤50 ms the top progress bar appears and begins crawling toward the right edge using the `--primary` token

#### Scenario: Soft navigation via programmatic router
- **WHEN** code calls `router.push(href)` or `router.replace(href)` with a different destination
- **THEN** the bar appears and crawls in the same way as a `<Link>` click

#### Scenario: Browser back / forward
- **WHEN** the user presses the browser back or forward button to a different route
- **THEN** the bar appears and crawls until the destination route commits

#### Scenario: Navigation settles
- **WHEN** the App Router commits the new segment
- **THEN** the bar snaps to 100 %, fades out, and resets to its idle (invisible) state

#### Scenario: Modifier-key / non-primary-button click does not start the bar
- **WHEN** the user clicks a link while holding `Cmd`, `Ctrl`, `Shift`, or `Alt`, OR clicks with a non-primary mouse button, OR the link has `target="_blank"`
- **THEN** the bar does NOT appear (the click opens in a new tab/window; there is no in-page navigation to report)

#### Scenario: External link does not start the bar
- **WHEN** the user clicks an `<a>` whose `href` resolves to a different origin than `window.location.origin`
- **THEN** the bar does NOT appear (the page is leaving anyway; the browser's native loading indicator covers it)

#### Scenario: Hash-only / same-URL click does not start the bar
- **WHEN** the user clicks a link whose only difference from the current URL is the hash fragment, OR whose pathname and search exactly match the current URL
- **THEN** the bar does NOT appear (no fetch will occur)

#### Scenario: Theme color follows the `--primary` token
- **WHEN** the dashboard's `--primary` CSS variable is changed (e.g., light → dark mode)
- **THEN** the bar's filled color tracks the new value on its next render — no hard-coded hex / oklch in the JS or in any inline style overriding the token

### Requirement: Inbox layout shell as a reusable per-project page shape

The dashboard SHALL provide a reusable inbox-shell component used by Reports, Digests, and any future per-project page that browses a directory of markdown artifacts. The component SHALL accept the artifact `kind`, the project name, and a list of items as props, and SHALL render the desktop and mobile layouts described in the `inbox-viewer` capability. Per-kind copy (the empty-state message, the URL prefix used for navigation) SHALL come from props, not from internal switches.

#### Scenario: Both Reports and Digests routes use the same shell
- **WHEN** comparing the rendered DOM of `/p/<proj>/reports` and `/p/<proj>/digests` on disk-empty fixtures
- **THEN** the layout structure is identical (same left rail width, same right pane area, same FAB position) and only the empty-state copy + URL prefix differ

### Requirement: AppBar tab count badges reflect view-specific data

Each tab in the AppBar SHALL render a small count badge next to the
label whose value MUST match the data shown on that tab's view in the
current project. Specifically:

- The `Experiments` tab badge SHALL show the number of **experiment
  docs** in the project (the data behind `GET /api/experiments`,
  TanStack key `['experiments', project]`). It SHALL NOT show the
  number of runs.
- The `Hypotheses` tab badge SHALL show the number of hypothesis
  entries.
- The `Journal` tab badge SHALL show the project's total event count.
- The `Reports` tab badge SHALL show the number of reports.
- The `Digests` tab badge SHALL show the number of digests.

Each badge SHALL render a skeleton placeholder while its query is
still loading (to avoid the flash of `0`), and SHALL re-render with
the new value when its TanStack cache is invalidated by a relevant
SSE topic (`experiment-change` for the Experiments tab,
`run-change` for downstream effects on exp memberships, etc.).

#### Scenario: Experiments badge counts exp docs, not runs
- **GIVEN** a project with 12 exp docs and 47 runs
- **WHEN** the AppBar renders
- **THEN** the `Experiments` tab badge shows `12` (not `47`)

#### Scenario: Badge updates when an exp doc is created
- **GIVEN** the AppBar shows `Experiments 12`
- **WHEN** a new exp doc is created (via CLI, web POST, or an external
  edit) and the SSE `experiment-change` topic fires
- **THEN** the badge re-renders to `13` without a full page reload

#### Scenario: Loading state shows skeleton, not zero
- **WHEN** the AppBar mounts and the `['experiments', project]` query
  has not yet resolved
- **THEN** the badge renders a skeleton placeholder span (not the
  literal text `0`)

### Requirement: AppBar Experiments tab active-route coverage

The AppBar's `Experiments` tab SHALL render in its active visual
state on every URL where the user is semantically inside the
experiments view of the current project. The set of matching URLs
under `/p/<project>/` SHALL include:

- The bare project root (`/p/<project>` and trailing-slash variants).
- The v3 exp-doc detail route `/p/<project>/e/<exp-id>` (with or
  without the `?run=<run-dir>` query string).
- The legacy v2 detail route `/p/<project>/experiments/<run-id>`.
- The legacy run URL `/p/<project>/r/<run-id>` (which itself
  permanent-redirects to the v3 `/e/<exp-id>` URL — during the
  redirect the matcher SHALL still treat the URL as active so the
  highlight does not flicker off).

The matcher SHALL NOT be naive prefix-matching that produces false
positives on sibling segments (e.g. it must distinguish
`/p/<project>/e/<id>` from a hypothetical `/p/<project>/eats`).

#### Scenario: Active on v3 exp-doc detail
- **WHEN** the user navigates to `/p/project-a/e/E0001-foo`
- **THEN** the AppBar's `Experiments` tab is rendered in the active
  state (using shadcn's `default` button variant), and `aria-selected`
  on the tab link is `true`

#### Scenario: Active on v3 exp-doc detail with auto-expanded run
- **WHEN** the user navigates to
  `/p/project-a/e/E0001-foo?run=foo-260501-100000`
- **THEN** the AppBar's `Experiments` tab is rendered in the active
  state

#### Scenario: Active on legacy v2 detail URL
- **WHEN** the user navigates to
  `/p/project-a/experiments/foo-260501-100000`
- **THEN** the AppBar's `Experiments` tab is rendered in the active
  state

#### Scenario: Active on bare project root
- **WHEN** the user navigates to `/p/project-a`
- **THEN** the AppBar's `Experiments` tab is rendered in the active
  state

#### Scenario: Not active on hypotheses route
- **WHEN** the user navigates to `/p/project-a/hypotheses`
- **THEN** the AppBar's `Experiments` tab is NOT in the active state;
  the `Hypotheses` tab is

#### Scenario: Not active on reports route
- **WHEN** the user navigates to `/p/project-a/reports`
- **THEN** the AppBar's `Experiments` tab is NOT in the active state;
  the `Reports` tab is

### Requirement: AppBar tabs wrap on narrow viewports

The AppBar tab list SHALL wrap onto additional rows inside the
AppBar when it cannot fit on a single row (typical on phone-width
viewports), instead of overflowing the viewport horizontally. The
AppBar's height SHALL grow to fit the wrapped row count; on
single-row layouts the AppBar SHALL retain its standard 48px floor
(`min-h-12`).

The `SidebarTrigger` SHALL remain vertically centered relative to
the (potentially multi-row) tab block, achieved via the AppBar
container's `items-center` and the trigger's intrinsic single-row
height.

The page body SHALL NOT gain a horizontal scrollbar as a result of
the tab list overflowing. (The pre-existing avoidance of
`overflow-x-auto` on the nav stays — that comment in
`app-bar.tsx` documents why.)

#### Scenario: Tabs wrap to a second row on a narrow viewport
- **GIVEN** a viewport whose width is too small to fit all tabs
  on one row alongside the sidebar trigger
- **WHEN** the AppBar renders
- **THEN** the tab list element carries the `flex-wrap` class and
  the tabs flow onto two or more rows
- **AND** the AppBar header's height has grown to accommodate the
  rows (it is no longer fixed at 48px)
- **AND** the document body has no horizontal scroll

#### Scenario: Single-row layout keeps 48px floor
- **GIVEN** a viewport wide enough for all tabs to fit on one row
- **WHEN** the AppBar renders
- **THEN** the AppBar header is 48px tall (no growth from the
  base `min-h-12`)

#### Scenario: SidebarTrigger stays vertically centered
- **GIVEN** the AppBar has wrapped its tabs onto two rows
- **WHEN** the AppBar renders
- **THEN** the `SidebarTrigger` button is vertically centered
  within the AppBar (its center aligns with the midpoint of the
  multi-row tab block, NOT with the top row's midpoint)

### Requirement: Sidebar footer with link to tmux management page

The `AppSidebar` component SHALL render a `<SidebarFooter>` containing a `<SidebarMenu>` with at least one item: a link to `/manage/tmux` (the new top-level cross-project tmux management page from the `tmux-session-management` capability).

The link SHALL use a `<SidebarMenuButton size="sm" asChild>` wrapping a Next.js `<Link href="/manage/tmux">` whose children are a lucide `Terminal` icon (`size-4`) and the text label `Manage tmux`.

The footer SHALL be visually distinct from the per-project Collapsible groups in `<SidebarContent>`, but follow shadcn's standard `SidebarFooter` styling (no custom backgrounds or borders). When the page route equals `/manage/tmux` the link SHALL render with `isActive` styling (per the existing active-highlight requirement).

The footer area MAY contain additional siblings of the Manage tmux item that surface owner-only status / management affordances. v2 adds one such sibling: the **Slurm status widget** (capability `slurm-status`), mounted above the Manage tmux item, rendered only when `Config.slurm.totalNodes !== -1` AND `role !== 'viewer'`. When the Slurm feature is disabled by config (`total_nodes === -1`) the widget SHALL render nothing — the footer in that case is visually identical to v1.

The footer area SHALL remain reserved for future `/manage/<other>` siblings and other host-level status indicators.

#### Scenario: Sidebar shows the manage-tmux link in the footer
- **WHEN** the dashboard is rendered on a project page
- **THEN** the bottom of the sidebar shows a row with the `Terminal` icon and the label "Manage tmux"
- **AND** clicking the row navigates to `/manage/tmux`

#### Scenario: Active highlight on /manage/tmux
- **GIVEN** the current route is `/manage/tmux`
- **WHEN** the sidebar renders
- **THEN** the "Manage tmux" footer link has `data-active="true"` (the shadcn isActive style)

#### Scenario: Empty projects list still shows the footer
- **GIVEN** `runtime.config.projects` is empty (so `<SidebarContent>` shows "No projects configured")
- **THEN** the footer with the manage-tmux link is still visible

#### Scenario: Slurm widget mounts above Manage tmux when enabled
- **GIVEN** `Config.slurm.totalNodes === 8` and `role === 'owner'`
- **WHEN** the sidebar renders
- **THEN** the SidebarFooter contains two items: the Slurm status widget row (top), and the Manage tmux link (bottom)

#### Scenario: Slurm widget absent when disabled
- **GIVEN** `Config.slurm.totalNodes === -1`
- **WHEN** the sidebar renders
- **THEN** the SidebarFooter contains only the Manage tmux link; no Slurm row

### Requirement: AppSidebar visible on /manage/* pages

The dashboard SHALL render the `AppSidebar` (the same component that
appears under `/p/<project>/*` routes) on every page under the
`/manage/` prefix. This is achieved via a layout file at
`apps/web/app/manage/layout.tsx` that wraps `children` with
`<SidebarProvider>` + `<AppSidebar>` + `<SidebarInset>`.

The `/manage/*` layout SHALL NOT mount `<AppBar>` — AppBar is
project-scoped (its tabs target a single project) and does not apply
to cross-project pages.

The active-highlight on the sidebar's `Manage tmux` footer link
(already wired in `app-sidebar.tsx` as
`isActive={pathname === '/manage/tmux'}`) SHALL surface when the user
is on `/manage/tmux`, because the sidebar is now rendered there.

#### Scenario: Sidebar visible on /manage/tmux
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the left sidebar is visible (with the same project tree as
  on `/p/<project>/*` routes)
- **AND** the `Manage tmux` footer link in the sidebar has
  `data-active="true"` (the shadcn isActive style)

#### Scenario: AppBar absent on /manage/*
- **WHEN** the user is on `/manage/tmux`
- **THEN** no `<AppBar>` renders above the page content (no project
  tabs)

#### Scenario: Project list SSR-prefetched
- **WHEN** the `/manage/tmux` page server-renders
- **THEN** the response HTML contains the project names from
  `runtime.config.projects` inside the sidebar markup (no
  "No projects configured" flash on first paint)
