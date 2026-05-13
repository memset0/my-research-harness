# web-dashboard Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: Project selector in top navigation

The dashboard SHALL display a project selector in the top navigation showing all projects from the resolved `config.yml`. Switching project SHALL update the experiment list, hypothesis view, journal view, reports inbox, and digests inbox to that project's data without full page reload.

#### Scenario: Switching projects
- **WHEN** the user clicks a different project in the selector
- **THEN** the URL updates with the project identifier and the views re-fetch data scoped to the new project (including the now-existing Reports and Digests views)

### Requirement: Experiment-card grid as the project list page

The list page at `/p/<project>` SHALL render a responsive grid of
experiment cards (one card per experiment). Each card SHALL contain:

1. **Header row**: experiment status pill (computed aggregate of member
   runs), exp id + slug in monospace, and a `<finished>/<total>` runs
   counter badge.
2. **Title line**: the exp's `title` field rendered in a slightly
   larger weight.
3. **Embedded runs table**: one row per confirmed member run, columns
   `status emoji | run dir name | created_at HH:MM | duration-or-status
   | files-count`. Clicking a row navigates to
   `/p/<project>/e/<exp-id>?run=<run-dir>` with that run panel
   auto-expanded.
4. **Footer left**: tags as outline badges (the exp's frontmatter
   `tags[]`).
5. **Footer right (desktop)**: 📅 `effective_created_at` and ✎
   `effective_updated_at`, each preceded by a small icon.
6. **Footer (mobile)**: tags and times stack vertically.

Cards SHALL be sorted by `effective_updated_at` descending by default;
the sort/filter controls from the v2 list view (a flexible header) are
re-used to control sort key and search across exp title / slug / tags /
member-run names.

There SHALL NOT be a sub-project badge on cards (the sub-project field
is gone in v3).

#### Scenario: Card header shows aggregate status
- **GIVEN** an experiment with 3 confirmed runs whose statuses are
  RUNNING, FINISHED, FINISHED
- **WHEN** the card renders
- **THEN** the header status pill is `🟢` (any RUNNING dominates) and
  the counter badge reads `2 / 3 runs`

#### Scenario: Embedded runs table row click navigates with auto-expand
- **WHEN** the user clicks a row inside an experiment card
- **THEN** the URL becomes `/p/<project>/e/<exp-id>?run=<run-dir>` and
  the corresponding run panel is expanded on the destination page

#### Scenario: Empty experiment renders an empty runs table
- **GIVEN** an experiment with `runs: []` (zero member runs)
- **WHEN** the card renders
- **THEN** the runs table area shows an empty-state message ("No runs
  yet — open Claude Code to scaffold one") and tag/time footers still
  render normally

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

