# web-dashboard Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: Project selector in top navigation

The dashboard SHALL display a project selector in the top navigation showing all projects from the resolved `config.yml`. Switching project SHALL update the experiment list, hypothesis view, and journal view to that project's data without full page reload.

#### Scenario: Switching projects
- **WHEN** the user clicks a different project in the selector
- **THEN** the URL updates with the project identifier and the views re-fetch data scoped to the new project

### Requirement: Experiment list view

The experiment list view SHALL render a table of all experiments in the current project, with at minimum these columns: `Status` (emoji), `ID` (directory name), `Name`, `Created`, `Hypotheses`, `Tags`. The table SHALL support client-side sort and filter on every column, plus a free-text search box matching against name + tags + hypotheses.

#### Scenario: Sort by created descending (default)
- **WHEN** the user opens the experiment list
- **THEN** experiments are listed by `created_at` descending by default

#### Scenario: Filter by status
- **WHEN** the user filters Status to `RUNNING`
- **THEN** only experiments with `status: RUNNING` are shown

#### Scenario: Search by tag
- **WHEN** the user types `moe` in the search box
- **THEN** only experiments whose tags include `moe` (or other matching fields) are shown

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
- Front matter as a structured panel (id, name, project, status, host, pid, gpus, created/finished, command, entry, wandb link)
- Body sections (Motivation/Setup/Method/Result/Conclusion/Caveats/Artifacts/(opt) New Hypotheses) as rendered markdown
- A "Hypotheses" panel listing related hypotheses with their current status emoji
- An "Artifacts" panel listing the parsed Artifacts section entries with clickable paths
- A "Resources" placeholder panel labeled "not yet available" (hook for future GPU/disk monitoring)

#### Scenario: Render section
- **WHEN** the README has a `## Method` section with content
- **THEN** the detail page renders that section under a "Method" heading

#### Scenario: Hypotheses panel cross-link
- **WHEN** the experiment's front matter has `hypotheses: [H3]` and `H3` exists in `HYPOTHESES.md`
- **THEN** the panel shows H3 with its status emoji and a link to its hypothesis entry

### Requirement: Section card typography hierarchy

Within every card on the experiment detail page, the body content SHALL render at a smaller font size than the card's title, so each card has an unambiguous title-vs-content visual hierarchy. Concretely, `CardTitle` continues at `text-sm` (14px) while body content — rendered markdown for the README sections (Motivation/Setup/Method/Result/Conclusion/Caveats/New Hypotheses), the "to fill" placeholder for empty sections, and the Resources placeholder — renders at `text-xs` (12px), matching the card's own `text-xs/relaxed` default and the existing Artifacts list density.

#### Scenario: Markdown body smaller than section title
- **WHEN** a section card renders its rendered-markdown body (e.g. the `Method` section)
- **THEN** the body paragraphs render at `text-xs` (12px), visibly smaller than the `text-sm` (14px) `Method` heading

#### Scenario: Empty section placeholder smaller than section title
- **WHEN** a section card has no body content and shows the "to fill" placeholder, OR the Resources card shows its "not yet available" placeholder
- **THEN** the placeholder text renders at `text-xs` (12px), matching body density rather than the card title

### Requirement: README inline editing with conflict-aware save

The detail page SHALL provide an "Edit README" mode that opens a markdown editor (with WYSIWYG-light support) prefilled with the current README content. Saving SHALL go through `PUT /api/readme` carrying `expectedMtime`.

#### Scenario: Successful save
- **WHEN** the user edits and saves and `expectedMtime` matches disk
- **THEN** the editor closes, the rendered view updates, and a success toast is shown

#### Scenario: Conflict on save
- **WHEN** save returns 409
- **THEN** the editor enters a conflict resolution view showing a diff between the user's draft and the current disk content, with three options: "Keep my changes (overwrite)", "Discard mine (use disk)", "Manual merge"

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

