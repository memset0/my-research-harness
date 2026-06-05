## ADDED Requirements

### Requirement: Code-review list page grouped by scope

The dashboard SHALL provide a per-project route `/p/<project>/code-review`
listing all of the project's code-review docs, grouped into a "Project-wide"
group and one group per experiment (keyed by the docs' frontmatter
`experiment`). Each row SHALL show the title, the date, the scope, and a
completion badge derived from the doc's completion summary (e.g. `2/5 · 1/3`,
or a "Complete" badge when `isComplete`). Rows SHALL link to the doc's detail
route. The page SHALL stay live via the `code-reviews-change` SSE topic.

#### Scenario: Grouped listing
- **GIVEN** two project-wide docs and one doc under experiment `E0042-attn`
- **THEN** the list shows a "Project-wide" group with two rows and an "E0042-attn" group with one row, each row carrying a completion badge

#### Scenario: Empty state
- **WHEN** the project has no code-review docs
- **THEN** the page renders a non-error empty state

### Requirement: Code-review detail page renders body + interactive checklists

The route `/p/<project>/code-review/<...id>` SHALL render:
- the markdown body via the shared `<Markdown>` component (LaTeX math via
  KaTeX and GFM already supported), so `$...$` / `$$...$$` formulas and
  tables/links in the body render;
- a **commit checklist**: one row per `commits[]` entry showing the `subject`
  (or `sha`), the `repo`, an external link opening the commit `url` in a new
  tab, and a checkbox bound to `reviewed`;
- a **review todolist**: one checkbox row per `review_todolist[]` item bound
  to `done`;
- a derived **completion** indicator (counts + complete / incomplete).

#### Scenario: Body math renders
- **GIVEN** a doc whose body contains a `$$...$$` block
- **WHEN** the detail page renders
- **THEN** the formula is rendered by KaTeX (not shown as raw `$$`)

#### Scenario: Commit links are openable
- **GIVEN** a commit entry with a GitHub `url`
- **THEN** the row exposes a link to that exact url opening in a new tab

### Requirement: Toggling a checkbox writes progress with optimistic locking

Checking or unchecking a commit or todolist box SHALL issue the progress
`PATCH` carrying the last-known `expectedMtime`/`expectedHash`. On success the
UI SHALL update the completion state and re-baseline its mtime/hash from the
response. On 409 CONFLICT the UI SHALL revert the optimistic change and
surface a "stale snapshot — reload" affordance (matching the README edit
flow). Concurrent external changes SHALL arrive via the `code-reviews-change`
SSE topic and refresh the view.

#### Scenario: Successful toggle
- **WHEN** the user checks a commit box and the PATCH succeeds
- **THEN** the box stays checked, the completion badge updates, and the buffer re-baselines to the new mtime/hash

#### Scenario: Conflict on toggle
- **WHEN** the PATCH returns 409 CONFLICT
- **THEN** the box reverts and the user is offered a reload

### Requirement: Experiment detail page surfaces associated code-reviews

The experiment detail page SHALL include a panel listing the code-review docs
whose frontmatter `experiment` equals that experiment's id, each with its
completion badge and a link to the detail route. The panel SHALL derive its
data from the same project code-reviews list (no new experiment API field)
and stay live via the `code-reviews-change` topic.

#### Scenario: Associated reviews shown
- **GIVEN** experiment `E0042-attn` has two associated code-review docs (one complete, one at 1/3 todos)
- **WHEN** its detail page renders
- **THEN** the panel lists both with their completion badges, each linking to its detail route

#### Scenario: No associated reviews
- **WHEN** an experiment has no associated code-reviews
- **THEN** the panel is absent or shows a quiet empty state (no error)
