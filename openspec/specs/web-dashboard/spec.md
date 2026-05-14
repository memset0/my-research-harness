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

