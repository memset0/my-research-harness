## MODIFIED Requirements

### Requirement: Code-review list page grouped by scope

The dashboard SHALL provide a per-project route `/<host>/<project>/code-review`
listing all of the project's code-review docs, grouped into a "Project-wide"
group and one group per experiment (keyed by the docs' frontmatter
`experiment`). Each row SHALL show the title, the date, the scope, and a
completion badge derived from the doc's completion summary (e.g. `2/5 · 1/3`,
or a "Complete" badge when `isComplete`). Rows SHALL link to the doc's
canonical detail route (see "Code-review detail page renders body +
interactive checklists"). The page SHALL stay live via the `code-reviews-change` SSE topic.

#### Scenario: Grouped listing
- **GIVEN** two project-wide docs and one doc under experiment `E0042-attn`
- **THEN** the list shows a "Project-wide" group with two rows and an "E0042-attn" group with one row, each row carrying a completion badge
- **AND** the project-wide rows link to `/<host>/<project>/cr/<date>-<slug>` and the Experiment row links to `/<host>/<project>/e/42/cr/<date>-<slug>`

#### Scenario: Empty state
- **WHEN** the project has no code-review docs
- **THEN** the page renders a non-error empty state

### Requirement: Code-review detail page renders body + interactive checklists

A project-wide review `docs/code-review/<date>-<slug>.md` SHALL be served at
`/<host>/<project>/cr/<date>-<slug>`, and an Experiment review
`docs/experiments/E<NNNN>-<slug>/code-review/<date>-<slug>.md` at
`/<host>/<project>/e/<n>/cr/<date>-<slug>`, where `<n>` is the Experiment
number without leading zeros (see the page-routes capability). Legacy
`/h/<host>/p/<project>/code-review/…` detail URLs redirect to these paths. A
review key that is not `<date>-<slug>` SHALL render the not-found page; a
well-formed key that names no review doc SHALL show the detail view's
not-found state. Each
route SHALL render:
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

#### Scenario: Experiment review route
- **GIVEN** the review `docs/experiments/E0005-bf16-flow-matching/code-review/2026-05-22-bf16-precision-guard.md` in `project-a` on `host-a`
- **WHEN** the user opens `/host-a/project-a/e/5/cr/2026-05-22-bf16-precision-guard`
- **THEN** that review's body and checklists render

#### Scenario: Project-wide review route
- **GIVEN** the review `docs/code-review/2026-05-24-fsdp-comm-overlap.md` in `project-a` on `host-a`
- **WHEN** the user opens `/host-a/project-a/cr/2026-05-24-fsdp-comm-overlap`
- **THEN** that review's body and checklists render
