## ADDED Requirements

### Requirement: Per-hypothesis `Runs:` field

The hypothesis schema SHALL be extended with an optional `Runs:` bullet
item. Each `## H<NNNN>. <slug>` entry in `docs/hypotheses.md` MAY
contain `**Runs**:` listing run dir base names this hypothesis is
associated with. The list is a free-form comma-separated
or single-line YAML-style array; each element SHALL match the run dir
regex `^.+-\d{6}-\d{6}$`.

The `Experiments:` field's intent shifts in v3: it SHALL list experiment
IDs (`E<NNNN>-<slug>`). For backward compatibility (v2 hypotheses files
that still list run dir names in `Experiments:`), the parser SHALL
disambiguate elements by ID format:
- Element matching `^E\d{4}-` → experiment ref
- Element matching `^.+-\d{6}-\d{6}$` → run ref
- Anything else → surface `INVALID_HYPOTHESIS_REF` and drop the element

Mixed lists (some exp IDs, some run dir names) in `Experiments:` SHALL
be parsed and the elements re-routed to their proper field at read
time, with a `MIGRATE_HYPOTHESIS_REFS` warning per-entry suggesting the
user split into `Experiments:` (exp IDs only) and `Runs:` (run names
only).

#### Scenario: Pure exp-ref Experiments list parses
- **GIVEN** an entry with `**Experiments**: E0001-foo, E0002-bar`
- **WHEN** the parser indexes
- **THEN** `entry.experiments` is `["E0001-foo", "E0002-bar"]`,
  `entry.runs` is `[]`, no warning is emitted

#### Scenario: Pure run-ref Experiments list (legacy v2) parses with warning
- **GIVEN** an entry with `**Experiments**: foo-260501-100000,
  bar-260502-150000` (no `Runs:` field)
- **WHEN** the parser indexes
- **THEN** `entry.experiments` is `[]`, `entry.runs` is
  `["foo-260501-100000", "bar-260502-150000"]`, and a
  `MIGRATE_HYPOTHESIS_REFS` warning is emitted suggesting the user move
  these to a `**Runs**:` field

#### Scenario: Both fields populated
- **GIVEN** an entry with `**Experiments**: E0001-foo` and
  `**Runs**: bar-260501-100000`
- **WHEN** the parser indexes
- **THEN** `entry.experiments` is `["E0001-foo"]`, `entry.runs` is
  `["bar-260501-100000"]`, no warning

#### Scenario: Frontend renders Runs as deep-links
- **GIVEN** a hypothesis entry with `entry.runs = ["bar-260501-100000"]`
  where the run is bound to experiment `E0007-baz`
- **WHEN** the frontend renders the hypothesis page
- **THEN** the run is rendered as a clickable link to
  `/p/<project>/e/E0007-baz?run=bar-260501-100000`

## MODIFIED Requirements

### Requirement: Experiment cross-reference by directory name

Hypothesis entries' `Experiments` field SHALL reference experiments by
their **experiment ID** (`E<NNNN>-<slug>`) in v3. References to specific
runs use the new `Runs` field (per the ADDED requirement above). The
parser tolerates legacy v2 content in `Experiments` (run dir names) by
emitting `MIGRATE_HYPOTHESIS_REFS` warnings and routing the element to
`runs` in the indexed entry.

#### Scenario: Reverse-lookup from hypothesis to experiments
- **WHEN** the frontend opens hypothesis `H0001` whose entry has
  `Experiments: E0001-foo, E0004-bar`
- **THEN** the frontend renders both as clickable links to those
  experiments' detail pages (`/p/<project>/e/E0001-foo` etc.)

#### Scenario: Reverse-lookup from hypothesis to runs
- **WHEN** the frontend opens hypothesis `H0003` whose entry has
  `Runs: zero-snr-260502-110000`
- **THEN** the frontend renders the run as a link to its parent
  experiment page with the run panel auto-expanded
  (`/p/<project>/e/<E-of-run>?run=zero-snr-260502-110000`)

#### Scenario: Forward-lookup from experiment to hypotheses
- **WHEN** an experiment's frontmatter `hypotheses: [H0003]` and the
  project's `docs/hypotheses.md` contains an `H0003` entry
- **THEN** the experiment's detail page shows a "Hypotheses" panel
  listing `H0003` with its current status emoji and statement
