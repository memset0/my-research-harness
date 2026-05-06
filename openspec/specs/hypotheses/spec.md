# hypotheses Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: HYPOTHESES.md location

Each project SHALL have at most one `hypotheses.md` file located at `<root>/docs/hypotheses.md` (lowercase filename, inside the project's `docs/` subdirectory, where `<root>` is configured in `config.yml`). The file is the single source of truth for hypothesis state in that project. The legacy v1 location (`<root>/HYPOTHESES.md`, ALL-CAPS, at the project root) is NOT a valid v2 location; v1 projects SHALL be migrated via `memon-migrate-fs` (driven by `packages/core/migrations/v1-to-v2.md`) before memon will read the hypotheses file under v2.

#### Scenario: File at canonical v2 path
- **WHEN** a project's root is `/mnt/p` and `/mnt/p/docs/hypotheses.md` exists
- **THEN** the system reads hypothesis state from that file

#### Scenario: No hypotheses file
- **WHEN** no `docs/hypotheses.md` exists at the project root
- **THEN** the project has no hypotheses; reads return an empty list and writes create `docs/hypotheses.md` (creating `docs/` if needed)

#### Scenario: v1 path is not a fallback
- **GIVEN** a project root that has `<root>/HYPOTHESES.md` (legacy v1 location) but no `<root>/docs/hypotheses.md`
- **WHEN** memon attempts to read the hypotheses file under v2
- **THEN** memon SHALL treat the file as missing and SHALL NOT silently fall back to the v1 path
- **AND** the user SHALL be steered to `memon-migrate-fs` via the install-time version-mismatch banner from `fs-migration-runtime`

### Requirement: Hypothesis status legend with 5 states

The hypothesis status enum SHALL have exactly 5 values, each mapped to a fixed emoji symbol:

| Emoji | Status      |
|:-----:|-------------|
| ✅    | `CONFIRMED` |
| ❌    | `REFUTED`   |
| 🟡    | `PARTIAL`   |
| 🔵    | `OPEN`      |
| ⚪    | `DEFERRED`  |

These status emojis SHALL NOT overlap with experiment status emojis (📝🟢✅❌❓), so the only emoji collision is intentional (`✅`/`❌` carry the same semantic across both domains: success/failure).

#### Scenario: Render in summary table
- **WHEN** the frontend renders the hypothesis summary table
- **THEN** each row's Status column displays the emoji corresponding to the hypothesis's `Status` value

### Requirement: Per-hypothesis entry schema

Each hypothesis SHALL be a top-level H2 section in `HYPOTHESES.md` titled `## H<NNNN>. <slug>` where `<NNNN>` is a 4-digit zero-padded positive integer (e.g. `## H0001. v-prediction-converges-faster`) unique within the project. The body SHALL contain the following labeled bullet items:

- `**Statement**`: one-paragraph claim
- `**Origin**`: link or description of where the hypothesis originated
- `**Status**`: one of the 5 enum values, prefixed by its emoji
- `**Experiments**`: list of experiment IDs (directory names) with optional role labels
- `**Evidence**`: bulleted observations with quantitative numbers when available
- `**Caveats**`: known limits or scope restrictions
- `**Last verified**`: ISO date `YYYY-MM-DD`

The parser SHALL be strict: any heading that does not match `^## H\d{4}\. ` (exactly 4 digits) is treated as malformed. The parser SHALL surface a structured warning (`code: 'INVALID_HYPOTHESIS_ID'`, value: the offending heading) and SHALL skip the entry rather than fail the whole document.

#### Scenario: Padded entry parsed
- **WHEN** an entry titled `## H0003. zero-snr-improves-brightness` follows the schema
- **THEN** the parser exposes a structured hypothesis record with `id: "H0003"` and all fields populated

#### Scenario: Unpadded heading rejected
- **WHEN** an entry is titled `## H3. zero-snr-improves-brightness`
- **THEN** the parser surfaces a `INVALID_HYPOTHESIS_ID` warning naming `H3` and the entry is NOT included in the index

#### Scenario: Out-of-range heading rejected
- **WHEN** an entry is titled `## H10000. some-slug`
- **THEN** the parser surfaces an `INVALID_HYPOTHESIS_ID` warning and the entry is NOT included in the index

#### Scenario: Entry partially complete
- **WHEN** a (well-formed-id) entry is missing `Caveats`
- **THEN** the record loads with `caveats: []` and no error

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

### Requirement: Summary table rendering

The system SHALL render any `## Summary table` H0002 section found in `HYPOTHESES.md` via the standard markdown renderer in the hypothesis overview page. Maintenance of the table content is a human/agent responsibility — `memon` MVP MUST NOT auto-generate or rewrite this section.

#### Scenario: Summary table rendered as-is
- **WHEN** `HYPOTHESES.md` contains a `## Summary table` section
- **THEN** the frontend renders it via the standard markdown renderer in the hypothesis overview page

#### Scenario: No auto-generation
- **WHEN** `HYPOTHESES.md` has no `## Summary table` section
- **THEN** the frontend hypothesis overview displays the per-hypothesis entries without inserting any auto-generated table

### Requirement: Hypothesis ID uniqueness

Hypothesis IDs SHALL be of the canonical form `H<NNNN>` where `<NNNN>` is a 4-digit zero-padded positive integer in `0001`–`9999`, monotonically assigned within the project. Reuse of an ID after deletion is allowed but discouraged.

#### Scenario: Duplicate IDs
- **WHEN** `HYPOTHESES.md` contains two `## H0003.` sections
- **THEN** the parser surfaces a `DUPLICATE_HYPOTHESIS_ID` warning naming `H0003`, and only the first occurrence is indexed

#### Scenario: ID outside [0001, 9999]
- **WHEN** `HYPOTHESES.md` contains `## H0000. <slug>` or `## H10000. <slug>`
- **THEN** the parser surfaces an `INVALID_HYPOTHESIS_ID` warning and skips the entry

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

