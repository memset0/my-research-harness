## ADDED Requirements

### Requirement: HYPOTHESES.md location

Each project SHALL have at most one `HYPOTHESES.md` file located at the project's `root` directory (as configured in `config.yml`). The file is the single source of truth for hypothesis state in that project.

#### Scenario: File at project root
- **WHEN** a project's root is `/mnt/p` and `/mnt/p/HYPOTHESES.md` exists
- **THEN** the system loads it as the hypothesis registry for that project

#### Scenario: File missing
- **WHEN** no `HYPOTHESES.md` exists at the project root
- **THEN** the project's hypothesis registry is empty; the frontend hypothesis view shows an "empty" state with a button to create the file

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

Each hypothesis SHALL be a top-level H2 section in `HYPOTHESES.md` titled `## H<N>. <slug>` where `N` is a positive integer unique within the project. The body SHALL contain the following labeled bullet items:

- `**Statement**`: one-paragraph claim
- `**Origin**`: link or description of where the hypothesis originated
- `**Status**`: one of the 5 enum values, prefixed by its emoji
- `**Experiments**`: list of experiment IDs (directory names) with optional role labels
- `**Evidence**`: bulleted observations with quantitative numbers when available
- `**Caveats**`: known limits or scope restrictions
- `**Last verified**`: ISO date `YYYY-MM-DD`

#### Scenario: Entry parsed
- **WHEN** an entry follows the schema
- **THEN** the parser exposes a structured hypothesis record with all fields populated

#### Scenario: Entry partially complete
- **WHEN** an entry is missing `Caveats`
- **THEN** the record loads with `caveats: []` and no error

### Requirement: Experiment cross-reference by directory name

Hypothesis entries' `Experiments` field SHALL reference experiments by their directory name (e.g. `foo-260503-082800`), NOT by ad-hoc identifiers like `E1`/`E2`.

#### Scenario: Reverse-lookup from hypothesis to experiments
- **WHEN** the frontend opens hypothesis `H1` and that entry's `Experiments` lists `foo-260501-100000` and `bar-260502-150000`
- **THEN** the frontend renders both as clickable links to those experiments' detail pages

#### Scenario: Forward-lookup from experiment to hypotheses
- **WHEN** an experiment's front matter `hypotheses: [H3]` and the project's `HYPOTHESES.md` contains an `H3` entry
- **THEN** the experiment's detail page shows a "Hypotheses" panel listing `H3` with its current status emoji and statement

### Requirement: Summary table rendering

The system SHALL render any `## Summary table` H2 section found in `HYPOTHESES.md` via the standard markdown renderer in the hypothesis overview page. Maintenance of the table content is a human/agent responsibility — `memon` MVP MUST NOT auto-generate or rewrite this section.

#### Scenario: Summary table rendered as-is
- **WHEN** `HYPOTHESES.md` contains a `## Summary table` section
- **THEN** the frontend renders it via the standard markdown renderer in the hypothesis overview page

#### Scenario: No auto-generation
- **WHEN** `HYPOTHESES.md` has no `## Summary table` section
- **THEN** the frontend hypothesis overview displays the per-hypothesis entries without inserting any auto-generated table

### Requirement: Hypothesis ID uniqueness

Hypothesis IDs SHALL be of the form `H<N>` where `N` is a positive integer monotonically assigned within the project. Reuse of an ID after deletion is allowed but discouraged.

#### Scenario: Duplicate IDs
- **WHEN** `HYPOTHESES.md` contains two `## H3.` sections
- **THEN** the parser surfaces a warning naming the duplicate ID, and only the first occurrence is indexed
