## MODIFIED Requirements

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
