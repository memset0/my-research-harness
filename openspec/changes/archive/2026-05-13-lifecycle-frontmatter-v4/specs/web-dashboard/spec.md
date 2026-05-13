## MODIFIED Requirements

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
