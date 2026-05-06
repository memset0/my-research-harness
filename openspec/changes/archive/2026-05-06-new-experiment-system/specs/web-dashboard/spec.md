## ADDED Requirements

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
- Header: `⚠ <count> issues need resolution` plus action buttons
  `Copy all` and `Hide`
- Body: scrollable list of anomaly messages (`max-h-[40vh]
  overflow-y-auto`), one line per anomaly with the code, IDs, and
  message.
- `Copy all`: copies a text block with project name, ISO timestamp,
  and one line per anomaly formatted for paste into an agent.
- `Hide`: hides the card for the current `sessionStorage` lifetime
  (returns on browser tab reload).

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

#### Scenario: Hide is per-session
- **WHEN** the user clicks `Hide` then reloads the tab
- **THEN** the banner is hidden after reload
- **AND** when the user opens the project in a new tab
- **THEN** the banner is visible

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
- **Body markdown**: rendered `Motivation` / `Method` / `Conclusion` /
  `Caveats` / `Warnings` (the warnings table renders inline with the
  Run column)
- **Runs section header**: `Runs (<count>)`
- **Run panels**: one expandable panel per confirmed member run

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

## REMOVED Requirements

### Requirement: Experiment list view

**Reason**: V2's list view rendered a card-stack of run-shaped
"experiments" with a top stripe (id + status + sub-project + created +
updated) and chip-line (hypotheses + tags + no-README). V3 lifts the
view to the experiment doc layer with a card *grid*, an embedded runs
table inside each card, no sub-project, no hypotheses chip-line at the
list level (hypothesis chips are at the exp detail page).

**Migration**: Users will see a different visual layout. The same data
fields are surfaced (status, times, tags) at the appropriate level.

### Requirement: Stale RUNNING badge

**Reason**: The stale-RUNNING heuristic continues to apply at the run
level (a single member run with `status: RUNNING` whose mtime is stale).
The badge surfaces on the run row inside the embedded runs table on the
exp card, not on the exp card header.

**Migration**: User-visible behavior is approximately the same; the
badge moves location but still appears.

### Requirement: Experiment detail page

**Reason**: V2's detail page was per-run. V3 is per-experiment with run
panels. The new contract is the `### Requirement: Experiment detail
page` above. Per-run rendering happens inside run panels.

**Migration**: Old `/p/<project>/experiments/<run-dir>` URLs redirect
per the new `### Requirement: URL redirects from legacy run paths`.

### Requirement: Section card typography hierarchy

**Reason**: The typography rules continue verbatim and apply to both
the exp page's body sections and each run panel's expanded body
sections. We do not re-spec them.

**Migration**: No user action.

### Requirement: README inline editing with conflict-aware save

**Reason**: Replaced by the per-surface editor contracts in
`experiment-edit` and `run-edit`. The conflict-aware save flow itself
(409 → diff dialog → keep/discard/cancel) continues unchanged.

**Migration**: No user action.

### Requirement: localStorage draft and recovery prompt

**Reason**: Continues unchanged with key patterns extended to cover
both surfaces. Implementation detail.

**Migration**: No user action.

### Requirement: Status edit from the detail page

**Reason**: The exp doc has no status field of its own; status is
aggregate. Per-run status edits happen via the run panel's action bar
(or the existing `memon run status set` CLI). The exp page does not
expose a status control.

**Migration**: Users who relied on hand-editing experiment status
should now edit the relevant run.

### Requirement: Warnings card on the experiment detail page

**Reason**: The Warnings section is now part of the exp doc body itself
(rendered inline as the `## Warnings` markdown table) rather than as a
separate card. Interactive controls (resolve, reopen, edit note,
delete, add) are layered on top of the inline table.

**Migration**: Users see the same data; the layout is more compact.

### Requirement: Interactive warning row controls

**Reason**: The interactive controls continue verbatim, layered onto
the inline `## Warnings` table on the exp page. We do not re-spec them.

**Migration**: No user action.

### Requirement: Warning HTTP endpoints

**Reason**: Endpoints move from `/api/experiments/:id/warnings` (where
`:id` was a run dir) to `/api/experiments/:id/warnings` (where `:id` is
now the exp doc id `E<NNNN>-<slug>`). The request/response shapes gain
the optional `run` field on POST. Spec is owned by `experiment-edit`.

**Migration**: External clients of the v2 endpoint would break. There
are none.

### Requirement: Hypothesis view

**Reason**: The hypothesis page continues unchanged in scope, but cross-
links now resolve to exp ids OR run dirs per the `hypotheses` spec
delta in this change.

**Migration**: No user action.

### Requirement: Journal timeline view

**Reason**: Continues unchanged.

**Migration**: No user action.

### Requirement: Log viewer integrated into experiment detail

**Reason**: Continues unchanged but now lives inside each run panel on
the exp page (instead of on the per-run page). User-visible behavior
is the same.

**Migration**: No user action.

### Requirement: Mobile-responsive layout

**Reason**: Continues to apply.

**Migration**: No user action.

### Requirement: Time rendering in browser timezone

**Reason**: Continues to apply unchanged.

**Migration**: No user action.

### Requirement: Sub-project tag in experiment list

**Reason**: Sub-project field is removed entirely in v3 (per
`run-discovery` REMOVED). No badge to render.

**Migration**: Users who relied on sub-project labels for visual
grouping should now use experiment slugs (the exp's slug becomes the
prefix of every member run's slug, by soft convention) and tags on
the exp doc.

### Requirement: AppBar tabs for Reports and Digests

**Reason**: Continues unchanged.

**Migration**: No user action.

### Requirement: Reports route serves the inbox shell

**Reason**: Continues unchanged.

**Migration**: No user action.

### Requirement: Digests route serves the inbox shell with `kind="digests"`

**Reason**: Continues unchanged.

**Migration**: No user action.
