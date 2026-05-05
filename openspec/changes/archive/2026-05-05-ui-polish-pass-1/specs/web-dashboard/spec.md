## MODIFIED Requirements

### Requirement: Experiment list view

The experiment list view SHALL render a card-stack of all experiments in the current project. Each row SHALL be a single card with two visual sections:

1. **Top stripe** (a horizontal row): in left-to-right order, `ID` (monospace, with the colored status pill rendered inline immediately after the id text within the same cell), `Sub-project` (a dedicated column rendering the front-matter `project:` value as a `<Badge variant="secondary">` ONLY when that value is non-empty AND distinct from the membership project; otherwise the cell SHALL render empty so the surrounding grid columns stay aligned across rows), `Created` (timestamp, locale-rendered after hydration), and `Updated` (mtime, same rendering rule). On the `md` breakpoint or wider the columns SHALL use a 12-column grid with the allocation `id+status: 5`, `sub-project: 2`, `created: 2`, `updated: 3`.

2. **Chip line** below the top stripe (rendered only when at least one chip is present): a flex-wrap row containing — in this order — every hypothesis ID as a clickable badge, then every tag as an outline badge, then a `no README` warning badge if `hasReadme` is false. The line SHALL be omitted entirely when there are no hypotheses, no tags, and `hasReadme` is true.

The list SHALL support client-side sort and filter on every top-stripe column (including the new sub-project column), plus a free-text search box matching against name + tags + hypotheses + sub-project label.

#### Scenario: Sort by created descending (default)
- **WHEN** the user opens the experiment list
- **THEN** experiments are listed by `created_at` descending by default

#### Scenario: Status pill is inline with the id
- **WHEN** the user looks at any row
- **THEN** the experiment id is the leftmost element in the top stripe and the colored status pill renders immediately after it within the same grid cell (no separate status column)

#### Scenario: Sub-project column renders divergent project as a badge
- **GIVEN** an experiment whose `frontMatter.project` is `"sparse-fsdp"` and whose membership project is `"project-a"`
- **WHEN** the row renders
- **THEN** the sub-project column shows a secondary badge with `"sparse-fsdp"`

#### Scenario: Sub-project column collapses for matching project
- **GIVEN** an experiment whose `frontMatter.project` equals the membership project (or is empty)
- **WHEN** the row renders
- **THEN** the sub-project column is empty for that row but reserves its grid width so adjacent columns stay aligned with rows that do show a badge

#### Scenario: Header row mirrors body columns
- **WHEN** the experiment list header row renders at desktop width
- **THEN** the column labels read, in order, `id`, `sub-project`, `created`, `updated` (no separate `status` label)

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
- **THEN** the chip line wraps into multiple lines using the full row width (no longer constrained to a `col-span-2` cell), and the top stripe (id+status / sub-project / created / updated) stays on one line above
