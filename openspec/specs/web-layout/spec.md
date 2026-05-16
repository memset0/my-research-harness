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
the group SHALL display **all of the project's active (non-archived)
experiments**, each as a clickable row that navigates to
`/p/<project>/e/<exp-id>`. The list SHALL render inside an internally
scrollable container so long lists do not overflow the section
(the per-row scroll lives in the section's
`<div className="h-full overflow-y-auto">` inside
`<CollapsibleContent>`, fed by the outer grid-row sizing — see the
"CSS Grid row-template" requirement).

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

Each rendered experiment row SHALL render a leading circular
run-count badge as the row's first visual element — see the
"Experiment row leading run-count badge replaces the indent
gutter" requirement for full styling and accessibility. The badge
plays the role the previous transparent indent gutter played
(setting the row's leading column), while also exposing the
`runs.length` count.

#### Scenario: Initial load
- **WHEN** the user opens the dashboard for the first time (no prior
  expanded state)
- **THEN** every project group is collapsed; no experiment rows are
  rendered in the sidebar

#### Scenario: Click to expand shows experiments not runs
- **WHEN** the user clicks a project header
- **THEN** the project expands and shows experiment rows; each
  row's link target is `/p/<project>/e/<exp-id>` (NOT a run dir)

#### Scenario: All active experiments are listed, not just the first 5
- **GIVEN** a project with 12 active (non-archived) experiments
- **WHEN** the user expands the project's group
- **THEN** all 12 experiment rows are rendered inside the section
  body
- **AND** the rendered list scrolls internally (`overflow-y-auto`)
  rather than expanding the sidebar to fit all 12 rows
- **AND** no "View more" or "Show fewer" affordance is rendered

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

#### Scenario: Leading visual is the run-count badge, not a transparent spacer
- **WHEN** a section is expanded
- **THEN** each experiment row's leading element is the circular
  run-count badge (per the "Experiment row leading run-count
  badge" requirement); there is NO transparent
  `<span aria-hidden className="w-6 shrink-0" />` spacer in front
  of the badge

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

### Requirement: Sidebar sections use a VSCode-Explorer-style banner header

Each project group's collapsible header in the sidebar SHALL render
as a single horizontal banner row whose visual identity comes from
its **own background and dividers**, NOT from any expand/collapse
indicator icon. There SHALL be NO chevron, arrow, or similar
glyph in the header; the banner contrast IS the affordance that
distinguishes one project from the next and signals interactivity.

The banner styling on the `<SidebarGroupLabel>` SHALL include, at
minimum, all of:

- A **fixed banner height** of `h-7` (1.75rem = 28px). The height is
  fixed (NOT `h-auto`) so it matches the outer grid-row template's
  `minmax(1.75rem, …)` minimum exactly — closed rows pin at banner
  height with no overflow, and banners NEVER compress when sibling
  sections expand.
- A **tinted background** of `bg-sidebar-accent/60` that visually
  separates the header from the surrounding project body and from
  adjacent sections. (Iterated post-apply: the earlier `/40`
  rendered too pale against the new resting layout; the owner
  requested deeper contrast.)
- A **1px top border AND 1px bottom border** in
  `var(--sidebar-border)` (e.g. `border-y border-sidebar-border`).
- A **hover state** that brightens the background (e.g.
  `hover:bg-sidebar-accent` + `hover:text-sidebar-accent-foreground`)
  to confirm the row is clickable.
- A **negative horizontal margin** of `-mx-2` so the banner extends
  edge-to-edge inside the sidebar column (offsetting the parent
  `<SidebarGroup>`'s `px-2`). The label keeps its own `px-2` so
  text is not flush against the column edges.
- An override of shadcn's default rounded corners via
  `rounded-none` — rounded corners on an edge-to-edge banner read
  as visual debris.
- An override of the native `<button>` default `text-align: center`
  via `text-left` so the project name sits flush-left inside its
  `flex-1` span instead of floating to the row's middle.

The header's two child elements, in left-to-right DOM order, are:

1. The **project name** in uppercase, **one type-size smaller than
   the surrounding body text** (e.g. `text-[10px]` against the
   `text-xs` body), styled `font-semibold uppercase tracking-wider`.
   The span MUST receive `truncate min-w-0 flex-1` so that **when
   horizontal space runs out the project name (not the pill) is
   the one truncated to ellipsis**. The project name span SHALL
   NOT receive `font-mono`.
2. The **right-aligned `<GitStatusPill project={name}
   variant="compact" />`** with `shrink-0` so it never compresses.
   The pill SHALL NOT carry a `max-w-*` cap, an `overflow-hidden`
   override, or any other class that truncates the branch / status
   text. When the project is not a git repo (or git is unavailable),
   the pill renders nothing and the row width SHALL NOT shift.

The entire header row SHALL be the `<CollapsibleTrigger>`; a click
on any non-pill pixel of the row (banner background, name span,
empty space) toggles expand/collapse. A click ON the
`<GitStatusPill>`, however, SHALL NOT propagate to the trigger;
instead it SHALL open a project-scoped `<GitDiffDialog>` (see the
"Click on the git pill opens the diff dialog" scenario below). The
hover-only inline tooltip rendered by the compact pill remains
unchanged; click and hover are independent affordances.

Implementation: the pill is wrapped in a `<span role="button"
tabIndex={0} aria-label="View git diff for <project>">` whose
`onClick`, `onPointerDown`, and `onKeyDown` (Enter / Space)
handlers call `event.preventDefault()` + `event.stopPropagation()`
and invoke a parent-supplied `onPillClick` callback. The
`<GitDiffDialog>` itself is mounted at `<AppSidebar>` level,
keyed by `diffDialogProject` state, so only one dialog instance
exists for the whole sidebar regardless of which project's pill
was clicked.

#### Scenario: Header renders banner background + top/bottom dividers
- **WHEN** a project section's header renders in the sidebar
- **THEN** the `<SidebarGroupLabel>` element's class list includes
  `border-y`, `border-sidebar-border`, and `bg-sidebar-accent/60`
- **AND** the resolved CSS sets `border-top-width: 1px` and
  `border-bottom-width: 1px`, both with color `var(--sidebar-border)`

#### Scenario: Banner is fixed at h-7 with edge-to-edge negative margin
- **WHEN** a project section's header renders
- **THEN** the `<SidebarGroupLabel>` element's class list includes
  `h-7` (NOT `h-auto`)
- **AND** the class list includes `-mx-2` so the banner extends
  edge-to-edge inside the sidebar column
- **AND** the class list includes `rounded-none` and `text-left`
  (overriding shadcn's default `rounded-md` and the native button
  center alignment respectively)

#### Scenario: No expand/collapse indicator glyph is rendered
- **WHEN** a project section's header renders
- **THEN** the trigger element contains NO `<svg>` descendant with
  class `lucide-chevron-down`, `lucide-chevron-right`, or any other
  `lucide-chevron-*` variant — the banner styling alone signals
  expand/collapse state via its contrast against the body

#### Scenario: DOM order is name then pill
- **WHEN** a project section's header renders
- **THEN** the trigger's direct children are exactly two elements,
  in this order: the uppercase project-name span and either the
  bare `GitStatusPill` (`data-slot="git-status-pill-compact"`) for
  non-git projects OR the `<span data-slot="git-status-pill-trigger">`
  wrapper around the pill for git-enabled projects

#### Scenario: Project name is one type-size smaller than body
- **WHEN** the section header renders against a sidebar body using
  `text-xs` (12px) per the shadcn defaults
- **THEN** the project-name span resolves to a smaller computed font
  size (e.g. `text-[10px]` ⇒ 10px), conveying VSCode-style
  small-caps-banner hierarchy

#### Scenario: Project name renders uppercase, not font-mono
- **WHEN** the section header renders
- **THEN** the project-name span's class list resolves to a CSS rule
  that sets `text-transform: uppercase` AND does NOT set
  `font-family: var(--font-mono)` (or any other monospace family)

#### Scenario: Long branch name truncates the project title, not the pill
- **GIVEN** a project whose git pill resolves to a wide payload
  (e.g. branch `feature/very-long-experimental-branch-name` with
  ahead/behind arrows) and a long project name
- **WHEN** the section header renders inside a narrow sidebar
- **THEN** the `<GitStatusPill>` element renders **without** any
  ellipsis or visual clipping of its text content; the pill consumes
  its natural width
- **AND** the project-name span truncates with a CSS ellipsis (the
  `truncate` rule on `min-w-0 flex-1`) so the row width is preserved

#### Scenario: Pill carries shrink-0 and no width cap
- **WHEN** the section header renders
- **THEN** the `<GitStatusPill>` element's class list resolves to
  rules that include `flex-shrink: 0` (e.g. via Tailwind `shrink-0`)
- **AND** the class list does NOT resolve to any rule that sets
  `max-width: *` or `overflow: hidden` on the pill wrapper itself

#### Scenario: Whole row (except pill) remains the click target
- **WHEN** the user clicks any non-pill pixel inside the header row
  (the name span, the empty space between name and pill, the banner
  margins)
- **THEN** the section toggles its expanded state

#### Scenario: Click on the git pill opens the diff dialog without toggling the section
- **GIVEN** the section is currently expanded and the project's git
  pill is rendered with a git-enabled status (so the
  `<span data-slot="git-status-pill-trigger">` wrapper is rendered)
- **WHEN** the user clicks directly on the pill-trigger wrapper
- **THEN** the click event SHALL NOT propagate to the
  `<CollapsibleTrigger>` button — the section remains expanded
- **AND** a `<GitDiffDialog>` element (`data-slot="git-diff-dialog"`)
  is mounted in the document, keyed to this project
- **AND** the dialog surfaces the project's working-tree diff
  (staged / unstaged / untracked files plus per-file diff content)
  via the existing `git-status-files` / `git-diff` API surfaces
- **AND** the hover-only inline `Tooltip` rendered by the compact
  pill remains a separate affordance — hovering still opens the
  tooltip; clicking opens the dialog. They do not conflict.

#### Scenario: Pill click target is keyboard-reachable
- **GIVEN** the section header renders with a git-enabled pill
- **WHEN** the user tabs onto the pill-trigger wrapper and presses
  `Enter` or `Space`
- **THEN** the same `<GitDiffDialog>` opens as on a pointer click
- **AND** the surrounding `<CollapsibleTrigger>` does NOT receive
  the keystroke (the wrapper's `onKeyDown` handler calls
  `preventDefault` + `stopPropagation`)

#### Scenario: Non-git project renders the bare pill (no click target)
- **GIVEN** project B is not a git repo (the
  `['git-status', 'project-B']` query resolves with
  `enabled: false`)
- **WHEN** the project section's header renders
- **THEN** the header's second child is the bare `GitStatusPill`
  (which itself returns `null` for `enabled: false`); NO
  `data-slot="git-status-pill-trigger"` wrapper is rendered
- **AND** clicking anywhere inside the header (since the pill is
  absent) toggles the section like any other header click

#### Scenario: Pill absence does not shift the row
- **GIVEN** project A is a git repo (pill renders) and project B is
  not (pill returns `null`)
- **WHEN** both sections render
- **THEN** the project-name span in each header sits at the same
  horizontal position; only the right-edge pill differs

### Requirement: Sidebar sections use a CSS Grid row-template for multi-expand height distribution

The sidebar's `<SidebarContent>` SHALL be laid out as a CSS Grid
(NOT a flex column) so simultaneously-expanded sections share
height via the grid's row-template, and so the banner of every
closed section is protected by an explicit per-row minimum.

`<SidebarContent>` SHALL apply `!grid !overflow-hidden` to
override the shadcn primitive's default
`flex min-h-0 flex-1 flex-col gap-0 overflow-auto`. The `!`
modifier (Tailwind's `important`) is required because shadcn's
defaults specify `flex` directly on the element and would
otherwise win the cascade.

The element's inline `gridTemplateRows` SHALL be computed from the
current set of expanded project names — one grid row per visible
project, in render order. Each row SHALL resolve to:

- `minmax(var(--sidebar-section-banner-h, 1.75rem), 0fr)` when the
  project is **closed** — the row is pinned at the banner height
  (28px), with no slack.
- `minmax(var(--sidebar-section-banner-h, 1.75rem), 1fr)` when the
  project is **open** — the row's minimum is still the banner
  height, but its maximum is `1fr`, so it competes with sibling
  open rows for the remaining grid height.

The `--sidebar-section-banner-h` CSS custom property MAY be
overridden from a parent style block; absent override the
fallback `1.75rem` matches the banner's fixed `h-7` class.

When N sections are open simultaneously, each open row receives
`(content-height − closed-rows-banner-total) / N` of the
available height. Closed rows stay pinned at banner height
exactly; open rows split the remainder evenly via the `fr`
shares. Banners NEVER compress regardless of open count or
content height — the per-row `minmax` minimum is a hard floor.

Each `<Collapsible>` wrapper SHALL be one grid row; the wrapper
itself SHALL carry only `flex min-h-0 flex-col overflow-hidden`
(NO `flex-grow` / `flex-1` / `flex-none` toggle — those are now
the outer grid's job). The inner `<SidebarGroup>` SHALL carry
`flex min-h-0 flex-1 flex-col` unconditionally so its
`<CollapsibleContent>` (with `flex-1 min-h-0 overflow-hidden`)
can resolve against a known parent height and the inner scroll
`<div className="h-full overflow-y-auto">` actually scrolls.

`<CollapsibleContent>` SHALL be `forceMount`-ed so Radix keeps
the element in the DOM at all times (just `display: none`-ing it
when closed). This avoids re-mount cost on open/close and lets
the outer grid's row transition drive the height animation
without competing with Radix's own
`animate-collapsible-down/up` keyframes (those are NOT applied —
their `height: 0 → var(--radix-collapsible-content-height)`
animation would fight the grid-row sizing and snap-jump).

#### Scenario: SidebarContent overrides shadcn flex with grid
- **WHEN** the sidebar renders
- **THEN** the `<SidebarContent>` element's class list includes
  `!grid` and `!overflow-hidden`
- **AND** the element's inline `style` carries `grid-template-rows`
  with one entry per visible project

#### Scenario: Closed sections pin at banner height
- **GIVEN** the sidebar shows three projects, all closed
- **WHEN** the sidebar renders
- **THEN** the inline `grid-template-rows` is
  `minmax(var(--sidebar-section-banner-h, 1.75rem), 0fr) ×3`
  (each row's max is `0fr`, so each row consumes exactly the
  minimum 1.75rem = 28px)

#### Scenario: Two open sections split the remaining height evenly
- **GIVEN** the sidebar shows three projects: A (open), B
  (closed), C (open), and the content area is tall enough that
  the open rows have meaningful slack
- **WHEN** the sidebar renders
- **THEN** the inline `grid-template-rows` reads
  `minmax(..., 1fr) minmax(..., 0fr) minmax(..., 1fr)`
- **AND** A's and C's rendered heights are approximately equal
  (within a few pixels), each consuming roughly
  `(content-height − banner-h) / 2`
- **AND** B's row stays pinned at banner height (28px)

#### Scenario: Banner safety under overflow
- **GIVEN** a section's experiment list contains more content
  than fits in the open row's allocated height
- **WHEN** the sidebar renders
- **THEN** NO sibling section's banner is visually compressed
  below 28px (the per-row `minmax` minimum is a hard floor);
  excess content scrolls inside the open section's body via the
  `h-full overflow-y-auto` div, not by stealing space from
  siblings

#### Scenario: forceMount keeps CollapsibleContent in the DOM
- **WHEN** any project section renders, whether open or closed
- **THEN** its `<CollapsibleContent>` element is present in the
  DOM (Radix `forceMount` is applied)
- **AND** when the section is closed, Radix sets the element's
  `hidden` attribute (or `display: none`) so the row's intrinsic
  height is the banner alone

### Requirement: Section expand/collapse height animation

The sidebar SHALL animate every visible section's height
simultaneously when the expanded set changes. The animation SHALL
be driven by a CSS transition on `<SidebarContent>`'s
`grid-template-rows` property, NOT by per-row Radix keyframes.

The transition SHALL be `200ms ease-out` and SHALL apply to
`grid-template-rows` only (e.g.
`transition-[grid-template-rows] duration-200 ease-out`).
Browsers Chrome 121+ and Firefox 117+ natively interpolate the
`fr` component of `minmax(<length>, <Nfr>)` when only the `fr`
component differs between same-typed `minmax()` values on the
same row position. Older browsers will jump rather than
interpolate, but the layout remains correct on every keyframe;
the change is purely visual polish.

When the user opens a previously-closed section, every other
visible row's height reflows smoothly: open siblings shrink
slightly to make room (their `1fr` share decreases as N grows);
closed siblings remain pinned. When the user closes an open
section, the remaining open siblings grow smoothly to fill the
freed space.

The banner of every section SHALL remain visible throughout the
transition — the per-row `minmax` minimum is the same in both the
start and end states, so the `fr` interpolation never crosses
below the banner-height floor.

#### Scenario: SidebarContent declares a grid-template-rows transition
- **WHEN** the sidebar renders
- **THEN** the `<SidebarContent>` element's class list includes
  `transition-[grid-template-rows]` and `duration-200` and
  `ease-out` (or equivalent classes whose computed
  `transition-property` is `grid-template-rows` and whose
  duration is 200 ms)

#### Scenario: Opening one section smoothly rebalances siblings
- **GIVEN** two open sections A and C and one closed section B
  in the middle
- **WHEN** the user clicks B's banner to open it
- **THEN** the grid-template-rows inline style flips from
  `1fr 0fr 1fr` to `1fr 1fr 1fr` on the same SidebarContent
  element
- **AND** the rendered heights of A, B, C transition over
  ≈200ms to settle at roughly one-third of the content height
  each; no row pops to its final size in a single frame

#### Scenario: Closing a section frees its space to siblings
- **GIVEN** three open sections A, B, C each at roughly one-third
  of the content height
- **WHEN** the user clicks B's banner to close it
- **THEN** the grid-template-rows flips from `1fr 1fr 1fr` to
  `1fr 0fr 1fr`
- **AND** B shrinks to banner height while A and C each grow to
  roughly half the content height (minus banner totals) over
  the same 200ms transition

### Requirement: Sidebar experiment rows include a per-row "new terminal" launcher

Each experiment row inside an expanded project section SHALL render
a trailing icon-only "new terminal" launcher to the right of the
exp-id span. The button SHALL be the last visual element in the row
and SHALL behave as follows:

- The icon SHALL be `lucide-react`'s **`Plus`** at `size-3.5`,
  wrapped in a `<Button variant="ghost" size="icon" className="size-6 shrink-0">`
  (or equivalent small ghost button). The Plus framing reads as
  "create a new terminal" rather than "this row is itself a
  terminal" — a `Terminal` icon was deliberately rejected.
- The button's `aria-label` SHALL follow the pattern
  `"New terminal for <exp-id>"` (or, in the disabled state,
  `"New terminal for <exp-id> (ttyd unavailable)"`).
- The button SHALL be **always visible** (NOT hover-revealed) so it
  is discoverable and keyboard-reachable.
- Clicking the button SHALL open a **right-side `<TerminalSheet>`
  drawer** (the existing `<Sheet side="right">`-backed component)
  scoped to that experiment, parameterized with
  `{ project: <project>, scope: 'exp', slug: <exp-id>,
  agent: 'none' }` — i.e. a **plain shell** session, not a
  `claude code` session.
- Clicking the button SHALL NOT navigate the surrounding link to
  `/p/<project>/e/<exp-id>`. The button SHALL stop event
  propagation OR sit outside the `<Link>` element so the link does
  not also fire.

Viewer-session gating:

- When `useSession().role === 'viewer'`, the button SHALL render
  nothing.

ttyd-availability gating:

- The component SHALL read the existing TanStack query
  `['terminal','check']` (the same probe used by `TerminalButton`).
- When the probe has not yet resolved, the button MAY render a
  disabled placeholder OR render nothing (consistent with how
  `TerminalButton` handles its first-paint phase).
- When the probe reports ttyd is unavailable AND not
  auto-downloadable, the button SHALL render disabled with a
  tooltip surfacing the probe's `suggestion` field (or
  `"ttyd unavailable"`).
- When the probe reports ttyd is auto-downloadable, the button MAY
  render disabled with a tooltip pointing the user to the existing
  install affordance, OR render as enabled and trigger the install
  flow inline. Either behavior is acceptable; the rendering MUST
  NOT silently fail.

#### Scenario: Owner sees the "+" button on every experiment row
- **GIVEN** an owner session and a project with three experiments
- **WHEN** the project section is expanded
- **THEN** each of the three rows contains a Plus icon button
  after the exp-id span with `aria-label="New terminal for
  <exp-id>"`

#### Scenario: Viewer does not see the "+" button
- **GIVEN** a viewer session
- **WHEN** the project section is expanded
- **THEN** none of the experiment rows contain a Plus icon button;
  the rest of the row (leading run-count badge, exp-id span)
  renders unchanged

#### Scenario: Click opens right-side TerminalSheet drawer with agent: 'none'
- **GIVEN** an owner session and ttyd is available
- **WHEN** the user clicks the Plus icon on the row for experiment
  `E0007-foo` in project `project-a`
- **THEN** a `<TerminalSheet>` opens as a right-side drawer (the
  underlying `<Sheet side="right">` slides in from the right edge of
  the viewport)
- **AND** under the hood the sheet's call to `startTerminal` resolves
  with the payload `{ project: 'project-a', scope: 'exp',
  slug: 'E0007-foo', agent: 'none' }`
- **AND** the page URL has NOT navigated to
  `/p/project-a/e/E0007-foo`

#### Scenario: ttyd missing renders disabled button
- **GIVEN** an owner session and the `['terminal','check']` probe
  reports `available: false, downloadable: false`
- **WHEN** the project section is expanded
- **THEN** each experiment row's Plus icon is rendered in a disabled
  state with a tooltip surfacing the probe's `suggestion` (or the
  fallback `"ttyd unavailable"`)

#### Scenario: Click on button does not navigate the row link
- **GIVEN** an owner session and ttyd is available
- **WHEN** the user clicks the Plus icon on a row whose link target
  is `/p/project-a/e/E0007-foo`
- **THEN** the page URL after the click is unchanged (the click did
  NOT navigate the surrounding `<Link>`); only the right-side
  `<TerminalSheet>` drawer opened

### Requirement: Experiment row leading run-count badge replaces the indent gutter

Each experiment row inside an expanded project section SHALL render
a leading circular run-count badge as the row's **first visual
element**. The badge plays two roles at once: it is the row's
left-side indentation cue (replacing the previous transparent
`<span aria-hidden className="w-6 shrink-0" />` spacer) AND a
passive numeric badge showing `exp.frontMatter.runs.length`.

The badge SHALL be a `<span>` with `aria-label="{N} runs"`
(where `N` is the run count) whose class list resolves to:

- a `flex` layout that horizontally and vertically centers its
  text content,
- a fixed square size of `size-[1.125rem]` (≈18px),
- `shrink-0` so the badge never compresses,
- `rounded-full` for a circular shape,
- a subtle fill `bg-sidebar-foreground/5` that remains legible
  against both the resting body background and the
  `bg-sidebar-accent` active-row highlight,
- `text-[9px] tabular-nums text-sidebar-foreground/60` for the
  count itself.

The badge SHALL be rendered as a direct child of the row's
`<Link>` element (NOT as a sibling outside the link's
active-highlight wrapper). This means clicking the badge follows
the same navigation as clicking anywhere else in the link.

The badge SHALL be rendered for every experiment row, including
experiments with zero runs (`runs.length === 0`); the visible
text is just `0`. The badge is the row's leading visual anchor
and the row width SHALL NOT shift between zero-run and many-run
experiments.

#### Scenario: Each row's first visual element is a circular run-count badge
- **GIVEN** a project section is expanded with two experiments,
  `E0001-foo` (3 runs) and `E0002-bar` (0 runs)
- **WHEN** the sidebar renders
- **THEN** each row's `<Link>` contains a leading `<span>` with
  `aria-label="3 runs"` / `aria-label="0 runs"` respectively
- **AND** the span's class list includes `size-[1.125rem]`,
  `rounded-full`, `bg-sidebar-foreground/5`, and `text-[9px]`
- **AND** the span sits at the row's leading edge, immediately
  followed by the exp-id span

#### Scenario: Badge replaces the previous indent gutter spacer
- **GIVEN** any sidebar render after this change ships
- **WHEN** any experiment row is inspected
- **THEN** the row does NOT contain a separate transparent
  `<span aria-hidden className="w-6 shrink-0" />` indent spacer
  (this element was previously rendered before the link as the
  row's first child); the leading badge is the only leading
  visual

#### Scenario: Badge sits inside the active-row highlight
- **GIVEN** a row whose `isActive === true`
- **WHEN** the sidebar renders
- **THEN** the badge is rendered inside the active-highlight
  wrapper, so the highlight background sits underneath the badge
  rather than around it

### Requirement: Sidebar footer has a visual divider above the footer widgets

The `<SidebarFooter>` element SHALL render a 1px top border (via
`border-t border-sidebar-border` or equivalent) so the
`SlurmStatusWidget` + `Manage tmux` row block is visually separated
from the project section list above. The token `--sidebar-border`
MUST already be defined in `apps/web/app/globals.css`; the divider
SHALL NOT introduce new CSS variables.

#### Scenario: Footer carries a top border
- **WHEN** the sidebar renders on a project page (owner session)
- **THEN** the `<SidebarFooter>` element's computed style has a
  non-zero top border whose color matches
  `var(--sidebar-border)`

#### Scenario: Token is already defined
- **WHEN** introducing the `border-sidebar-border` class
- **THEN** `apps/web/app/globals.css` already contains a definition
  for `--sidebar-border` (no new CSS variable is added by this
  change)

#### Scenario: Footer divider visible on /manage/* routes too
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the footer block (which still contains `Manage tmux`)
  carries the same top border above its content as on project pages

### Requirement: Loading spinner shows when section first opens with no cached data

The sidebar SHALL render a loading spinner inside any expanded
project section whose experiments query has not yet resolved with
cached data, so the user knows the section is fetching rather
than mistaking the empty body for "no experiments". Specifically:
when a project section is expanded AND TanStack Query reports
the `['experiments', project]` query is in the `isLoading` state
AND there is no cached array of experiments yet, the section
body SHALL render a centered loading spinner.

The spinner SHALL be a `<Loader2 />` icon from `lucide-react`
at `size-4`, rendered inside a wrapper marked
`data-slot="exp-list-loading"` with classes that center it
horizontally and vertically (e.g.
`flex items-center justify-center py-3 text-sidebar-foreground/50`).
The icon SHALL carry the `animate-spin` Tailwind class and an
accessible label (`aria-label="Loading experiments"`).

The spinner SHALL be shown only when ALL of the following hold:

1. The section is currently expanded (`enabled === true`).
2. The query is in `isLoading` state (no resolved data yet).
3. The cached `docs.length` is `0` (no previously-fetched array).

When previous data is cached (e.g. the user toggles the section
closed and re-opens it), TanStack Query returns the cached
array while it refetches in the background. The `docs.length
> 0` check SHALL skip the spinner branch and render the cached
rows immediately — no spinner, no skeleton, no "View more"
affordance.

When the section is closed (`enabled === false`), nothing
renders (return `null` before the spinner check) so the
collapsed section's row stays at banner height.

#### Scenario: First open with no cache shows the spinner
- **GIVEN** a project section that has never been opened in
  this page lifecycle (no cached `['experiments', project]`
  data)
- **WHEN** the user clicks the project banner to expand it
- **THEN** the section body immediately renders a
  `<div data-slot="exp-list-loading">` containing a spinning
  `<Loader2>` icon
- **AND** when the API responds, the spinner is replaced by
  the experiment list

#### Scenario: Re-open with cached data skips the spinner
- **GIVEN** a project section that was previously opened, has
  cached experiments, and was then closed
- **WHEN** the user re-opens the section
- **THEN** the cached experiment rows render immediately; no
  `data-slot="exp-list-loading"` element is mounted
- **AND** TanStack Query may issue a background refetch but the
  user sees the cached rows the whole time

#### Scenario: Closed section renders nothing
- **GIVEN** a project section that is collapsed (`enabled === false`)
- **WHEN** the sidebar renders
- **THEN** the `ProjectExperimentDocs` body renders nothing
  (the function returns `null`) — no spinner, no list, no
  empty-state placeholder

### Requirement: Active experiment row highlight covers the wrapper from the leading badge to the trailing button

The sidebar SHALL highlight the row of the currently-open
experiment (the row whose id matches the `:expDocId` URL segment
under `/p/<project>/e/`) to confirm navigation context. The
highlight SHALL satisfy a single coverage constraint: it covers
the entire wrapper that contains the leading run-count badge, the
exp-id span, and the trailing per-row "+" terminal button — i.e.
all interactive content of the row sits on the highlighted
background.

Concretely:

- The highlight background SHALL cover the wrapper `<div>` that
  is the row's single source of background truth. The wrapper
  contains, in order: the `<SidebarMenuButton asChild>`-rendered
  `<Link>` (which itself contains the leading run-count badge and
  the exp-id span), and the trailing `<ExpRowTerminalButton>`
  (the Plus icon button). The Plus button SHALL appear inside
  the highlighted region, not as a stray un-highlighted control
  floating to the right.
- The inner `<SidebarMenuButton>`'s default
  `hover:bg-sidebar-accent` and `data-[active=true]:bg-sidebar-accent`
  paints SHALL be suppressed (via `hover:bg-transparent` and
  `data-[active=true]:bg-transparent` overrides) so the wrapper
  remains the single source of background truth — no double-paint,
  no edge mismatch between the link and the button.
- An inactive row's wrapper SHALL apply
  `hover:bg-sidebar-accent/40` (a lighter on-hover tint) so the
  row still reads as clickable on hover; active and inactive
  rows share the same wrapper layout and differ only by
  background opacity.

Implementation: the `<SidebarMenuItem>` wraps a single
flex-row `<div className="flex min-w-0 flex-1 items-center
rounded-md transition-colors ...">` that holds both the
`<SidebarMenuButton>` and the `<ExpRowTerminalButton>`. The
wrapper's class list reads
`isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' :
'hover:bg-sidebar-accent/40'`. There is NO separate transparent
indent gutter spacer; the leading run-count badge (rendered
inside the link) is the row's leading visual.

#### Scenario: Active row's highlight covers badge + id + Plus button continuously
- **GIVEN** a project section is expanded and the user is currently
  viewing experiment `E0007-foo`
- **WHEN** the sidebar renders
- **THEN** the highlight background extends continuously from the
  left edge of the leading run-count badge all the way to the
  right edge of the trailing Plus button (no un-highlighted gap
  appears anywhere along the row)
- **AND** the Plus button itself sits visually inside the
  highlighted region

#### Scenario: Inactive row reverts to a hover-only tint
- **GIVEN** a project section is expanded with two experiments
  `E0001-alpha` and `E0002-beta`, and the user is viewing
  `E0001-alpha`
- **WHEN** the sidebar renders
- **THEN** only `E0001-alpha`'s row carries the
  `bg-sidebar-accent` wrapper background; `E0002-beta`'s row
  has no resting background and only paints
  `bg-sidebar-accent/40` on hover

#### Scenario: Inner SidebarMenuButton bg is suppressed
- **WHEN** any experiment row renders
- **THEN** the inner `<SidebarMenuButton>` element's class list
  includes `hover:bg-transparent` AND
  `data-[active=true]:bg-transparent` so the wrapper's background
  is the only one visible regardless of the button's own active
  / hover state

### Requirement: Desktop-visible sidebar collapse toggle

The dashboard SHALL render a visible `<SidebarTrigger>` (or
equivalent affordance that calls the same `toggleSidebar()` from the
shadcn `SidebarContext`) on viewports at or above the Tailwind `md`
breakpoint (`>= 768px`). The trigger SHALL remain visible on smaller
viewports too (i.e. removing the previous `md:hidden` constraint, not
adding a separate desktop-only widget). The keyboard shortcut
`Cmd/Ctrl+B` (bound at the `SidebarProvider` level by the shadcn
primitive) SHALL continue to toggle the same state.

The trigger SHALL render in the existing AppBar location (top-left,
to the left of the tab list). The icon, `aria-label` ("Toggle
Sidebar"), and click behavior SHALL come from the unmodified shadcn
`<SidebarTrigger>` component — no fork of `apps/web/components/ui/
sidebar.tsx`.

The trigger MUST remain reachable in BOTH the open and the
collapsed (`offcanvas`) states. Because the `offcanvas` collapsible
mode slides the sidebar entirely off-screen, the trigger MUST NOT
be a child of the `<Sidebar>` element — placing it in the
`<AppBar>` (which lives in the inset) is the canonical placement
and is what this requirement codifies.

#### Scenario: Trigger is visible on desktop

- **GIVEN** the viewport width is `>= 768px`
- **WHEN** the dashboard renders any `/p/<project>/*` or
  `/manage/*` page
- **THEN** the AppBar contains a `<SidebarTrigger>` element with no
  `md:hidden` class
- **AND** clicking the trigger toggles the sidebar's `open` state
  (visible ↔ off-canvas)

#### Scenario: Trigger is visible on mobile (unchanged)

- **GIVEN** the viewport width is `< 768px`
- **WHEN** the dashboard renders
- **THEN** the same `<SidebarTrigger>` element is visible in the
  AppBar
- **AND** clicking it toggles the mobile `Sheet` overlay (the
  shadcn-provided mobile drawer)

#### Scenario: Trigger is reachable when the sidebar is collapsed

- **GIVEN** the user has clicked the trigger so the sidebar is
  off-canvas (the column has slid off the left edge)
- **WHEN** the trigger is re-clicked
- **THEN** the sidebar slides back into view at the user's
  persisted width
- **AND** no part of the trigger was occluded by the sidebar at any
  point during the collapsed state (the trigger lives in the inset,
  not in the sidebar)

#### Scenario: Cmd/Ctrl+B keyboard shortcut continues to work

- **GIVEN** the viewport is `>= 768px` and the trigger has just
  been made visible
- **WHEN** the user presses `Cmd+B` (macOS) or `Ctrl+B` (Linux /
  Windows)
- **THEN** the sidebar toggles open ↔ off-canvas, identically to a
  click on the trigger

### Requirement: Sidebar collapse state persists across reloads

The dashboard SHALL persist the sidebar's open/closed state to the
cookie named `sidebar_state` (the shadcn `Sidebar` primitive's
canonical persistence key, exposed as `SIDEBAR_COOKIE_NAME` in
`apps/web/components/ui/sidebar.tsx`). The cookie SHALL carry the
literal string `"true"` when the sidebar is open and `"false"`
when collapsed, with `path=/` and `max-age=604800` (7 days), exactly
as the shadcn primitive writes it.

Persistence SHALL be applied on the next page load: the server-side
read of `sidebar_state` SHALL drive the `defaultOpen` prop on
`<SidebarProvider>` so the initial SSR HTML renders in the user's
preferred state without a hydration flicker. (This requirement
documents existing shadcn behavior so future changes cannot silently
drop it.)

#### Scenario: Cookie is written on toggle

- **GIVEN** the sidebar is currently open
- **WHEN** the user clicks the `<SidebarTrigger>` to collapse it
- **THEN** the browser's `Cookie` header for `*://<host>/` SHALL
  include `sidebar_state=false; path=/; max-age=<≤604800>`
- **AND** the URL is unchanged

#### Scenario: State survives a reload

- **GIVEN** the user has collapsed the sidebar (cookie is now
  `sidebar_state=false`)
- **WHEN** the user reloads the page
- **THEN** the SSR HTML renders with the sidebar in the collapsed
  state (no first-frame flash of an open sidebar followed by a
  collapse)
- **AND** the client hydrates against the same state

#### Scenario: Cookie is shared across `/p/*` and `/manage/*`

- **GIVEN** the user collapses the sidebar while on `/p/project-a`
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the sidebar on `/manage/tmux` is also collapsed (the
  cookie is read by the manage-layout's `SidebarProvider` too)

### Requirement: Sidebar drag-to-resize handle on desktop

The dashboard SHALL render a drag handle on the right edge of the
sidebar that allows the user to resize the sidebar's width by
mouse, touch, pen, or keyboard. The handle SHALL be visible only
when ALL of the following conditions hold:

1. The viewport width is `>= 768px` (the Tailwind `md`
   breakpoint).
2. The sidebar is currently in the `open` state (the column is
   visible, not in `offcanvas`).
3. The page mounts the `AppSidebar` (i.e. any `/p/*` or
   `/manage/*` page).

The handle SHALL be implemented as a SEPARATE overlay component
(e.g. `apps/web/components/sidebar-resize-handle.tsx`) and MUST
NOT modify `apps/web/components/ui/sidebar.tsx`. The handle SHALL
absolute-position itself against the sidebar column's right edge
in the same stacking context as the sidebar's fixed-position
wrapper.

The handle SHALL render as a thin (~`4px`-wide) vertical strip
with:

- `cursor: col-resize` at rest,
- a subtle rest-state background (e.g. transparent or a thin
  border tinted with `--sidebar-border`),
- a more prominent hover / active background (e.g. tinted with
  `--primary` at low opacity),
- `role="separator"`, `aria-orientation="vertical"`, and
  `aria-label="Resize sidebar"` for accessibility,
- `tabIndex={0}` so it can receive keyboard focus.

While the user drags the handle (`pointerdown` → `pointermove` →
`pointerup`), the dashboard SHALL update the `--sidebar-width` CSS
variable on the same wrapper element where `SidebarProvider`
emits it (the `data-slot="sidebar-wrapper"` div), so the
`w-(--sidebar-width)` Tailwind classes on the sidebar column and
its fixed sibling track the change in real time. The width SHALL
be clamped to the inclusive range `[192px, 384px]` (corresponding
to `12rem` … `24rem` at a 16px root font size); values outside
this range SHALL be silently clamped to the nearest bound during
the drag.

The drag interaction SHALL use pointer-capture
(`setPointerCapture` on `pointerdown`, released on `pointerup`)
so the drag does not break when the cursor briefly leaves the
handle.

The handle SHALL also respond to keyboard input when focused:

- `ArrowRight` increases the width by `16px`; `ArrowLeft`
  decreases it by `16px`.
- `Shift+ArrowRight` / `Shift+ArrowLeft` adjust by `64px`.
- Keyboard adjustments SHALL clamp to the same `[192px, 384px]`
  range and SHALL persist on each keystroke (no
  pointerup-equivalent debouncing required).

#### Scenario: Handle is visible on desktop when sidebar is open

- **GIVEN** the viewport is `>= 768px` AND the sidebar is open
- **WHEN** the page renders
- **THEN** the DOM contains a focusable element at the sidebar's
  right edge with `role="separator"` and
  `aria-orientation="vertical"`
- **AND** the element's computed `cursor` is `col-resize`

#### Scenario: Handle is hidden on mobile

- **GIVEN** the viewport is `< 768px`
- **WHEN** the page renders
- **THEN** the resize handle element is NOT in the DOM (or is
  visually hidden via a class that includes `hidden md:flex` /
  equivalent)
- **AND** the sidebar renders as the shadcn `Sheet` overlay (the
  existing mobile behavior is unchanged)

#### Scenario: Handle is hidden when the sidebar is collapsed

- **GIVEN** the viewport is `>= 768px` AND the user has clicked
  the trigger so the sidebar is in the `offcanvas` (collapsed)
  state
- **WHEN** the page is in this state
- **THEN** the resize handle is NOT visible / focusable (there is
  no visible column to resize)

#### Scenario: Drag increases the sidebar width

- **GIVEN** the viewport is `>= 768px`, the sidebar is open at
  `256px` (the default `16rem`), and the resize handle is
  focused
- **WHEN** the user `pointerdown`s on the handle, drags `+64px`
  to the right, and `pointerup`s
- **THEN** during the drag the inline style on the
  `data-slot="sidebar-wrapper"` element updates
  `--sidebar-width` continuously from `256px` toward `320px`
- **AND** on `pointerup` the final `--sidebar-width` is `320px`
- **AND** the sidebar column's rendered width is `320px`

#### Scenario: Drag is clamped at the maximum width

- **GIVEN** the sidebar is open at the default `256px`
- **WHEN** the user drags the handle `+200px` to the right
  (would otherwise reach `456px`)
- **THEN** the final `--sidebar-width` is clamped to `384px` (the
  `24rem` upper bound)

#### Scenario: Drag is clamped at the minimum width

- **GIVEN** the sidebar is open at the default `256px`
- **WHEN** the user drags the handle `-200px` to the left (would
  otherwise reach `56px`)
- **THEN** the final `--sidebar-width` is clamped to `192px` (the
  `12rem` lower bound)

#### Scenario: Keyboard arrow keys resize the sidebar

- **GIVEN** the viewport is `>= 768px`, the sidebar is open at
  `256px`, and the resize handle is focused via Tab
- **WHEN** the user presses `ArrowRight` 4 times
- **THEN** the `--sidebar-width` value progresses `256 → 272 →
  288 → 304 → 320` (one `16px` step per keystroke)

#### Scenario: Shift+arrow keys take larger steps

- **GIVEN** the sidebar is open at `256px` and the handle is
  focused
- **WHEN** the user presses `Shift+ArrowRight` once
- **THEN** the `--sidebar-width` value becomes `320px` (one
  `64px` step)

#### Scenario: Viewport crossing the md breakpoint mid-drag

- **GIVEN** the viewport is `>= 768px`, the user is mid-drag on
  the handle (pointer captured)
- **WHEN** the user shrinks the browser window such that the
  viewport drops below `768px`
- **THEN** the in-progress drag completes via `pointerup` (the
  pointer-capture survives the breakpoint cross)
- **AND** the final width is committed to `localStorage`
- **AND** the handle becomes invisible on the new mobile layout
- **AND** when the user later expands the viewport back to
  `>= 768px`, the persisted width is re-applied

### Requirement: Sidebar width persists to localStorage

The dashboard SHALL persist the user-chosen sidebar width to
`localStorage` under the key `memon:sidebar:width`. The value SHALL
be a string-encoded integer representing the width in CSS pixels.
The value SHALL be:

- read on the client immediately after hydration,
- clamped to the inclusive range `[192, 384]` on read (matching the
  drag handle's clamping), with out-of-range or non-numeric values
  treated as missing,
- applied via the `style` prop of `<SidebarProvider>` as
  `{ '--sidebar-width': '${widthPx}px' }`,
- written back on every commit point (`pointerup` after a drag,
  every keystroke during keyboard resize), best-effort (writes
  swallow exceptions for browser storage quota / private-mode
  errors).

When the localStorage key is absent or its value is unparseable /
out-of-range / non-numeric, the dashboard SHALL fall back to the
shadcn default width (`16rem` ≈ `256px`). The SSR HTML SHALL
render at the default width; the persisted value is applied after
hydration. No SSR fetch of the localStorage value is required.

The persisted width SHALL apply across BOTH `/p/<project>/*` and
`/manage/*` pages — both layouts mount `<SidebarProvider>` and
SHALL receive the same persisted width via the shared client hook
or wrapper component.

The mobile drawer width (the shadcn `SIDEBAR_WIDTH_MOBILE = "18rem"`
constant inside the `Sheet`) SHALL NOT be overridden by the
persisted desktop width — mobile keeps its shadcn default.

#### Scenario: Width survives a reload

- **GIVEN** the user has dragged the sidebar from `256px` to
  `320px`
- **WHEN** the user reloads the page
- **THEN** after hydration the `--sidebar-width` inline style on
  the wrapper is `320px`
- **AND** the sidebar column renders at `320px`

#### Scenario: Width persists across `/p/*` ↔ `/manage/*` navigation

- **GIVEN** the user resizes the sidebar to `300px` while on
  `/p/project-a`
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the sidebar on `/manage/tmux` also renders at `300px`

#### Scenario: Absent localStorage falls back to default

- **GIVEN** `localStorage` has no `memon:sidebar:width` entry
  (fresh browser profile)
- **WHEN** the page loads
- **THEN** the sidebar renders at the shadcn default `16rem`
  (`256px`)
- **AND** no console warning / error is emitted

#### Scenario: Out-of-range stored value is clamped on read

- **GIVEN** `localStorage.getItem('memon:sidebar:width')` returns
  `"1000"` (stale value from a future build, or manually set)
- **WHEN** the page loads
- **THEN** the sidebar renders at `384px` (the upper bound), not
  at `1000px`

#### Scenario: Non-numeric stored value falls back to default

- **GIVEN** `localStorage.getItem('memon:sidebar:width')` returns
  `"abc"` or `null`
- **WHEN** the page loads
- **THEN** the sidebar renders at the shadcn default `256px`

#### Scenario: Mobile drawer is unaffected by the desktop persisted width

- **GIVEN** the user has persisted a desktop width of `320px`
- **WHEN** the user opens the page on a `< 768px` viewport
- **THEN** the mobile `Sheet` drawer renders at `18rem` (the
  shadcn `SIDEBAR_WIDTH_MOBILE` default), NOT at `320px`

### Requirement: SidebarInset constrains its width via min-w-0

The `<SidebarInset>` mounted alongside `<AppSidebar>` SHALL receive a `min-w-0` className so the inset can shrink below its content's intrinsic min-width.
The inset is a flex item; without `min-w-0`, the browser's
default `min-width: auto` makes the flex item at least as wide as
its content's intrinsic minimum — a wide child (a log viewer, a
wide table, a `<pre>` block of unwrapped output) then pushes the
inset past its flex-share and out beyond the viewport's right
edge.

The wrapper `<div>` that holds `{children}` inside the inset
SHALL also receive `min-w-0` so the constraint propagates one
level deeper. Without it, the same overflow path returns: the
inset shrinks, but the children block inside it does not, and
the children block becomes the overflow source instead.

This requirement applies to BOTH `apps/web/app/p/[project]/layout.tsx`
and `apps/web/app/manage/layout.tsx` — both layouts mount a
`<SidebarInset>` and BOTH SHALL apply the same min-width
constraint. The `/p/<project>/layout` carries
`<SidebarInset className="min-w-0">` with a child
`<div className="min-w-0 flex-1 pb-8">`; the
`/manage/layout` carries the equivalent constraints alongside
its own min-h-0 / overflow-hidden constraints.

Rationale: at the shadcn-default `16rem` sidebar width the
overflow rarely manifests because most viewports have enough
remaining width to absorb wide children. With the new resize
handle (this change's primary feature), users can drag the
sidebar to `24rem` (`384px`) which leaves much less room for the
inset — making the overflow bug surface immediately on pages
with wide content. `min-w-0` on both the inset and the inner
children wrapper is the canonical fix.

#### Scenario: Wide child does not overflow the viewport at large sidebar widths

- **GIVEN** the user has dragged the sidebar to its maximum
  width (`384px`) AND is viewing a page with a wide child (e.g.
  a wide table or `<pre>` block whose intrinsic min-width
  exceeds the remaining flex-share)
- **WHEN** the page renders
- **THEN** the page's rendered width does NOT exceed the
  viewport width; the wide child scrolls inside its own
  container (or is clipped by an internal `overflow-*` rule)
  rather than expanding the inset past its flex-share

#### Scenario: SidebarInset and its children wrapper both carry min-w-0

- **WHEN** the `/p/<project>/layout` renders
- **THEN** the `<SidebarInset>` element's class list includes
  `min-w-0`
- **AND** the immediate `<div>` wrapper around `{children}`
  inside the inset also has `min-w-0` in its class list

#### Scenario: Same constraint applies on the /manage/* layout

- **WHEN** the `/manage/layout` renders (e.g. for `/manage/tmux`)
- **THEN** its `<SidebarInset>` element also carries a class
  list that constrains the inset's width to shrink below
  intrinsic content min-width (e.g. `min-h-0 overflow-hidden`
  combined with a flex-direction parent that already prevents
  horizontal overflow), satisfying the same anti-overflow
  contract as `/p/<project>/layout`

### Requirement: Manage pages render a visible SidebarTrigger for desktop drawer toggle

The `apps/web/app/manage/layout.tsx` layout SHALL render a visible
`<SidebarTrigger />` in the page chrome (above the manage page
body, inside the `<SidebarInset>`). Project pages already supply
this affordance via the `<AppBar>` they mount; manage pages —
which deliberately do NOT mount `<AppBar>` because that bar is
project-scoped — would otherwise leave desktop users without a
click affordance to collapse or expand the drawer. The trigger
SHALL behave identically to the one in `<AppBar>`: it toggles the
`sidebar_state` cookie, fires the same shadcn keyboard shortcut
(`Cmd/Ctrl+B`), and uses the same shadcn primitive
(`components/ui/sidebar` → `SidebarTrigger`).

#### Scenario: Trigger renders on /manage/tmux

- **GIVEN** an authenticated owner session
- **WHEN** the owner requests `GET /manage/tmux`
- **THEN** the response HTML contains at least one element with
  `data-slot="sidebar-trigger"`

#### Scenario: Click toggles the drawer

- **GIVEN** the owner is on `/manage/tmux` with the sidebar
  currently open (`sidebar_state=true`)
- **WHEN** the owner clicks the `<SidebarTrigger />` rendered in
  the manage layout chrome
- **THEN** the `sidebar_state` cookie value flips to `false`
- **AND** clicking it again flips the cookie back to `true`

#### Scenario: Visual placement

- **WHEN** the manage layout renders
- **THEN** the trigger sits in a dedicated strip above the manage
  page body — i.e. it is the first child of `<SidebarInset>` and
  it does NOT overlap or float on top of the `{children}` content
  region

