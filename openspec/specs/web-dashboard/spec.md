# web-dashboard Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: Project selector in top navigation

The dashboard SHALL display a project selector in the top navigation showing the projects from the active session's accessible set:

- For an **owner** session, the selector SHALL list all projects from the resolved `config.yml`.
- For a **viewer** session, the selector SHALL list ONLY projects in `useSession().scopeProjects`. If the scope contains exactly one project, the selector SHALL be replaced by a read-only `<span>` label naming the project. If the scope contains multiple projects, the selector renders a dropdown over those names.

Switching project (where applicable) SHALL update the experiment list, hypothesis view, journal view, reports inbox, and digests inbox to that project's data without full page reload, the same as today.

#### Scenario: Owner switching projects
- **WHEN** an owner clicks a different project in the selector
- **THEN** the URL updates with the project identifier and the views re-fetch data scoped to the new project

#### Scenario: Viewer with single-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a"]` opens the dashboard
- **THEN** the top-nav project label reads "project-a" as a plain `<span>` (no dropdown)
- **AND** there is no way to navigate to other projects from this surface

#### Scenario: Viewer with multi-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a", "project-b"]` opens the dashboard
- **THEN** the selector dropdown lists the two scoped projects
- **AND** switching between them works as for owner

### Requirement: Experiment-card grid as the project list page

The list page at `/p/<project>` SHALL render a responsive grid of
experiment cards (one card per experiment). Each card SHALL contain:

1. **Header row**: experiment status pill (rendering the manual `frontMatter.status` of the exp doc per `experiment-readme`'s `ExperimentStatus` enum), exp id + slug in monospace, and an `Archive` icon prefix when `archived: true` per `archive-frontmatter`'s visual treatment.
2. **Title line**: the exp's `title` field rendered in a slightly larger weight.
3. **Secondary line under the title**: a small muted-text run-roster summary in the form `<n> running · <n> done · <n> interrupted · <n> failed · <n> pending` (categories with zero count omitted; `<n> unparseable` appended only when non-zero). When the experiment has zero member runs, the line reads `no runs yet`. The total count is implicit (sum of the parts) — there is NO separate `<finished> / <total>` counter.
4. **Embedded runs table**: one row per confirmed member run, columns
   `status pill | run dir name | created_at HH:MM | duration-or-status
   | files-count`. Clicking a row navigates to
   `/p/<project>/e/<exp-id>?run=<run-dir>` with that run panel
   auto-expanded. Archived runs in this table SHALL render with the desaturated treatment from `archive-frontmatter` and an `Archive` icon prefix.
5. **Footer left**: tags as outline badges (the exp's frontmatter
   `tags[]`).
6. **Footer right (desktop)**: 📅 `effective_created_at` and ✎
   `effective_updated_at`, each preceded by a small icon.
7. **Footer (mobile)**: tags and times stack vertically.

The card pill SHALL NOT compute aggregate from member-run statuses. Run aggregation continues to exist as a derived stat (used by the secondary line above and by the agent-handoff prompt) but does NOT drive the card pill.

Cards SHALL be sorted by `effective_updated_at` descending by default (active items first when checkbox unchecked, per `archive-frontmatter`'s listing rules); the sort/filter controls from the v2 list view (a flexible header) are re-used to control sort key and search across exp title / slug / tags / member-run names.

The "Show archived" checkbox and bottom-of-list bucket affordance live above and below this grid per `archive-frontmatter`'s "Frontend listing has two display modes for archived items" requirement. Archived cards' visual treatment follows `archive-frontmatter`'s "Visual treatment of archived items."

There SHALL NOT be a sub-project badge on cards (the sub-project field
is gone in v3).

#### Scenario: Card header shows manual status, not aggregate
- **GIVEN** an experiment with `frontMatter.status: OPEN` and 3 confirmed runs whose statuses are RUNNING, FINISHED, FINISHED
- **WHEN** the card renders
- **THEN** the header status pill is `OPEN` (sky-blue `CircleDot`), driven by the manual frontmatter value
- **AND** the secondary line under the title reads `1 running · 2 done`
- **AND** there is NO separate `<n> / <m>` counter badge in the header

#### Scenario: Card pill reflects RESOLVED even with all-FINISHED runs
- **GIVEN** an experiment with `frontMatter.status: RESOLVED` and 5 member runs all `FINISHED`
- **WHEN** the card renders
- **THEN** the pill is `RESOLVED` (emerald `CheckCircle2`)
- **AND** the secondary line reads `5 done`

#### Scenario: Card pill reflects ABANDONED with mixed runs
- **GIVEN** an experiment with `frontMatter.status: ABANDONED` and 4 member runs (2 FINISHED, 1 FAILED, 1 INTERRUPTED)
- **WHEN** the card renders
- **THEN** the pill is `ABANDONED` (stone-gray `XCircle`)
- **AND** the secondary line reads `2 done · 1 interrupted · 1 failed`

#### Scenario: Embedded runs table row click navigates with auto-expand
- **WHEN** the user clicks a row inside an experiment card
- **THEN** the URL becomes `/p/<project>/e/<exp-id>?run=<run-dir>` and
  the corresponding run panel is expanded on the destination page

#### Scenario: Empty experiment renders an empty runs table
- **GIVEN** an experiment with `runs: []` (zero member runs)
- **WHEN** the card renders
- **THEN** the runs table area shows an empty-state message ("No runs yet — open Claude Code to scaffold one")
- **AND** the secondary line under the title reads `no runs yet`
- **AND** the card pill renders the manual `status` (typically `OPEN`)
- **AND** tag/time footers still render normally

#### Scenario: Archived experiment card uses desaturated treatment
- **GIVEN** an experiment with `archived: true, status: RESOLVED`
- **WHEN** the card renders (whether checkbox-checked, in the segregated bucket, or anywhere)
- **THEN** the card outer wrapper has the `opacity-60` (or equivalent) overlay
- **AND** the status pill has an `Archive` icon prefix and a desaturated emerald variant
- **AND** the wrapper's `aria-label` contains the word `archived`

#### Scenario: Default unchecked grid hides archived items
- **GIVEN** a project with 5 active and 2 archived experiments
- **WHEN** the user navigates to `/p/<project>` for the first time (checkbox unchecked, no reveal)
- **THEN** the grid renders 5 cards
- **AND** below the grid a single line reads `Show 2 archived experiments`
- **AND** the 2 archived experiments are not in the DOM

#### Scenario: Checkbox checked interleaves archived and active
- **GIVEN** the same project
- **WHEN** the user ticks "Show archived"
- **THEN** the grid renders 7 cards in a single sort by `effective_updated_at` desc
- **AND** archived cards intermix with active cards in their natural sort position
- **AND** archived cards retain the desaturated treatment + Archive icon

### Requirement: Anomaly banner pinned at the top of the grid

The list page SHALL render a yellow-bordered card pinned **above** the
experiment-card grid whenever the project has at least one anomaly
(per `experiment-membership-anomalies`). The banner card:
- Header: `⚠ <count> issues need resolution` on the left; a single
  `Copy all` action button anchored to the top-right via shadcn's
  `CardAction` slot.
- Body: scrollable list of anomaly messages (`max-h-[20vh]
  overflow-y-auto`), one line per anomaly with the code, IDs, and
  message.
- `Copy all`: copies a text block with project name, ISO timestamp,
  and one line per anomaly formatted for paste into an agent.

The banner SHALL use the default shadcn Card and CardHeader rhythm —
no custom `py-*` overrides on the header and no `pt-0` on the
content. This keeps its vertical spacing consistent with every other
card on the project list page.

The banner SHALL NOT provide a `Hide` button. There is no
per-session dismissal of anomalies.

When the project has zero anomalies, the banner does not render.

#### Scenario: Banner appears with count
- **GIVEN** the project has 3 anomalies (1 ORPHAN_RUN, 1 PHANTOM_RUN_REF,
  1 MISMATCH_EXPERIMENT_REF)
- **WHEN** the user opens `/p/<project>`
- **THEN** the banner card is rendered above the grid with header text
  `⚠ 3 issues need resolution` and three lines in its body

#### Scenario: Copy all clipboard format
- **WHEN** the user clicks `Copy all` on the banner
- **THEN** the system clipboard contains text starting with `Anomalies
  from project <project> at <ISO time>:` followed by one bullet line
  per anomaly: `- <CODE>: <ids> — <message>`

#### Scenario: Default rhythm and right-anchored action
- **WHEN** the banner renders
- **THEN** its `CardHeader` does NOT carry a `py-3`, `flex-row`, or
  `space-y-0` override class, and its `CardContent` does NOT carry a
  `pt-0` override class
- **AND** the `Copy all` button carries `data-slot="card-action"` so
  the shadcn header grid lays it out in the top-right column

#### Scenario: Scroll-area max-height
- **GIVEN** a project with enough anomalies to overflow the banner
- **WHEN** the banner renders
- **THEN** the scrollable list `<ul>` carries the class
  `max-h-[20vh]` (NOT `max-h-[40vh]` — the historic value)

### Requirement: Orphan run cards in the grid

The list page SHALL render orphan runs as special grey-bordered cards
mixed into the experiment grid. Orphan runs (those with no parent
experiment, per `experiment-membership-anomalies`) SHALL be
distinguishable from experiment cards by header style:

- Header reads `⚠ Unassigned: <run-dir-name>` instead of an exp id +
  status counter.
- The card body shows a single-row table for the orphan run (status,
  created_at, files-count) — no embedded multi-row table.
- The card has no tag/time footer.
- Action button `Link to experiment...` opens a modal listing the
  project's experiments to bind to.

Orphan cards SHALL be sortable by the same controls as exp cards
(orphan card's "effective times" are the run's own `created_at` /
`updated_at`).

#### Scenario: Orphan card rendered next to exp cards
- **GIVEN** the project has 4 experiments and 1 orphan run
- **WHEN** the user opens the list page
- **THEN** the grid contains 5 cards total — 4 with the exp header
  style, 1 with the orphan grey-bordered header style

### Requirement: Experiment-doc detail page (v3)

The route `/p/<project>/e/<E-id-slug>` SHALL render an experiment detail
page with this layout:
- **Header bar**: title, aggregate status pill, effective times, tags,
  hypothesis-ref chips
- **Action bar**: `Edit markdown` (opens the editor on the exp doc),
  `Open Claude Code` (opens project root with exp-scoped preset prompt
  per `experiment-edit`)
- **Body markdown**: rendered `Motivation` / `Method` / `Plan` /
  `Conclusion` / `Caveats` / `Warnings` (in this order; the warnings
  table renders inline with the Run column)
- **Runs section header**: `Runs (<count>)`
- **Run panels**: one expandable panel per confirmed member run

The `Plan` section SHALL render as a Card (parallel to the other body
sections) using the same markdown renderer. The renderer SHALL display
GFM task list markers (`- [ ]` / `- [x]`, `* [ ]` / `* [x]` synonyms
also accepted) as native HTML checkboxes (`<input type="checkbox">`)
at every nesting depth supported by GFM. Checkboxes SHALL render in
the **disabled** state in v1 — clicking them SHALL NOT toggle their
state and SHALL NOT issue any network request. Toggling Plan items is
done via the existing `Edit markdown` dialog.

When the `Plan` section body is null/empty, the Card SHALL render a
placeholder (consistent with how other empty body sections are
rendered today) so the user sees that the section exists and is
editable.

Run panels SHALL be expanded by default (per the design discussion's
Q13 decision). The set of expanded panels SHALL be persisted in URL
hash and `localStorage` (key `memon:exp-page:<exp-id>:expanded`) so a
reload preserves the user's most-recent toggle state.

When the URL has `?run=<run-dir>`, that run's panel SHALL be expanded
on initial render and the page SHALL scroll to it.

#### Scenario: All run panels open by default on first visit
- **GIVEN** an experiment with 3 confirmed runs and no prior
  `localStorage` toggle state
- **WHEN** the user opens the exp detail page
- **THEN** all 3 run panels are rendered expanded

#### Scenario: ?run= query param expands and scrolls
- **GIVEN** the same experiment
- **WHEN** the URL is `/p/<project>/e/<exp-id>?run=run-2`
- **THEN** all 3 panels are expanded; the page scrolls to `run-2`'s
  panel

#### Scenario: Toggled-collapse persists across reload
- **GIVEN** the user collapsed the panel for `run-1`
- **WHEN** the user reloads the page
- **THEN** `run-1` is still collapsed; the others are still expanded

#### Scenario: Plan section renders nested task list with read-only checkboxes
- **GIVEN** an experiment doc whose `## Plan` body is:
  ```
  - [x] Run baseline at LR=1e-4
    - converged but loss plateaued early
  - [ ] Try LR=3e-4 + warmup
    - [ ] Sweep batch size [32, 64, 128]
  ```
- **WHEN** the user opens the exp detail page
- **THEN** the Plan Card renders three `<input type="checkbox">`
  elements, the first checked and all three with the `disabled`
  attribute set; the nested list visually indents the inner items;
  the reflection text under the first task renders as a sub-bullet

#### Scenario: Click on rendered checkbox is a no-op
- **GIVEN** the Plan Card rendered as in the previous scenario
- **WHEN** the user clicks the unchecked checkbox next to "Try LR=3e-4
  + warmup"
- **THEN** the checkbox state does not change, no network request is
  issued, and the only path to toggle is through the `Edit markdown`
  dialog

#### Scenario: Plan Card renders placeholder when section is empty
- **GIVEN** an experiment doc whose `## Plan` section is absent or
  whose body is empty
- **WHEN** the user opens the exp detail page
- **THEN** the Plan Card renders the same empty-section placeholder
  treatment as `Method` / `Conclusion` / `Caveats` show today when
  empty

### Requirement: Run panel content with lazy detail loading

Each run panel SHALL render two phases:
1. **Eager phase** (data from `/api/experiments/:id`): summary row with
   status, run dir name, created_at HH:MM, duration-or-status,
   files-count.
2. **Lazy phase** (per-run fetch from `/api/runs/:run-id`): full
   frontmatter table, `Setup` rendered markdown, `Result` rendered
   markdown, manual `Artifacts` list, automatic file listing under the
   run dir, log tail viewer, and the panel-level action bar.

Until the lazy fetch resolves, the panel SHALL render skeleton UI for
the lazy content. Multiple panels MAY fire requests concurrently.

#### Scenario: Page renders before lazy details resolve
- **GIVEN** an exp page with 5 member runs
- **WHEN** the page first paints
- **THEN** the eager-phase summary rows render immediately for all 5
  runs, the lazy-phase content shows a skeleton in each panel

#### Scenario: Lazy fetch failure surfaces inline
- **WHEN** `/api/runs/<id>` returns 500 for one of the panels
- **THEN** that panel's lazy area shows an error banner with a Retry
  button; the other panels are unaffected

### Requirement: Per-run-panel action bar

Each expanded run panel SHALL render three action buttons inside the
panel body (positioned at the top or bottom of the run-detail content,
implementer's choice):
- `Edit markdown (run)` — opens the editor on the run's README
- `Open Claude Code (run)` — opens at the project root with a preset
  prompt naming the run dir and parent exp doc
- `Archive` — writes `<run-dir>/.archived` and removes the run from
  the page's expanded set

#### Scenario: Edit markdown (run) targets the run README
- **WHEN** the user clicks `Edit markdown (run)` inside the panel for
  `bar-260501-100000`
- **THEN** the editor opens with the content of
  `<projectRoot>/<…>/bar-260501-100000/README.md` (NOT the exp doc),
  and Save POSTs to `/api/runs/bar-260501-100000/readme`

### Requirement: URL redirects from legacy run paths

Legacy run-detail URLs SHALL redirect to the new exp-detail URL with a
`?run=` query param. The route `/p/<project>/r/<run-dir>` (and its v2
form `/p/<project>/experiments/<run-dir>`) SHALL respond with a 308
(or client-side replace) to `/p/<project>/e/<E-id-of-parent>?run=<run-dir>`
when the run has a confirmed parent experiment. When the run has no
parent (orphan), the redirect SHALL go to `/p/<project>` and the page
SHALL scroll to the orphan card for that run.

#### Scenario: Bound run redirects with run param
- **GIVEN** a run `bar-260501-100000` bound to `E0001-foo`
- **WHEN** the user navigates to `/p/<project>/r/bar-260501-100000`
- **THEN** the URL is rewritten to
  `/p/<project>/e/E0001-foo?run=bar-260501-100000`

#### Scenario: Orphan run redirects to project list
- **GIVEN** an orphan run `solo-260501-100000`
- **WHEN** the user navigates to `/p/<project>/r/solo-260501-100000`
- **THEN** the URL is rewritten to `/p/<project>` and the page scrolls
  to the orphan card

### Requirement: List-page section ordering

The project list page SHALL render its top-level sections in this
fixed top-to-bottom order:

1. The page heading (`<h2>Experiments (<count>)</h2>`).
2. The anomaly banner (when at least one anomaly exists; otherwise
   absent).
3. The experiment-card grid (or its empty-state message).

The heading text and level SHALL NOT change based on whether
anomalies are present — it always reads `Experiments (<count>)` and
always sits at the top.

#### Scenario: Heading sits above the banner
- **GIVEN** a project with at least one anomaly
- **WHEN** the user opens `/p/<project>`
- **THEN** the rendered DOM order under the page wrapper is:
  `<h2>Experiments (N)</h2>` first, then the anomaly banner card,
  then the grid

#### Scenario: Heading still on top when no anomalies
- **GIVEN** a project with zero anomalies
- **WHEN** the user opens `/p/<project>`
- **THEN** the page heading is the first child of the page wrapper
  (the anomaly banner returns null and is not in the DOM at all)

### Requirement: Tag typography on v3 exp surfaces

Tag Badges (`#foo`, `#bar`, …) on v3 exp surfaces SHALL render at
`text-[10px]` so they read as compact metadata rather than
competing with primary labels (the page title, the monospace E-id,
section headings). This applies to:

- The exp detail page header tag list
  (`apps/web/components/experiment-page.tsx`).
- The exp card grid footer tag list
  (`apps/web/components/experiment-card-grid.tsx`).
- The run-panel frontmatter card tag list (already at
  `text-[10px]` since the bug-3 run-panel rich port).

#### Scenario: Tags on the exp detail page header are compact
- **WHEN** the user opens `/p/<project>/e/<exp-id>` for an exp doc
  whose frontmatter has tags
- **THEN** the rendered tag Badges carry the className
  `text-[10px]` (NOT `text-xs`)

#### Scenario: Tags on the exp card grid are compact
- **WHEN** the user opens `/p/<project>` and the project has at
  least one exp doc with tags
- **THEN** the rendered tag Badges in each card's footer carry
  `text-[10px]`

### Requirement: Exp card title navigates to the detail page

The card title SHALL be rendered as a Link that navigates to the exp detail page (`/p/<project>/e/<exp-id>`) — the same URL the existing E-id link points at — so clicking the title text takes the user to the detail page. The title link SHALL carry `hover:underline` for the standard click affordance. The E-id link remains a separate Link so the monospace id keeps its canonical visual treatment.

#### Scenario: Click on title navigates
- **GIVEN** a project with at least one exp doc whose title is `vpred convergence`
- **WHEN** the user clicks anywhere on the rendered title text
- **THEN** the browser navigates to `/p/<project>/e/<exp-id>` (the same URL the E-id link points at)

#### Scenario: Title shows hover affordance
- **WHEN** the user hovers the title text
- **THEN** the text shows the underline affordance (the link is rendered with the `hover:underline` Tailwind utility)

### Requirement: Markdown body rendering supports LaTeX math

The shared `<Markdown>` component SHALL render LaTeX math expressions written with conventional dollar-sign delimiters wherever exp-doc or run-README markdown is shown (experiment-doc detail page, run panels, inbox viewer, and any future surface that uses the same component).

Specifically:

- Inline math wrapped in single dollars (`$...$`) SHALL render as
  inline KaTeX-rendered HTML inside the surrounding paragraph.
- Display math written as a `$$`-fenced block — i.e., `$$` on a line
  by itself, the formula body on one or more following lines, and a
  closing `$$` on its own line — SHALL render as a block-level
  KaTeX-rendered formula with display-style spacing. This matches the
  `micromark-extension-math` flow-construct grammar (analogous to a
  fenced code block, but with `$$` delimiters). Authors who instead
  write `$$x$$` inline on a single line SHALL get an inline KaTeX
  span, which is the documented standard behaviour of the toolchain
  and is acceptable for occasional one-liners.

Math expressions SHALL NOT be rendered inside fenced code blocks
(```), indented code blocks, or inline `<code>` spans — those continue
to be shown verbatim. Math content outside code SHALL coexist with
existing markdown features (GFM tables, task lists, footnotes,
syntax-highlighted code chips) without altering their rendering.

The required toolchain SHALL be `remark-math` in the remark plugin
chain and `rehype-katex` in the rehype plugin chain, with KaTeX's
stylesheet imported by the renderer module so the host application
loads it exactly once. The renderer MUST NOT depend on any runtime
CDN fetch for fonts or CSS.

#### Scenario: Inline math renders as KaTeX inside a paragraph

- **WHEN** an exp-doc README body contains a paragraph
  `The loss is $\mathcal{L}_{KL}$ across heads.`
- **THEN** the exp-doc detail page renders that paragraph with the
  `$\mathcal{L}_{KL}$` portion replaced by a `<span class="katex">…</span>`
  containing KaTeX-rendered math, and the surrounding text remains
  inline (no forced line break).

#### Scenario: Fenced display math renders as a KaTeX block

- **WHEN** an exp-doc README body contains a fenced display-math block
  written across three lines: a line containing just `$$`, then a line
  `\mathcal{L} = \sum_i \mathrm{KL}(p_i \Vert q_i)`, then a closing
  line `$$`
- **THEN** the exp-doc detail page renders that block as a
  `<span class="katex-display">…</span>` (or equivalent KaTeX block
  wrapper) on its own line, with the formula in display style and
  separated from surrounding paragraphs by block-level vertical
  spacing.

#### Scenario: Single-line `$$x$$` renders as an inline KaTeX span

- **WHEN** an exp-doc README body contains a paragraph that uses
  `$$\mathcal{L}$$` on a single line without a surrounding fence
- **THEN** the renderer produces an inline `<span class="katex">…</span>`
  inside the paragraph (matching the `micromark-extension-math`
  documented behaviour for one-line `$$`), and does NOT crash, drop
  the math, or render the raw dollars.

#### Scenario: Dollar signs inside fenced code blocks stay literal

- **WHEN** an exp-doc README body contains a fenced code block whose
  content includes a line `export PRICE=$5` (an unescaped `$` inside
  a fence)
- **THEN** the rendered code block shows `export PRICE=$5` verbatim
  with no math substitution and no `.katex` markup, preserving the
  fenced-block behavior of the renderer.

#### Scenario: Run-panel READMEs render math identically to exp docs

- **WHEN** the run panel for a run whose README contains both inline
  and display math is expanded inside an exp-doc page
- **THEN** the rendered `Setup` and `Result` sections show the math
  using the same KaTeX pipeline as the parent exp doc, with no
  per-surface configuration required by the caller.

#### Scenario: KaTeX stylesheet is bundled, not fetched at runtime

- **WHEN** the production build of `apps/web` is served and a page
  that uses `<Markdown>` is requested
- **THEN** the page's CSS bundle contains KaTeX style rules (e.g.,
  selectors targeting `.katex` / `.katex-display`), and the page
  network log shows zero requests to any external CDN host for KaTeX
  assets.

### Requirement: Markdown body overflow is scrollable, not clipped

The shared `<Markdown>` component SHALL ensure that wide content
(GFM tables, fenced code blocks, and KaTeX display formulas)
becomes horizontally scrollable inside its parent container rather
than being clipped, on every surface that renders exp-doc or
run-README markdown (experiment-doc detail page, run panels, inbox
viewer).

Specifically:

- Every GFM `<table>` rendered by the component SHALL be wrapped in
  a block-level container with `overflow-x-auto` so that a wide
  table produces a horizontal scrollbar within the parent Card
  rather than clipping its rightmost columns.
- Fenced code blocks (`<pre>`) SHALL scroll horizontally when their
  content exceeds the available width — either by inheriting the
  prose `overflow-x: auto` default or by an explicit override on
  the `<Markdown>` root.
- KaTeX display blocks (`.katex-display`) SHALL continue to scroll
  horizontally as specified by the prior change.
- The `<Markdown>` root SHALL set `min-width: 0` (Tailwind
  `min-w-0`) so that, when placed inside a flex or grid parent,
  its descendants' `overflow-x-auto` actually engages instead of
  the wrapper expanding past its share and being clipped by an
  ancestor's `overflow-hidden`.
- The fix SHALL be implemented in the renderer; the `Card`
  primitive (`apps/web/components/ui/card.tsx`) MUST NOT be
  modified to drop `overflow-hidden`.

#### Scenario: Wide GFM table scrolls inside the Card

- **WHEN** an exp-doc README body contains a GFM table whose
  intrinsic width exceeds the available column width on the
  exp-doc detail page (e.g., the multi-column loss-formula table
  in the cited E0005 README)
- **THEN** the rendered table is wrapped in a block-level
  `overflow-x-auto` container so the user can horizontally scroll
  to see all columns, and no cell content is clipped by the
  parent Card.

#### Scenario: Wide fenced code block scrolls horizontally

- **WHEN** a markdown body contains a fenced code block with a
  very long single line (e.g., a long shell command without line
  breaks)
- **THEN** the rendered `<pre>` shows a horizontal scrollbar; the
  line is NOT wrapped, NOT truncated, and NOT clipped by an
  ancestor's `overflow-hidden`.

#### Scenario: Short tables do not show a scrollbar

- **WHEN** a markdown body contains a short two-column GFM table
  that fits well within the available width
- **THEN** the rendered table is still wrapped in the
  `overflow-x-auto` container but no horizontal scrollbar is
  visible (because there is no overflow), and the table renders
  with the usual prose spacing.

#### Scenario: Markdown root carries `min-w-0`

- **WHEN** the `<Markdown>` component renders any content
- **THEN** the outermost wrapper div's class list contains
  `min-w-0` so that flex/grid ancestors do not force the wrapper
  to its content's min-width, which would otherwise defeat the
  child-level `overflow-x-auto` scroll containers.

### Requirement: `SessionProvider` hydrates `{ role, scopeProjects }` on every page

The root layout (`apps/web/app/layout.tsx`) SHALL emit a server-side `<script id="memon-session" type="application/json">` block in `<head>` carrying the request's session shape:

```json
{
  "role": "owner" | "viewer" | "anon",
  "scopeProjects": ["project-a"]   // for viewer; empty array for owner/anon
}
```

The values SHALL be the SAME role/scope used by middleware for this request (server consults `req.role` / `req.scopeProjects` from the middleware-injected context). A client-side `SessionProvider` React context SHALL parse the JSON during initial hydration and expose `useSession()` returning `{ role, scopeProjects }`. The hook SHALL be SSR-safe (returns the hydrated value during server render).

#### Scenario: Owner session hydration
- **WHEN** an owner GETs `/p/project-a`
- **THEN** the response HTML contains `<script id="memon-session" type="application/json">{"role":"owner","scopeProjects":[]}</script>`
- **AND** `useSession()` returns `{ role: 'owner', scopeProjects: [] }` on first render

#### Scenario: Viewer session hydration
- **WHEN** a viewer scoped to project-a GETs `/p/project-a`
- **THEN** the script block reads `{"role":"viewer","scopeProjects":["project-a"]}`
- **AND** `useSession()` reflects that on first render

#### Scenario: Anonymous on /login
- **WHEN** an anonymous user GETs `/login`
- **THEN** the script block reads `{"role":"anon","scopeProjects":[]}`

### Requirement: `<ViewerGuard>` wrapper disables gated controls in viewer mode

A `<ViewerGuard>` wrapper component SHALL be available in `@/components/viewer-guard.tsx`. Usage:

```tsx
<ViewerGuard reason="Edit markdown">
  <Button onClick={...}>Edit markdown</Button>
</ViewerGuard>
```

When the active session is `viewer`, `ViewerGuard` SHALL:

- Clone its child and force `disabled={true}` AND `aria-disabled="true"`.
- Wrap in a shadcn `<Tooltip>` whose content reads: `Viewer mode — action disabled` (with the `reason` prop appended in parens if provided).
- Suppress `onClick` / `onPress` handlers so a click on the disabled control does nothing.

When the active session is `owner`, `ViewerGuard` SHALL render its child unchanged.

When the active session is `anon`, `ViewerGuard` SHALL render the child but force-disable it the same way as viewer (anon should not reach a page with gated controls in practice; this is defense-in-depth).

#### Scenario: Owner sees enabled control
- **WHEN** an owner views a page with `<ViewerGuard><Button>Edit</Button></ViewerGuard>`
- **THEN** the Button renders enabled with no tooltip wrapper

#### Scenario: Viewer sees disabled control with tooltip
- **WHEN** a viewer views the same page
- **THEN** the Button renders disabled with `aria-disabled="true"`
- **AND** hovering produces a tooltip reading `Viewer mode — action disabled (Edit markdown)`
- **AND** clicking does nothing (handler not invoked)

### Requirement: All mutating / shell controls wrapped in `<ViewerGuard>`

Every dashboard control whose action maps to a `mutating` or `shell` route SHALL be wrapped in `<ViewerGuard>` (or, equivalently, take a `disabled` prop driven by `useSession().role === 'viewer'`). The required wrap set is:

- `EditMarkdownButton` (`apps/web/components/edit-markdown-button.tsx`)
- `EditReadmeButton` (`apps/web/components/edit-readme-button.tsx`)
- `OpenClaudeCodeButton` (`apps/web/components/open-claude-code-button.tsx`)
- `AskClaudeCodeButton` (`apps/web/components/ask-claude-code-button.tsx`)
- `TerminalButton` (`apps/web/components/terminal-button.tsx`)
- `StatusEdit` (`apps/web/components/status-edit.tsx`)
- `AddNoteButton` (`apps/web/components/add-note-button.tsx`)
- `AddJournalEntryButton` (`apps/web/components/add-journal-entry-button.tsx`)
- All buttons in `/manage/tmux/tmux-page.client.tsx` (start / stop / attach / kill rows).
- All "Create experiment" / "Link" / "Unlink" / "Archive" affordances.
- All Warnings-table CRUD buttons (add / edit / delete rows).
- The "Manage share links" button itself (only owner can manage).
- The `OpenWithButton` split-button: its `Open Claude Code` and `Open browser terminal` tab options SHALL be disabled in viewer mode; the `Open in editor` (file system path copy) tab option MAY remain enabled since it does not call any API.

#### Scenario: Viewer page has every gated button disabled
- **WHEN** a viewer GETs `/p/project-a` (exp page, run page, hypotheses page, etc.)
- **THEN** every enumerated control above renders disabled with the appropriate tooltip
- **AND** none of the underlying API calls can be triggered from the UI

#### Scenario: Owner page is unchanged
- **WHEN** an owner GETs the same pages
- **THEN** every control renders enabled with no tooltip overlay (no behavior change from today)

### Requirement: Sidebar narrows to scope-set projects in viewer mode

The application sidebar (`apps/web/components/app-sidebar.tsx`) SHALL render different content for owner vs. viewer sessions:

- **Owner**: full project list (unchanged from today).
- **Viewer**: ONLY the projects listed in `useSession().scopeProjects`. The project switcher dropdown SHALL be replaced by a read-only label when `scopeProjects.length === 1`. Sidebar nav-items that are inherently project-scoped (Experiments, Hypotheses, Journal, Reports, Digests) SHALL link into the scope-set project; nav-items that aggregate across projects (e.g., a global "All anomalies" link) SHALL either be hidden OR filtered by scope.
- **Anon**: sidebar SHALL be hidden or replaced by the login-page chrome only.

#### Scenario: Viewer with single-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a"]` opens the dashboard
- **THEN** the sidebar shows only "project-a" entries
- **AND** the project switcher is replaced by a `<span>project-a</span>` label

#### Scenario: Viewer with multi-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a", "project-b"]` opens the dashboard
- **THEN** the sidebar shows project entries for both projects
- **AND** the project switcher dropdown is present, populated with the two

#### Scenario: Viewer aggregate links hidden
- **WHEN** a viewer is on any page
- **THEN** the sidebar does NOT show a "Manage tmux" link (the manage page is shell-classed)
- **AND** it does NOT show a "Settings" link (settings is owner-only mutating)
- **AND** it does NOT show the Slurm status widget (the `slurm-status` capability is owner-only; the widget is gated on `role !== 'viewer'` in the same conditional block that gates Manage tmux)

### Requirement: Viewer-mode banner with "Log in as owner" link

A persistent banner using shadcn `<Alert>` SHALL appear at the top of every page when `useSession().role === 'viewer'`. The banner copy SHALL be:

```
Viewer mode — read-only access to <project-list>.
[Log in as owner] to access write actions.
```

The link points to `/login?next=<current-path>`. The banner SHALL be dismissible PER-SESSION (a state stored in `sessionStorage`) but SHALL re-appear on the next browser tab open.

#### Scenario: Banner appears for viewer
- **WHEN** a viewer with scope `["project-a"]` navigates to `/p/project-a`
- **THEN** the page renders an Alert banner at the top of the main content area reading "Viewer mode — read-only access to project-a. [Log in as owner]..."
- **AND** the [Log in as owner] is a link to `/login?next=/p/project-a`

#### Scenario: Banner absent for owner
- **WHEN** an owner navigates to any page
- **THEN** no viewer-mode banner appears

#### Scenario: Dismissed banner reappears in new tab
- **WHEN** the viewer dismisses the banner and opens a new tab
- **THEN** the banner reappears in the new tab (sessionStorage scope, not localStorage)

### Requirement: "Manage share links" dialog on the project page header

The project page header (`apps/web/app/p/[project]/layout.tsx` or the page itself) SHALL render an owner-only "Share" button. Clicking opens a shadcn `<Dialog>` containing:

- A `<Table>` listing existing shares: columns `Created`, `Label`, `Expires`, `Copy URL`, `Revoke`.
- An "Issue new share" form at the bottom: `<Input>` for label, optional expiry select (`30d`, `90d`, `never`), `<Button>` to create.
- On create, a toast (sonner) confirms creation AND auto-copies the URL to clipboard. The new row appears in the table without page reload.
- On revoke, a confirm prompt (shadcn `AlertDialog`), then the row disappears.
- All operations go through `/api/projects/<project>/shares` (GET / POST / DELETE) — see project-share spec.

The Share button SHALL render disabled (via `<ViewerGuard>`) in viewer mode — viewers cannot manage shares.

#### Scenario: Owner opens manage-shares dialog
- **WHEN** the owner clicks "Share" on `/p/project-a`
- **THEN** a Dialog opens showing the project's current shares (loaded via GET /api/projects/project-a/shares)

#### Scenario: Owner creates a new share
- **WHEN** the owner submits the "Issue new share" form with label "Reviewer"
- **THEN** POST /api/projects/project-a/shares is called; on success the dialog shows a new row, the share URL is copied to clipboard, and a toast confirms

#### Scenario: Owner revokes a share
- **WHEN** the owner clicks Revoke on a row and confirms in the AlertDialog
- **THEN** DELETE /api/projects/project-a/shares/<id> is called; on success the row disappears

#### Scenario: Viewer sees disabled Share button
- **WHEN** a viewer views `/p/project-a` (assuming they have scope for that project)
- **THEN** the "Share" button renders disabled with the viewer-mode tooltip

### Requirement: `/login` page renders a credential form for anon access

`GET /login` (anon-classed) SHALL render a centered shadcn `<Card>` with:
- A title `Sign in to memon`
- An `<Input name="username">` (default value `admin`, focused on load)
- An `<Input name="password" type="password">`
- A `<Button type="submit">Sign in</Button>`
- A small footer linking to `/api/auth/check` for diagnostics (NOT a visible link for normal users — visible via inspector for debugging)

The form SHALL POST to `/api/auth/login` with `application/x-www-form-urlencoded` body containing `username`, `password`, and optionally `next` (carried over from `?next=` query). On the response 302, the browser follows to the next URL. On failure, the page re-renders with an inline error message above the form.

The page SHALL display a small "Powered by memon" footer and SHALL look at home on small viewports (responsive, single-column layout, max-width ~24rem).

#### Scenario: Anon visits /login
- **WHEN** an anonymous browser GETs `/login` (no cookies)
- **THEN** the response is 200 with HTML containing the login form
- **AND** the username field is pre-filled `admin` and focused

#### Scenario: Login redirects to next
- **WHEN** an anon submits the form with valid credentials and the URL was `/login?next=/p/foo`
- **THEN** on success the response 302s to `/p/foo`
- **AND** the `memon-session` cookie is set

#### Scenario: Invalid password
- **WHEN** the form is submitted with a wrong password
- **THEN** the page re-renders with `Invalid credentials` shown above the form
- **AND** the username field is preserved; the password field is empty

#### Scenario: Login from viewer state
- **WHEN** a viewer-with-shares opens `/login` and submits valid credentials
- **THEN** the response 302s; the `memon-session` cookie is set; the `memon-shares` cookie is unchanged
- **AND** subsequent pages render in owner mode (banner gone, all controls enabled)

### Requirement: Code-review surface in project navigation

The per-project navigation SHALL include a "Code review" entry that links to
`/p/<project>/code-review`, shown alongside the existing experiments /
hypotheses / journal / reports / digests surfaces and marked active when the
current path is under `/p/<project>/code-review`. The detail route
`/p/<project>/code-review/<...id>` SHALL be reachable both from that list and
from the experiment detail page's associated-reviews panel.

#### Scenario: Nav entry present and active
- **WHEN** the user is on `/p/<project>/code-review` or a detail route beneath it
- **THEN** the navigation shows a "Code review" entry in the active state

#### Scenario: Deep link resolves
- **WHEN** the user opens `/p/<project>/code-review/experiments/E0042-attn/code-review/2026-05-24-foo` directly
- **THEN** the detail page renders that doc (subject to auth)

### Requirement: Experiment detail renders v6 and legacy sections without hiding source

The Experiment detail API SHALL expose the ordered raw README H2 occurrences, managed-document state, normalized managed-document data, shared Markdown projections, and diagnostics. The detail page SHALL render Results immediately after the Experiment header/compatibility notice, preserve source order among the remaining README sections, and render Runs as the final page card. For a valid Implementation, Investigation, or Results pointer, it SHALL render a dedicated structured component from the normalized YAML model. For an unsupported or duplicate heading, it SHALL render the original body with a visible compatibility diagnostic. For a managed-pointer conflict, it SHALL render and highlight the real README body rather than substituting YAML.

An Experiment with unsupported, incomplete, or conflicting document structure SHALL remain readable. Mutating controls MAY be disabled until the bundle passes v6 lint.

#### Scenario: Legacy content remains readable before migration
- **GIVEN** a v5 Experiment has `Method`, `Plan`, and `Caveats` but no v6 sidecars
- **WHEN** the Experiment detail page opens under the v6 web application
- **THEN** all three original bodies remain visible with compatibility diagnostics
- **AND** the page does not fabricate managed YAML content

#### Scenario: Valid managed section uses normalized structured UI
- **GIVEN** an exact `## Results` pointer and valid `results.yaml`
- **WHEN** the Experiment detail page opens
- **THEN** the Results card renders an interactive table from the same normalized document used by the CLI renderer
- **AND** known Run IDs link to their memon panel and available W&B page
- **AND** the literal pointer is still returned by a whole-README source read

### Requirement: Results table is controllable, bounded, and horizontally scrollable

The structured Results table SHALL preserve `results.yaml` column order for unpinned columns, with stable built-in Variant/Status and provenance/evidence columns around the declared columns. Every cell SHALL display at most a user-selected positive number of visual lines, defaulting to one line. Literal `<br>`, `<br/>`, `<br />`, and newline boundaries in displayed scalar text SHALL render as line breaks rather than visible markup. The table SHALL use automatic content-based column sizing inside an unbounded horizontal scroll container.

When a declared Results column has an annotation description, hovering or
keyboard-focusing its rendered table header SHALL show that Markdown in a
lightweight popup. When a rendered schema cell's textual value has an exact
`value_descriptions` entry, hovering or focusing that cell SHALL show the
matching Markdown. Headers and cells without descriptions SHALL retain their
existing display and interaction behavior.

#### Scenario: Optional Results explanations appear in context
- **GIVEN** `precision` has a column description and `bf16` has a value description
- **WHEN** the user hovers the Precision header and then a `bf16` cell
- **THEN** each popup renders its corresponding Markdown
- **AND** an undescribed `fp32` cell has no annotation popup

Before the table, the page SHALL render one checkbox control per available column in the original YAML/built-in order, independent of pinning. Each control SHALL show the number of distinct non-empty values present for that column. Hovering or focusing the value-domain affordance SHALL show those values one per list row.

Columns declared with `group: metric` SHALL be visually distinguishable from parameters through a restrained pale-blue treatment in the column controls, table header, and table body. Metric controls SHALL NOT display a redundant `Metric` badge and SHALL NOT open a value-domain preview on hover or focus; their distinct-value count MAY remain visible. Parameter columns SHALL retain the default treatment and value-domain preview. Project-level starred-column highlighting SHALL take visual precedence when a metric column is also starred.

An exact HTTP(S) scalar URL whose hostname is `wandb.ai` or a subdomain of `wandb.ai` SHALL render as an external link with primary-color emphasis, underline styling, and a chart/line-plot leading icon. Its visible label SHALL be the decoded final non-empty URL path segment, falling back to the hostname when no segment exists, while its full original URL remains the link target and appears in a hover/focus tooltip. The compact link SHALL constrain its visible width and truncate unusually long final IDs. Non-W&B URLs SHALL retain the ordinary scalar-text rendering in this change, and hosts that merely contain `wandb.ai` without being that domain or a subdomain SHALL NOT receive the specialization.

#### Scenario: Dense Results stay scannable
- **GIVEN** a Results document with many columns, long strings, and multi-line values
- **WHEN** the user opens the Experiment page without saved preferences
- **THEN** every cell is bounded to one visual line
- **AND** the table can scroll horizontally without clipping columns
- **AND** line-break markup is rendered as actual line breaks

#### Scenario: User filters columns and inspects their domains
- **GIVEN** a declared Results column has three distinct non-empty values across Variants
- **WHEN** the user views the column controls
- **THEN** that column's control shows a distinct-value count of three
- **AND** its value-domain preview lists the three values on separate rows
- **AND** clearing its checkbox removes the column from the table without modifying YAML

#### Scenario: Metric columns are recognizable at a glance
- **GIVEN** Results declares one `group: parameter` column and one `group: metric` column
- **WHEN** the column controls and table render
- **THEN** the metric control, header, and body cells share a pale-blue accent while the parameter column keeps the default treatment
- **AND** the metric control contains no `Metric` badge and hovering it does not reveal values
- **AND** hovering the parameter control still reveals its value-domain preview

#### Scenario: W&B URL cells stay compact and identifiable
- **GIVEN** a Results scalar value `https://wandb.ai/acme/project/runs/a1b2c3d4`
- **WHEN** the table renders that cell
- **THEN** it shows a chart icon and underlined `a1b2c3d4` link instead of the complete URL
- **AND** activating the link opens the complete URL
- **AND** hovering or focusing the link reveals the complete URL

### Requirement: Direct YAML edits refresh without corrupting README locks

The Web runtime SHALL poll each managed YAML sidecar and the Experiment bundle directory in addition to README.md. A sidecar edit SHALL reload the complete bundle and emit the normal Experiment change signal. The aggregate bundle mtime MAY advance for list activity, but every README mutation SHALL use README.md's own mtime as its optimistic lock.

#### Scenario: Agent edits only results.yaml
- **GIVEN** an Experiment page is backed by a valid cached v6 bundle
- **WHEN** an Agent directly updates only `results.yaml`
- **THEN** the runtime reloads the Results projection without requiring a restart or README edit
- **AND** a later status/archive mutation using `readmeMtime` is not rejected because the YAML is newer

### Requirement: Embedded Report HTML uses a responsive, recoverable iframe wrapper

When the shared Markdown renderer encounters the existing local `.html`/`.htm` image syntax for a directory Report, it SHALL render a reusable Report HTML embed wrapper rather than a bare iframe. The iframe SHALL keep the resolved same-origin Report asset URL, an accessible title derived from the Markdown alt/title, lazy loading, and no `sandbox` attribute.

The wrapper SHALL provide:

- a visible loading state until the iframe reports a successful load;
- a visible error state when the iframe emits a load error or does not load within a bounded timeout after approaching the viewport;
- a Retry action that starts a fresh iframe load;
- an Open in new tab action using the same Report asset URL with opener isolation;
- an Expand action that covers the current application page without invoking the browser Fullscreen API.

Normal embed height SHALL use a small-viewport-height fallback and a dynamic-viewport-height override (`svh` then `dvh`, or equivalent) with bounded responsive sizing. It SHALL fit within the usable viewport at 390 CSS pixels wide and SHALL NOT impose a fixed desktop minimum taller than that viewport. In expanded mode, the wrapper and iframe SHALL fill the available dynamic viewport above the current browser page.

The host SHALL NOT inspect iframe document height, accept postMessage resize events, require declared dimensions/manifest data, or otherwise auto-size to iframe content. The existing same-origin unsandboxed trust model and server-side Report-directory path confinement remain unchanged.

#### Scenario: Loading succeeds

- **GIVEN** a bundle README containing `![Training curves](./views/loss-curves/index.html)`
- **WHEN** the Report detail renders and a near-viewport iframe has not fired `load`
- **THEN** the wrapper shows a loading state and its view actions remain identifiable
- **WHEN** the iframe fires `load`
- **THEN** the loading state clears and the iframe remains titled `Training curves` without a `sandbox` attribute

#### Scenario: Failed load can be retried or opened separately

- **GIVEN** a near-viewport embedded Report view emits an error or exceeds the bounded load timeout
- **WHEN** the wrapper enters its error state
- **THEN** it shows an understandable error with Retry and Open in new tab
- **WHEN** the user chooses Retry
- **THEN** the wrapper starts a fresh iframe load rather than leaving the failed instance as the terminal state

#### Scenario: Fullscreen fills the dynamic viewport

- **GIVEN** a Report view is loaded
- **WHEN** the user activates the replacement in-page Expand action
- **THEN** the embed wrapper covers the application page and the iframe fills its available `dvh`-based viewport
- **AND** the visible Exit action or Escape returns it to the responsive inline height without browser fullscreen

#### Scenario: Fullscreen unavailable falls back gracefully

- **GIVEN** the browser does not support or permit the Fullscreen API
- **WHEN** the user activates Expand
- **THEN** page-internal expanded mode still works because it does not call that API
- **AND** Open in new tab remains available and points to the same Report asset URL

#### Scenario: Mobile and desktop host sizing remain usable

- **WHEN** the same Report embed is rendered once at exactly 390 CSS pixels wide and once at a desktop width of at least 1280 CSS pixels
- **THEN** loading/error text and all responsive menu or direct actions remain reachable without overlap or page-level horizontal clipping at both widths
- **AND** the mobile embed height fits the usable viewport without inheriting a desktop-sized fixed minimum

#### Scenario: Existing Report forms keep their behavior

- **GIVEN** an old directory bundle embeds `![Chart](./chart.html)`, another README uses `[Open chart](./chart.html)`, and a standalone Markdown Report has no resource base URL
- **WHEN** all three render after this change
- **THEN** the old image-form HTML gets the responsive wrapper, the normal link remains a link, and the standalone Markdown Report renders without an iframe
- **AND** none requires a manifest or file rewrite

### Requirement: Report HTML embeds share stepped zoom controls

A rendered Report containing one or more embedded HTML iframe views SHALL expose zoom-out and zoom-in controls in the embed toolbar. The zoom SHALL default to `100%`, where the iframe uses its original scale, and each control activation SHALL change the percentage by exactly 10 percentage points. The current percentage SHALL be visibly and accessibly labelled.

All HTML iframe embeds within the same rendered Report surface SHALL share the current percentage so one adjustment applies uniformly. Zooming SHALL scale the iframe document view while preserving the host Report layout, iframe viewport boundary, loading/error lifecycle, fullscreen behavior, and open-in-new-tab destination. The controls SHALL enforce a finite supported range and disable the direction that has reached its bound.

The iframe toolbar SHALL retain compact control heights on narrow mobile viewports so its zoom, open-in-new-tab, and fullscreen actions do not consume disproportionate vertical space.

#### Scenario: Zoom changes in ten-percent steps
- **GIVEN** an embedded HTML Report is ready at the default `100%`
- **WHEN** the user activates Zoom in once and Zoom out twice
- **THEN** the displayed percentages progress through `110%`, `100%`, and `90%`
- **AND** the iframe view uses the corresponding scale at each step

#### Scenario: Multiple Report iframes share one percentage
- **GIVEN** one rendered Report contains two embedded HTML iframe views
- **WHEN** the user changes either embed from `100%` to `110%`
- **THEN** both iframe views render at `110%`
- **AND** both toolbars display `110%`

#### Scenario: Original scale remains the default
- **WHEN** a Report HTML embed first mounts with no adjustment
- **THEN** its visible zoom value is `100%`
- **AND** the iframe is not enlarged or reduced from its original scale

#### Scenario: Mobile toolbar stays compact
- **GIVEN** a Report HTML embed is rendered on a narrow mobile viewport
- **WHEN** its toolbar actions are displayed
- **THEN** the zoom, open-in-new-tab, and fullscreen buttons use the compact toolbar height
- **AND** the iframe content keeps the remaining vertical space

### Requirement: Results ordering is directly draggable and preference-backed

Every Results column control and rendered table header SHALL be draggable against other columns. Dropping a column from either surface SHALL update one shared ordered list of stable column IDs, and both the checkbox controls and table SHALL immediately reflect the same saved order. Pinned-left, unpinned, and pinned-right placement SHALL remain in force, with the shared order applied within each group. Hidden columns SHALL remain in the ordered list and retain their position when shown again.

Whenever pinned columns use sticky positioning, every pinned header and body cell SHALL render an opaque background so horizontally scrolled content cannot show through. Metric columns SHALL use an opaque pale-blue surface and starred columns SHALL use an opaque amber surface with starred emphasis taking precedence. When the pinned-width fallback disables sticky positioning, the normal non-sticky accent treatment MAY remain translucent.

The shared column order SHALL be stored in the existing Results UI preference document alongside checkbox visibility and SHALL use the existing browser/owner SQLite synchronization. It SHALL NOT modify `results.yaml`. Restoring an absent or empty order SHALL use built-in/YAML order; restoring a partial or stale order SHALL discard unknown/duplicate IDs and append newly available columns in built-in/YAML order.

Saved row-filter badges SHALL be draggable into a persistent display and evaluation order. Their visible priority SHALL match their array order. Because filters retain AND composition, reordering the same filter set MAY change short-circuit evaluation order but SHALL NOT change which rows satisfy that set.

Saved default-sort badges SHALL be draggable into a persistent priority order. The leftmost badge SHALL remain the primary comparator, subsequent badges SHALL break ties from left to right, and Variant ID SHALL remain the final tie-breaker. A successful drag SHALL clear any temporary header sort and immediately recompute row order.

#### Scenario: Checkbox drag and header drag share column order

- **GIVEN** a Results table with columns A, B, and C
- **WHEN** the user drags the complete C checkbox control before A
- **THEN** both the checkbox controls and unpinned table headers render C, A, B
- **WHEN** the user then drags header B before C
- **THEN** both surfaces render B, C, A
- **AND** refreshing restores that order and the existing checked/unchecked states

#### Scenario: Partial saved order accepts a new document column

- **GIVEN** preferences save column B before A
- **WHEN** the current `results.yaml` also introduces column C
- **THEN** B and A retain their relative order and C is appended in document order
- **AND** no stale or duplicate saved ID produces a duplicate control or table column

#### Scenario: Sticky metric pins do not reveal scrolling content

- **GIVEN** a metric column is pinned and the combined pin width permits sticky positioning
- **WHEN** unpinned columns scroll behind that metric header and its body cells
- **THEN** the pinned metric surfaces use an opaque pale-blue background
- **AND** no text or color from the scrolling columns is visible through them
- **WHEN** the same pinned metric column is starred
- **THEN** its pinned surfaces use an opaque amber background instead

#### Scenario: Dragged filter order persists

- **GIVEN** two saved AND row filters displayed as priorities one and two
- **WHEN** the user drags the second filter before the first
- **THEN** their displayed and stored priority order is reversed
- **AND** refresh restores that order without changing the AND composition

#### Scenario: Dragged default sort changes the result

- **GIVEN** default sort A then B produces one row order
- **WHEN** the user drags B before A
- **THEN** B becomes priority one and A priority two
- **AND** the table immediately renders the row order produced by B then A
- **AND** refresh restores both the priority and resulting row order

### Requirement: Results can refresh independently with visible snapshot age

Every valid YAML-backed Results card SHALL expose a Refresh action. Activating it SHALL read and normalize the current `results.yaml` through an authenticated, read-only Results snapshot endpoint and SHALL replace only the Results document rendered inside that card. The action SHALL NOT reload or refetch the complete Experiment page, remount unrelated document sections or Run panels, or reset Results table visibility, ordering, filters, pinning, sorting, stars, temporary controls, or other client preferences.

The Results card SHALL show `Last updated` using the server-observed `results.yaml` modification time and `Stale for` using elapsed time since that same backend content-modification time. The stale duration SHALL advance while the page remains open. A successful manual Refresh SHALL update both displays only from the mtime returned by the backend: reading unchanged Results SHALL NOT reset Stale for, while reading changed Results SHALL recompute it from the new mtime. The initial Experiment detail response SHALL provide the Results modification time so rendering status does not require an immediate duplicate Results request.

While refresh is pending, the action SHALL be disabled and visibly indicate progress. A successful response SHALL atomically replace the Results document and modification time. A missing file, invalid current YAML, authorization failure, network failure, or other non-success response SHALL retain the complete last good Results snapshot and its modification time, clear the pending state, and show a local understandable error with Refresh still available for retry. The refresh path SHALL NOT modify, clean, or rewrite `results.yaml`, and the stale-status timer SHALL NOT trigger any automatic backend request.

#### Scenario: Results refresh without disturbing the page

- **GIVEN** an open Experiment page with a valid Results table, expanded Run panel, and configured table preferences
- **AND** `results.yaml` changes on disk
- **WHEN** the user activates the Results Refresh action
- **THEN** only the Results table receives the newly normalized document
- **AND** the expanded Run panel, other document sections, and all Results preferences remain unchanged
- **AND** Last updated and Stale for are both derived from the new file mtime

#### Scenario: Refreshing unchanged Results does not reset staleness

- **GIVEN** displayed Results were last modified one hour ago
- **AND** the backend file remains unchanged
- **WHEN** the user activates Refresh
- **THEN** Last updated remains the same
- **AND** Stale for remains approximately one hour rather than restarting near zero

#### Scenario: Refresh retains the last good snapshot on invalid YAML

- **GIVEN** the open page displays a valid Results snapshot
- **AND** the current `results.yaml` becomes invalid
- **WHEN** the user activates Refresh
- **THEN** the endpoint returns a validation failure without writing the file
- **AND** the Results card continues to display the previous table and modification time
- **AND** a local error appears and the Refresh action becomes available for retry

#### Scenario: Initial status does not duplicate the Results request

- **GIVEN** the Experiment detail response contains a valid Results document
- **WHEN** the Results card first renders
- **THEN** it displays the source modification time and its current age from that response
- **AND** it does not call the dedicated Results snapshot endpoint until the user activates Refresh

### Requirement: Results preference hydration and mutations are race-safe

The browser/SQLite Results preference state SHALL compose multiple synchronous or React-batched updates against the latest in-memory value rather than a render-time snapshot. Updating one preference field SHALL NOT erase a preceding unrendered update to another field, and repeated operations on the same collection, including hiding multiple columns or adding multiple filters, SHALL accumulate in invocation order.

The browser SHALL durably distinguish an absent local preference or unmodified initial default from a real user mutation. Only a setter whose serialized value differs from the current value SHALL create a dirty local mutation. A real mutation SHALL remain causally newer than server hydration until SQLite acknowledges that exact mutation, including when the mutation explicitly produces empty filters, no hidden columns, or another default-looking value. An absent local record, an unmodified initial default, and a same-value setter SHALL remain clean and SHALL accept a found server value.

Owner server writes SHALL update UI and browser storage without waiting, serialize complete preference snapshots in invocation order, survive component unmount, and use unload-safe requests. A failed or forbidden write SHALL NOT clear the local value or dirty marker. A later owner hydration or mutation SHALL retry dirty state. A server acknowledgement SHALL clear dirty state only when it matches the latest local mutation; an acknowledgement or hydration response older than the latest local mutation or acknowledged server revision SHALL NOT overwrite it.

Preference reconciliation SHALL preserve the distinction between a missing SQLite row, a missing browser record, and a present explicitly empty value. When SQLite has no row and browser state exists, browser state SHALL remain active and migrate to SQLite. Viewer/anonymous sessions SHALL remain browser-only. Manually refreshing Results data or receiving a document with added/removed columns SHALL normalize stale IDs without clearing valid filters, checkbox visibility, ordering, pinning, line count, row overrides, or default-sort preferences.

#### Scenario: No local record accepts the server value

- **GIVEN** the browser has no local preference record or dirty mutation
- **AND** SQLite contains a preference for the logged-in owner
- **WHEN** hydration completes
- **THEN** the SQLite value becomes the rendered and browser-stored value
- **AND** no browser default is uploaded over it

#### Scenario: Explicitly clearing filters is a real local change

- **GIVEN** the rendered preference contains one or more filters
- **WHEN** the user removes the final filter
- **THEN** the empty filter list is stored locally as a dirty mutation
- **AND** an older server filter list cannot restore itself
- **AND** the explicit empty list is uploaded to SQLite

#### Scenario: Same-value setter is not a mutation

- **GIVEN** a clean browser preference
- **WHEN** a setter produces the same serialized preference value
- **THEN** no dirty marker or server write is created
- **AND** subsequent newer server hydration may still win

#### Scenario: Failed write remains recoverable

- **GIVEN** a user mutation updated UI and localStorage
- **AND** its owner SQLite write fails
- **WHEN** the preference remounts and receives an older found server row
- **THEN** the dirty local value remains rendered
- **AND** it is retried instead of being overwritten

#### Scenario: Unmount does not discard the latest queued mutation

- **GIVEN** multiple preference mutations are queued in order
- **WHEN** the component unmounts before the earlier request completes
- **THEN** the queue continues independently of the component lifetime
- **AND** SQLite ultimately receives the latest complete preference

#### Scenario: Delayed server row cannot revert a new checkbox action

- **GIVEN** Results hydration requested a found SQLite preference
- **AND** the user changes a checkbox before that request resolves
- **WHEN** the older response arrives
- **THEN** the checkbox remains in the user-selected state locally
- **AND** the latest complete preference is written back to SQLite

#### Scenario: Batched filter and checkbox changes compose

- **GIVEN** a mounted Results table
- **WHEN** one task adds a row filter and hides two columns before React renders again
- **THEN** the stored preference contains the filter and both hidden-column IDs
- **AND** remounting restores all three changes

#### Scenario: Uncontested explicit empty server state stays authoritative

- **GIVEN** clean or legacy browser storage contains filters without a dirty user mutation
- **AND** SQLite contains a present preference whose filter list is explicitly empty
- **WHEN** hydration completes without user interaction
- **THEN** the empty server filter list replaces the browser filters

### Requirement: Results view reset requires destructive confirmation

The Results `Reset view` toolbar action SHALL NOT modify browser, in-memory, or SQLite-backed preferences when first activated. It SHALL open an accessible confirmation dialog that states the action will clear the configured default sort, row filters, checkbox visibility, column order, pinning, row overrides, maximum line count, and temporary view/sort controls, and that the reset cannot be undone.

The dialog SHALL provide a non-destructive Cancel action and a visually destructive explicit confirmation. Initial focus SHALL favor Cancel. Cancel, close, overlay dismissal, and Escape SHALL close the dialog without modifying any Results preference or current table presentation. Only explicit confirmation SHALL replace the preference with defaults, clear temporary controls, close the dialog, update local presentation/localStorage immediately, and enqueue the owner SQLite update through the normal preference path.

Reset view SHALL remain disabled when the current persistent and temporary view already equals defaults.

#### Scenario: Accidental activation does not reset preferences

- **GIVEN** a user configured filters, hidden columns, and a default sort
- **WHEN** the user activates Reset view once
- **THEN** the confirmation dialog opens
- **AND** the table, localStorage, and SQLite write queue remain unchanged

#### Scenario: Cancel and Escape retain the configured view

- **GIVEN** the reset confirmation dialog is open
- **WHEN** the user chooses Cancel or presses Escape
- **THEN** the dialog closes
- **AND** every configured Results preference and temporary control remains unchanged

#### Scenario: Explicit confirmation performs one reset

- **GIVEN** the reset confirmation dialog is open for a non-default Results view
- **WHEN** the user activates the destructive confirmation
- **THEN** the complete Results view returns to defaults
- **AND** localStorage and owner SQLite receive the default preference through the existing persistence path
- **AND** the dialog closes and Reset view becomes disabled

### Requirement: Report HTML embeds expose controlled reload and change awareness

Every Report HTML embed SHALL expose a Reload action that revalidates the canonical Report asset URL and mounts a fresh iframe browsing context only after validation succeeds. Reload SHALL preserve the iframe title, zoom percentage, host layout, and Open-in-new-tab destination.

While a ready embed is visible in an active browser document, the client SHALL perform a header-only resource revision check no more frequently than once per minute. When the served HTML entry revision differs from the revision last loaded, Reload SHALL display a small semantic update indicator with an accessible description. The client SHALL NOT automatically reload the iframe or discard its state. A successful manual Reload SHALL clear the indicator and establish the new baseline.

#### Scenario: Changed entry invites an explicit reload
- **GIVEN** an embedded Report entry loaded with revision A
- **WHEN** a later low-frequency HEAD check returns revision B
- **THEN** Reload displays an accessible update indicator
- **AND** the existing iframe remains mounted at revision A until the user acts
- **WHEN** the user activates Reload and its probe succeeds
- **THEN** a fresh iframe loads from the same canonical URL
- **AND** the update indicator clears

#### Scenario: Hidden documents do not poll
- **GIVEN** a ready Report embed and a hidden browser document
- **WHEN** its normal revision interval elapses
- **THEN** no revision request is sent until the document is visible again

### Requirement: Report HTML expanded mode remains inside the page

The embed Expand action SHALL open a temporary page-internal focused view rather than invoke the browser Fullscreen API. The focused wrapper SHALL cover the application content viewport above project headers, sidebars, drawers, and split panes; lock background body scrolling; keep the iframe toolbar available; and fill the remaining dynamic viewport height. It SHALL work identically from a full Report, right split, or Report drawer.

The user SHALL be able to exit through a visible action or Escape. Exit and component cleanup SHALL restore prior body and ancestor inline styles without navigating or reloading the surrounding Report.

#### Scenario: Side Report expands over the complete application
- **GIVEN** an iframe inside a Report drawer or right split
- **WHEN** the user activates Expand
- **THEN** the iframe wrapper covers the complete page viewport rather than only its side pane
- **AND** the project header/sidebar are temporarily obscured without entering browser fullscreen
- **WHEN** the user presses Escape
- **THEN** the iframe returns to its original side Report position and background scrolling is restored

### Requirement: Mobile Report iframe actions use a compact overflow menu

Below the `sm` breakpoint, an iframe toolbar SHALL show its truncated title and one accessible three-dot action trigger in a single compact row. Zoom out, current zoom, zoom in, Reload/update state, Open in new tab, and Expand/Exit SHALL be available inside that menu. The zoom actions SHALL retain the direct horizontal minus/current-percentage/plus stepper presentation used by the desktop toolbar, and repeated zoom adjustments SHALL keep the action menu open. The direct desktop action group SHALL be hidden on mobile and SHALL remain visible at `sm` and wider.

#### Scenario: Mobile header stays compact with every action reachable
- **GIVEN** a Report iframe at a mobile viewport width
- **WHEN** its toolbar renders
- **THEN** only the title and action-menu trigger occupy the toolbar row
- **WHEN** the user opens the action menu
- **THEN** zoom, Reload, Open in new tab, and Expand actions are keyboard and pointer accessible
- **AND** activating minus or plus repeatedly updates the visible percentage without closing the menu

### Requirement: Lazy iframe timeout begins near the viewport

A successfully probed Report iframe SHALL remain lazy-loaded. In browsers with IntersectionObserver, its bounded post-probe load timeout SHALL begin only when the wrapper enters a configured proximity margin around the viewport. A below-fold iframe SHALL remain mounted while deferred and SHALL not enter an error state merely because the timeout duration elapsed before it approached the viewport. Browsers without IntersectionObserver MAY start the timer immediately for compatibility.

#### Scenario: Later plots are not failed while below the fold
- **GIVEN** one Report contains multiple lazy iframe plots and a later plot is outside the viewport proximity margin
- **WHEN** more than the normal load-timeout duration elapses before the user scrolls to it
- **THEN** the later iframe remains mounted in its loading state
- **WHEN** it approaches the viewport
- **THEN** its bounded load timer begins and normal load/error handling resumes

### Requirement: Central dashboard presents configured Hosts and live Projects
In central mode, the dashboard SHALL show every configured Host with its explicit availability/compatibility state and SHALL show live Projects grouped or labelled by owning Host. Offline or unusable Hosts SHALL remain visible without stale Project payloads, and one Host failure SHALL not prevent other Host Projects from rendering.

#### Scenario: Offline Host remains visible
- **WHEN** Host A is offline and Host B is online
- **THEN** the dashboard shows Host A as offline, omits stale Host A Project data, and renders Host B normally

### Requirement: Central navigation is Host-qualified
Every central Project, run, Experiment, report, code-review, inbox, Git, terminal, and management link/action SHALL preserve the selected Host and Project. Equal names/IDs on two Hosts SHALL produce distinct links and state. Standalone routes SHALL remain project-only.

#### Scenario: Equal Project names open distinct pages
- **WHEN** two Hosts expose `project-x`
- **THEN** selecting each entry navigates to a different `/h/<host>/p/project-x/...` route and loads only that Host

### Requirement: Central mode never guesses an omitted Host
The UI SHALL NOT issue a Project/resource mutation without an exact Host selector. Legacy project-only navigation MAY redirect only for a unique live match; ambiguous navigation SHALL display a Host choice or error.

#### Scenario: Ambiguous legacy detail link is safe
- **WHEN** a project-only detail link could refer to two Hosts
- **THEN** no resource is loaded or mutated until the user selects a Host

### Requirement: Production central does not implicitly display mock Projects
A production central dashboard SHALL display mock Projects only when an explicit local Backend Host is configured. Development mock Backends SHALL be visibly Host-labelled and traverse the same API as remote Backends.

#### Scenario: No local Backend means no mock cards
- **WHEN** production central has only remote Host entries
- **THEN** repository fixtures do not appear in navigation or Project results

### Requirement: Central Experiment pages do not silently downgrade current v6 data
For a supported current/prior Backend release, the dashboard SHALL require the strict v6 Experiment detail fields and render canonical Implementation, Investigation, Results, Findings, Limitations, and Conclusion sections. Missing current-contract fields SHALL surface a safe compatibility error rather than synthesize deprecated Method, Plan, or Caveats sections.

#### Scenario: Managed documents render in central
- **WHEN** an owner opens a Host-qualified valid v6 Experiment detail
- **THEN** Implementation and Investigation render their structured item hierarchies
- **AND** Results renders its Variant table
- **AND** legacy Plan/Caveats headings are not shown

### Requirement: Experiment Results Views are centrally shared

The Results table SHALL present named Views bound to the current Experiment. Selecting a View SHALL apply its complete persistent filters, checked-column visibility, column order, maximum line count, default sort chain, pinning, row overrides, SOTA modes, and decimal formatting. Owners SHALL be able to create, duplicate, rename, edit, reset, and delete Views; exact-scope share viewers SHALL be able to list, select, and inspect the same Views without modifying any View. Each Results column header SHALL cycle through the configured default sort, temporary ascending order, temporary descending order, and back to the configured default. Header-created sorting SHALL remain only in mounted client state and SHALL NOT survive refresh. Right-clicking a table header SHALL open a context menu that can hide, pin left, pin right, unpin, or star/unstar that column; a hidden column remains recoverable from the checkbox controls above the table. Pinned-left columns SHALL appear before unpinned columns and pinned-right columns SHALL appear after them, with each pinned group using the order in which the user pinned or moved columns rather than YAML order. A column name MAY also be starred from the controls; starred names SHALL persist at Project scope and highlight every column with the exact same display name across that Project's Experiments.

Durable View definitions SHALL be stored in the central `memon-ui-preferences.sqlite3` View collection without a username dimension. Browser storage SHALL provide immediate owner rendering, ordered asynchronous synchronization, retryable dirty state, and local active selection, but a clean browser copy SHALL not create a user-specific fork. The server response SHALL distinguish an empty View collection from a present View whose definition contains no filters. When the server collection is empty and an owner browser has legacy state, that state SHALL remain active and be migrated as a View. UI state and browser storage SHALL update without waiting for the server write. Project-wide starred column labels SHALL remain outside the Experiment View definition.

The Results controls SHALL expose the persistent default sort as an ordered list of editable badges. Each badge SHALL select one unique column and ascending or descending direction; badges SHALL be compared from left to right and SHALL support changing priority. Natural Variant-ID ascending order SHALL be the deterministic final tie-breaker and the entire default when no badges exist. A temporary header sort SHALL become the primary comparator while active, with the default chain continuing to break ties. Clicking the Variant header SHALL support the same temporary ascending and descending cycle as every other column.

The Results controls SHALL allow one or more row filters over any displayed or hidden column using equals, does-not-equal, greater-than, or less-than comparisons. Multiple filters SHALL combine with AND. Every saved filter SHALL render as a compact badge that opens an editor for its column, operator, and value when clicked; a trailing add-filter badge SHALL open the same editor for a new condition. A per-Variant override SHALL be able to use automatic filtering, force-show, or force-hide, with the override taking precedence over ordinary filters. Override actions SHALL be available from a rendered row's context menu; no permanent Auto/Show/Hide control SHALL consume space in the first visible cell, and no dedicated top-level row selector SHALL render. Empty scalar values and empty evidence arrays SHALL be addressable by an equals-empty filter. Array-valued Runs and Attempts SHALL match equals/greater/less when any member matches and shall match does-not-equal only when no member equals the target.

Rows and columns SHALL each provide an independent temporary show-all toggle. Temporary show-all SHALL bypass the saved filters or hidden-column set without deleting or changing them, SHALL expose the complete row or column set, and SHALL not be stored in browser persistence. Resuming filters, selecting another View, or refreshing the page SHALL restore the selected View's saved setup.

When the combined rendered width of visible pinned columns is less than the horizontal viewport, pinned columns SHALL remain sticky at their respective side while the unpinned middle columns scroll. Sticky offsets SHALL account for every preceding pinned column on that side so pinned columns do not overlap. When the combined pinned width is greater than or equal to the viewport width, sticky positioning SHALL be disabled for all pinned columns; the table SHALL scroll as one surface while retaining the pinned-left, unpinned, pinned-right grouping and user-selected pin order.

#### Scenario: Refresh restores table preferences

- **GIVEN** a user hides a column, configures a multi-column default sort, sets cells to three lines, and adds row filters and overrides in one View
- **WHEN** the page is refreshed in the same browser
- **THEN** the same active View, visibility, default-sort chain, three-line limit, row filters, and row overrides are restored

#### Scenario: SQLite absence differs from an explicitly empty filter set

- **GIVEN** browser storage contains legacy row filters for the current Experiment
- **WHEN** the authenticated owner's SQLite View collection is empty
- **THEN** the browser filters remain active and are migrated into a View
- **BUT WHEN** SQLite has a View whose saved filter list is empty
- **THEN** that explicit empty list remains authoritative for that View

#### Scenario: Guests stay browser-only

- **GIVEN** an anonymous session reaches a Results surface without authenticated View access
- **WHEN** the table initializes
- **THEN** no central View collection is returned or mutated

#### Scenario: Default sort chains multiple columns

- **GIVEN** default-sort badges `Cube size T ascending` followed by `Cube size H descending`
- **WHEN** multiple Variants have equal `Cube size T`
- **THEN** `Cube size H` determines their relative order
- **AND** equal rows fall back to Variant ID ascending

#### Scenario: Header sorting is temporary

- **GIVEN** a persisted multi-column default sort
- **WHEN** the user clicks one column header once
- **THEN** that column temporarily sorts ascending as the primary comparator
- **AND** a second click uses temporary descending order
- **AND** a third click or a refresh returns to the persisted default chain

#### Scenario: Row predicates and overrides compose predictably

- **GIVEN** filters `loss > 0.15`, `loss < 0.25`, and `status = COMPLETED`
- **WHEN** a non-matching Variant is force-shown and a matching Variant is force-hidden
- **THEN** ordinary rows must satisfy every predicate
- **AND** the force-shown Variant remains visible while the force-hidden Variant is absent

#### Scenario: Filter badges support direct editing

- **GIVEN** a saved badge `loss > 0.15`
- **WHEN** the user clicks that badge, changes its value, and saves
- **THEN** the existing condition is updated in place without creating a duplicate
- **AND** the trailing add-filter badge remains available for another condition

#### Scenario: Row override is edited from the context menu

- **GIVEN** a currently rendered Variant row
- **WHEN** the user opens its context menu
- **THEN** force-show, force-hide, and clear-override choices are available as applicable
- **AND** no row-override control is rendered in a table cell or above the table

#### Scenario: Temporary show-all preserves saved configuration

- **GIVEN** saved hidden columns, row filters, and row overrides
- **WHEN** the user temporarily shows all columns or all rows
- **THEN** the complete corresponding set is visible without modifying those saved conditions
- **AND** resuming or refreshing reapplies the saved conditions

#### Scenario: Header context menu manages one column

- **GIVEN** a visible Results column header
- **WHEN** the user right-clicks it
- **THEN** the context menu offers to hide, pin left, pin right, and star or unstar the column
- **AND** hiding it updates the active View's persisted checkbox state

#### Scenario: Pinned columns remain visible without overlap

- **GIVEN** multiple Results columns pinned on the left and right whose combined width is smaller than the table viewport
- **WHEN** the user scrolls the table horizontally
- **THEN** every pinned column remains fixed at its selected side
- **AND** pinned columns on the same side use their persisted user-selected order and non-overlapping offsets

#### Scenario: Oversized pin groups degrade to ordered scrolling

- **GIVEN** visible pinned columns whose combined width is greater than or equal to the table viewport
- **WHEN** the table lays out or its viewport is resized
- **THEN** no Results column uses sticky positioning
- **AND** pinned-left columns remain first and pinned-right columns remain last in their user-selected order while the whole table scrolls

#### Scenario: Star follows a column name across Experiments

- **GIVEN** two Experiments in one Project both declare a column labeled `Final loss`
- **WHEN** the user stars `Final loss` in the first Experiment and opens the second
- **THEN** the `Final loss` header and cells are highlighted in the second Experiment
- **AND** the star is not copied into either Experiment View definition

#### Scenario: Checkbox and filter combination belongs to the active View

- **GIVEN** an owner selected View `Latency review`
- **WHEN** the owner hides two columns and adds a latency filter
- **THEN** the table updates immediately
- **AND** the complete `Latency review` definition is persisted for that Experiment
- **AND** selecting another View applies that View's independent definition

#### Scenario: Share viewer sees the same Views read-only

- **GIVEN** an exact-scope share viewer opens an Experiment
- **WHEN** the Results table loads
- **THEN** the viewer sees and may select every centrally stored View for that Experiment
- **AND** cannot change checkboxes, filters, formatting, names, or View lifecycle
