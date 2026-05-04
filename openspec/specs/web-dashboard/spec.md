# web-dashboard Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: Project selector in top navigation

The dashboard SHALL display a project selector in the top navigation showing all projects from the resolved `config.yml`. Switching project SHALL update the experiment list, hypothesis view, journal view, reports inbox, and digests inbox to that project's data without full page reload.

#### Scenario: Switching projects
- **WHEN** the user clicks a different project in the selector
- **THEN** the URL updates with the project identifier and the views re-fetch data scoped to the new project (including the now-existing Reports and Digests views)

### Requirement: Experiment list view

The experiment list view SHALL render a card-stack of all experiments in the current project. Each row SHALL be a single card with two visual sections:

1. **Top stripe** (a horizontal row): in left-to-right order, `Status` (colored pill, leftmost), `ID` (monospace; with optional sub-project badge inline when `frontMatter.project` differs from the membership project), `Created` (timestamp, locale-rendered after hydration), and `Updated` (mtime, same rendering rule).

2. **Chip line** below the top stripe (rendered only when at least one chip is present): a flex-wrap row containing — in this order — every hypothesis ID as a clickable badge, then every tag as an outline badge, then a `no README` warning badge if `hasReadme` is false. The line SHALL be omitted entirely when there are no hypotheses, no tags, and `hasReadme` is true.

The list SHALL support client-side sort and filter on every top-stripe column, plus a free-text search box matching against name + tags + hypotheses + sub-project label.

#### Scenario: Sort by created descending (default)
- **WHEN** the user opens the experiment list
- **THEN** experiments are listed by `created_at` descending by default

#### Scenario: Status emoji is the leftmost cell
- **WHEN** the user looks at any row
- **THEN** the colored status pill is the first visible element on the left, before the experiment id

#### Scenario: Chip line shows hypotheses before tags
- **GIVEN** an experiment with `hypotheses: [H0001, H0007]` and `tags: [diffusion, zero-snr]`
- **WHEN** the row renders
- **THEN** in the chip line, the badges appear in the order `H0001, H0007, diffusion, zero-snr`

#### Scenario: Empty chip line collapses
- **GIVEN** an experiment with no tags, no hypotheses, and `hasReadme: true`
- **WHEN** the row renders
- **THEN** the row is one line tall — only the top stripe is visible, no empty chip-line element below

#### Scenario: Warning chip appears at the end
- **GIVEN** an experiment with hypotheses, tags, AND `hasReadme: false`
- **WHEN** the row renders
- **THEN** the chip line shows hypotheses first, then tags, then the `no README` warning badge as the right-most chip

#### Scenario: Many chips wrap to additional lines
- **GIVEN** an experiment with 12 hypothesis refs and 6 tags (sparse-fsdp-like)
- **WHEN** the row renders at desktop width
- **THEN** the chip line wraps into multiple lines using the full row width (no longer constrained to a `col-span-2` cell), and the top stripe (status / id / created / updated) stays on one line above

### Requirement: Stale RUNNING badge

For each experiment with `status: RUNNING` whose directory `mtime` has not advanced for longer than a configurable threshold (default 1 hour), the list view SHALL display a `⚠` badge alongside the running emoji. Clicking the badge SHALL surface a tooltip with the elapsed time.

#### Scenario: Stale badge shown
- **WHEN** an experiment has `status: RUNNING` and its directory mtime is 2 hours old
- **THEN** the row shows `🟢 ⚠` and tooltip "RUNNING but no activity for 2h 3m"

#### Scenario: Recent activity removes badge
- **WHEN** the directory mtime advances within the threshold
- **THEN** the badge is removed on next poll

### Requirement: Experiment detail page

Clicking an experiment in the list SHALL open a detail page showing:
- Front matter as a structured panel. The membership project (top-level `project`, set from `config.yml`) SHALL appear as a labeled row (e.g. "Project: sparse-fsdp"). When the front-matter `project:` is non-empty AND differs from the membership project, it SHALL appear as an additional row labeled "Sub-project: <value>"; when blank or equal, the sub-project row SHALL be omitted.
- Other front-matter rows: id, name, status, host, pid, gpus, created/finished, command, entry, wandb link.
- Body sections (Motivation/Setup/Method/Result/Conclusion/Caveats/Artifacts/(opt) New Hypotheses) as rendered markdown
- A "Hypotheses" panel listing related hypotheses with their current status emoji
- An "Artifacts" panel listing the parsed Artifacts section entries with clickable paths
- A "Resources" placeholder panel labeled "not yet available" (hook for future GPU/disk monitoring)

#### Scenario: Detail page shows sub-project when divergent
- **GIVEN** an experiment under memon project `sparse-fsdp` whose `frontMatter.project` is `predictive-skip-validation`
- **WHEN** the user opens its detail page
- **THEN** the front-matter panel shows both "Project: sparse-fsdp" and "Sub-project: predictive-skip-validation" as separate rows

#### Scenario: Detail page omits sub-project when equal
- **GIVEN** an experiment under memon project `project-a` whose `frontMatter.project` is `project-a`
- **WHEN** the user opens its detail page
- **THEN** the front-matter panel shows only "Project: project-a" (no separate sub-project row)

#### Scenario: Detail page labels project-only when sub-project absent
- **GIVEN** an experiment under memon project `project-a` whose `frontMatter.project` is empty/absent
- **WHEN** the user opens its detail page
- **THEN** the front-matter panel shows "Project: project-a" with no sub-project row

### Requirement: Section card typography hierarchy

Within every card on the experiment detail page, the body content SHALL render at a smaller font size than the card's title, so each card has an unambiguous title-vs-content visual hierarchy. Concretely, `CardTitle` continues at `text-sm` (14px) while body content — rendered markdown for the README sections (Motivation/Setup/Method/Result/Conclusion/Caveats/New Hypotheses), the "to fill" placeholder for empty sections, and the Resources placeholder — renders at `text-xs` (12px), matching the card's own `text-xs/relaxed` default and the existing Artifacts list density.

#### Scenario: Markdown body smaller than section title
- **WHEN** a section card renders its rendered-markdown body (e.g. the `Method` section)
- **THEN** the body paragraphs render at `text-xs` (12px), visibly smaller than the `text-sm` (14px) `Method` heading

#### Scenario: Empty section placeholder smaller than section title
- **WHEN** a section card has no body content and shows the "to fill" placeholder, OR the Resources card shows its "not yet available" placeholder
- **THEN** the placeholder text renders at `text-xs` (12px), matching body density rather than the card title

### Requirement: README inline editing with conflict-aware save

The detail page SHALL provide an "Edit README" mode that opens a markdown editor prefilled with the current README content. The editor's container SHALL be responsive to viewport width:

- **<1024px** (mobile + tablet): the editor opens inside a full-screen `<Dialog>` modal (preserving existing behavior).
- **≥1024px** (desktop): the editor opens as a right-side resizable panel beside the detail page body, NOT as a `<Dialog>`. The detail body remains visible in the left column. (See `experiment-edit` spec for panel collapse/expand/resize semantics.)

Saving SHALL go through `PUT /api/readme` carrying `expectedMtime` (and optional `expectedHash`) regardless of container.

#### Scenario: Successful save (mobile/tablet)
- **WHEN** the user is at viewport <1024px, edits, and saves; `expectedMtime` matches disk
- **THEN** the `<Dialog>` closes, the rendered detail view updates, and a success toast is shown

#### Scenario: Successful save (desktop)
- **WHEN** the user is at viewport ≥1024px, edits in the side panel, and saves; `expectedMtime` matches disk
- **THEN** the side panel remains open with cleared dirty state (does NOT auto-close — the user typically iterates), the rendered detail view updates, and a success toast is shown

#### Scenario: Conflict on save
- **WHEN** save returns 409 (in either container)
- **THEN** the editor enters a conflict resolution view showing a diff between the user's draft and the current disk content, with three options: "Keep my changes (overwrite)", "Discard mine (use disk)", "Cancel" / "Manual merge"
- **AND** the conflict view renders inside whichever container is active (Dialog on <1024px, side panel on ≥1024px)

### Requirement: localStorage draft and recovery prompt

While the editor is open, content SHALL be auto-saved to `localStorage` keyed by `<file path>:<mtime opened>`. When the user re-opens the editor for the same file:
- If a draft exists for the still-current `mtime` → show a prompt "You have an unsaved draft from N minutes ago — Restore / Discard from disk"
- If a draft exists but `mtime` has advanced → silently discard the draft and inform the user that disk has changed

#### Scenario: Restore draft
- **WHEN** the user clicks "Restore" on the draft prompt
- **THEN** the editor opens with the draft content and the `expectedMtime` of when the draft was started

#### Scenario: Discard outdated draft
- **WHEN** disk mtime is newer than the draft's stored mtime
- **THEN** no prompt is shown, the editor opens with current disk content, and the stale draft is removed

### Requirement: Status edit from the detail page

The detail page SHALL allow the user to change `status` directly via a control (dropdown or button group of the 5 enum values). Confirming the change SHALL invoke the same atomic README + JOURNAL write path defined in the journal spec.

#### Scenario: Mark stale RUNNING as FAILED
- **WHEN** the user opens an experiment with stale RUNNING and selects `FAILED` from the status control
- **THEN** the README front matter `status` becomes `FAILED`, a `[STATUS]` event with `RUNNING → FAILED` is appended to JOURNAL.md, and the badge is cleared

### Requirement: Hypothesis view

The dashboard SHALL include a Hypothesis view per project showing:
- The `## Summary table` rendered as-is
- A list of all hypothesis entries with their statement, status, and a collapsible body
- Cross-links from each entry's `Experiments` field to the corresponding experiment detail pages

#### Scenario: Click experiment cross-link
- **WHEN** the user clicks an experiment ID in a hypothesis entry's `Experiments` field
- **THEN** the user navigates to that experiment's detail page

### Requirement: Journal timeline view

The dashboard SHALL include a Journal view per project rendering `JOURNAL.md` as a reverse-chronological timeline with each event row showing timestamp (rendered in browser timezone), tag, and body. The view SHALL support filtering by tag and by experiment ID.

#### Scenario: Filter by tag
- **WHEN** the user filters tag to `[STATUS]`
- **THEN** only `[STATUS]` events are shown

#### Scenario: Filter by experiment ID
- **WHEN** the user filters by `foo-260503-082800`
- **THEN** only events whose body references that experiment ID are shown

### Requirement: Log viewer integrated into experiment detail

The detail page SHALL list the experiment directory's `*.log`, `*.txt`, `*.out` files. Selecting one SHALL open the log viewer (per the log-viewer spec) inline or in a side panel.

#### Scenario: Open primary log
- **WHEN** the user clicks `stdout.log` in the detail page's log file list
- **THEN** the log viewer opens with the last 100 lines and follow mode enabled

### Requirement: Mobile-responsive layout

The dashboard SHALL be usable on mobile viewports (≥360px width) without horizontal scroll on primary views (list, detail, hypothesis). Layout SHALL adapt via Tailwind responsive utilities; no separate mobile codebase.

#### Scenario: List on narrow viewport
- **WHEN** the experiment list is rendered at 375px width
- **THEN** the table collapses to a card list with status emoji, name, and timestamp visible without horizontal scroll

#### Scenario: Detail on narrow viewport
- **WHEN** the experiment detail page is rendered at 375px width
- **THEN** panels stack vertically and the markdown body remains fully readable

### Requirement: Time rendering in browser timezone

All timestamps in front matter, journal events, and hypothesis `Last verified` dates SHALL be rendered to the user's browser timezone (via `date-fns-tz`), with both relative time ("3 hours ago") and absolute time on hover. The on-disk timestamps remain ISO8601 with the writer's offset and are never rewritten.

#### Scenario: Cross-timezone view
- **WHEN** an experiment's `created_at` is `2026-05-03T08:00:00+08:00` and the browser timezone is `America/Los_Angeles`
- **THEN** the displayed time is `2026-05-02 17:00:00 PDT` with relative "yesterday" or similar

### Requirement: Sub-project tag in experiment list

The experiment list SHALL display a small sub-project badge/tag for each row whose front-matter `project:` value is non-empty AND differs from the enclosing memon project's name. Rows whose front-matter `project:` is empty OR equal to the enclosing project's name SHALL render no badge (avoids visual noise on the common case).

The badge content SHALL be the front-matter `project:` value verbatim. The badge SHALL be visually subordinate to the experiment id and status (smaller text, muted background) so it acts as a grouping hint, not a primary identifier.

#### Scenario: sparse-fsdp list shows recipe badges
- **GIVEN** memon project `sparse-fsdp` containing experiments with `frontMatter.project` values from the set `{predictive-skip-validation, justrl-with-verl, justrl-with-trl-fsdp2, slime-test}`
- **WHEN** the user opens `/p/sparse-fsdp`
- **THEN** each row shows a badge with its respective sub-project label, allowing visual grouping

#### Scenario: project-a list shows no sub-project badges
- **GIVEN** memon project `project-a` whose experiments all declare `frontMatter.project: project-a` (matching the enclosing project)
- **WHEN** the user opens `/p/project-a`
- **THEN** no rows render a sub-project badge (the values match, so the badge would be redundant)

#### Scenario: Mixed list — only divergent rows show badges
- **GIVEN** a memon project `mixed` with two experiments: one declares `frontMatter.project: mixed`, the other declares `frontMatter.project: foo`
- **WHEN** the user opens the list
- **THEN** only the second row renders the `foo` badge; the first renders no badge

### Requirement: AppBar tabs for Reports and Digests

The per-project AppBar SHALL include two new tabs in addition to the existing Experiments / Hypotheses / Journal: `Reports` (active for paths under `/p/<proj>/reports/...`) and `Digests` (active for paths under `/p/<proj>/digests/...`). The tab order SHALL be Experiments / Hypotheses / Journal / Reports / Digests, left to right.

#### Scenario: Reports tab active on its routes
- **WHEN** the user is on `/p/sparse-fsdp/reports` or `/p/sparse-fsdp/reports/R0001`
- **THEN** the Reports tab in the AppBar is rendered active

#### Scenario: Switching tabs preserves project context
- **WHEN** the user clicks Digests while viewing a project
- **THEN** they navigate to `/p/<project>/digests` and the project context (sidebar selection, project layout's prefetched data) stays

### Requirement: Reports route serves the inbox shell

Routes `/p/[project]/reports` and `/p/[project]/reports/[id]` SHALL render the same shared inbox shell, parameterized with `kind="reports"`. The list-only URL SHALL show an empty right pane with the reports empty-state copy when no item is selected (or the directory is empty); the `[id]`-bearing URL SHALL highlight that item in the rail and render its content in the right pane.

#### Scenario: Direct deep link
- **WHEN** the user navigates to `/p/sparse-fsdp/reports/R0001`
- **THEN** the page renders the inbox shell with `R0001-predictive-skip-p3` highlighted in the rail and its content rendered

#### Scenario: List-only URL with no selection
- **WHEN** the user navigates to `/p/sparse-fsdp/reports`
- **THEN** the page renders the inbox shell with no item highlighted; the right pane shows the reports empty-state-when-none-selected copy

### Requirement: Digests route serves the inbox shell with `kind="digests"`

Routes `/p/[project]/digests` and `/p/[project]/digests/[id]` SHALL render the same shared inbox shell as Reports, parameterized with `kind="digests"`. The id pattern in the URL SHALL be the canonical 4-digit `D<NNNN>` form (the date suffix is part of the on-disk filename but not the URL).

#### Scenario: Digest URL contains canonical id only
- **GIVEN** a digest file `D0001-2026-05-04.md` on disk
- **WHEN** the rail renders its link
- **THEN** the link target is `/p/<proj>/digests/D0001` (NOT `/p/<proj>/digests/D0001-2026-05-04`)

