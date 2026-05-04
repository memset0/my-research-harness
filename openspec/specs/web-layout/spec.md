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

Each project group in the sidebar SHALL be **collapsed by default**. Clicking the project's header SHALL toggle expansion. When expanded, the group SHALL display the project's most recent **at most 5 experiments**, sorted by `createdAt` descending, each as a clickable row.

#### Scenario: Initial load
- **WHEN** the user opens the dashboard for the first time (no prior expanded state)
- **THEN** every project group is collapsed; no experiment rows are rendered in the sidebar

#### Scenario: Click to expand
- **WHEN** the user clicks a project header
- **THEN** the project expands and shows up to 5 experiment rows; the active project is also visually highlighted

#### Scenario: Fewer than 5 experiments
- **WHEN** an expanded project has only 3 experiments
- **THEN** all 3 are shown and no `View more` link appears

### Requirement: "View more" temporary expansion past 5 runs

When a project has more than 5 experiments and is expanded, the sidebar SHALL render a `View more` link below the 5 visible rows. Clicking the link SHALL temporarily reveal **all** the project's experiments inside the sidebar group; the expansion is **not** persisted across reloads.

#### Scenario: Show all rows
- **WHEN** a project with 12 experiments is expanded and the user clicks `View more`
- **THEN** the sidebar group renders all 12 experiment rows in place; the `View more` link is replaced by `Show fewer`

#### Scenario: Reset on reload
- **WHEN** the user reloads the page after clicking `View more`
- **THEN** the project group still expands to only 5 rows again (the temporary expansion is forgotten)

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
- The currently-active **project** (matching the URL's `[project]` segment), regardless of expansion state
- The currently-active **experiment** (matching the URL's `[id]` segment when on a detail page), only when its project is expanded

#### Scenario: On detail page
- **WHEN** the URL is `/p/project-a/experiments/foo-260501-100000`
- **THEN** the `project-a` group header has the "active project" treatment AND, if `project-a` is expanded, the `foo-260501-100000` row has the "active row" treatment

### Requirement: Top AppBar with view tab switcher

The dashboard SHALL render a sticky **AppBar** above the main content area containing:
- The memon brand on the left
- A `Tabs`-style switcher for `Experiments` / `Hypotheses` / `Journal`, scoped to the current project
- A `+ New experiment` action on the right

#### Scenario: Tab navigation
- **WHEN** the user is on `/p/project-a/experiments/foo-260501-100000` and clicks the `Hypotheses` tab in the AppBar
- **THEN** the URL updates to `/p/project-a/hypotheses`; the AppBar's `Hypotheses` tab is now active

#### Scenario: New experiment from AppBar
- **WHEN** the user clicks `+ New experiment` while on any view of `project-a`
- **THEN** the existing new-experiment modal opens with `project-a` pre-selected

### Requirement: Existing routes continue working unchanged

The URL structure `/p/[project]`, `/p/[project]/hypotheses`, `/p/[project]/journal`, and `/p/[project]/experiments/[id]` SHALL be preserved. The new layout only changes how navigation is presented, not how routes are addressed.

#### Scenario: Direct URL navigation
- **WHEN** the user types `/p/project-a/experiments/foo-260501-100000` directly into the address bar
- **THEN** the page loads with the sidebar showing `project-a` expanded and `foo-260501-100000` highlighted (as well as the AppBar `Experiments` tab active)

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

Both experiment-run status (`PENDING` / `RUNNING` / `FINISHED` / `FAILED` / `UNKNOWN`) and hypothesis status (`CONFIRMED` / `REFUTED` / `PARTIAL` / `OPEN` / `DEFERRED`) SHALL render in the UI as a `<Badge variant="outline">` with a `lucide-react` icon plus the enum string. The on-disk JOURNAL.md / HYPOTHESES.md / README.md files continue to use the canonical emoji (📝 🟢 ✅ ❌ ❓ for runs, ✅ ❌ 🟡 🔵 ⚪ for hypotheses) per the parsing spec; the **emoji is never shown in the rendered UI**.

Each status uses a distinct color family (composed via `cn()` over shadcn `Badge`, never by forking `badge.tsx`):
- emerald — success / confirmed
- red — failure / refuted
- amber — partial
- sky — running / open
- slate / muted — pending / deferred / unknown

Stale-RUNNING marker SHALL render as a `lucide-react AlertTriangle` icon next to (or inside) the badge — not the ⚠ emoji.

#### Scenario: Run status pill
- **WHEN** rendering an experiment with status RUNNING
- **THEN** the pill shows a spinning `Loader2` icon + the text `RUNNING` on a sky-tinted Badge; the text `🟢` does not appear in the DOM

#### Scenario: Stale-RUNNING marker
- **WHEN** the experiment status is RUNNING and `stale` is true (no directory activity for >1h)
- **THEN** an `AlertTriangle` lucide icon is rendered immediately adjacent to the badge in an amber color; the text `⚠` does not appear in the DOM

#### Scenario: Hypothesis status pill
- **WHEN** rendering a hypothesis card with status PARTIAL
- **THEN** the pill shows a `CircleDot` icon + the text `PARTIAL` on an amber-tinted Badge; the text `🟡` does not appear in the DOM

### Requirement: Hypothesis summary uses structured tags, not raw markdown

The hypothesis summary table at the top of `/p/<project>/hypotheses` SHALL be rendered as a structured component (one row per parsed `HypothesisEntry`) with columns `id` / `status` / `statement` / `experiments`. The `status` cell SHALL use `<HypothesisStatusPill>` (not the raw emoji from disk). Each `experiment` cell SHALL render the experiment id as a Next.js `<Link>` to `/p/<project>/experiments/<id>`. The raw `summaryTableBlock` from `HYPOTHESES.md` is NOT rendered as markdown in the UI.

#### Scenario: Summary row with multiple experiments
- **WHEN** a hypothesis is associated with `foo-260501-100000` and `bar-260502-150000`
- **THEN** the summary row shows both ids as Next.js `<Link>` elements; clicking either navigates client-side (no full page reload) to that experiment

#### Scenario: Summary row with no experiments
- **WHEN** a hypothesis has zero associated experiments (`OPEN` or `DEFERRED` typically)
- **THEN** the experiments cell shows `—`

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

