## MODIFIED Requirements

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

Hypothesis entries' `Experiments` field SHALL reference experiments by their directory name (e.g. `foo-260503-082800`), NOT by ad-hoc identifiers like `E1`/`E2`.

#### Scenario: Reverse-lookup from hypothesis to experiments
- **WHEN** the frontend opens hypothesis `H0001` and that entry's `Experiments` lists `foo-260501-100000` and `bar-260502-150000`
- **THEN** the frontend renders both as clickable links to those experiments' detail pages

#### Scenario: Forward-lookup from experiment to hypotheses
- **WHEN** an experiment's front matter `hypotheses: [H0003]` and the project's `HYPOTHESES.md` contains an `H0003` entry
- **THEN** the experiment's detail page shows a "Hypotheses" panel listing `H0003` with its current status emoji and statement

### Requirement: Hypothesis ID uniqueness

Hypothesis IDs SHALL be of the canonical form `H<NNNN>` where `<NNNN>` is a 4-digit zero-padded positive integer in `0001`–`9999`, monotonically assigned within the project. Reuse of an ID after deletion is allowed but discouraged.

#### Scenario: Duplicate IDs
- **WHEN** `HYPOTHESES.md` contains two `## H0003.` sections
- **THEN** the parser surfaces a `DUPLICATE_HYPOTHESIS_ID` warning naming `H0003`, and only the first occurrence is indexed

#### Scenario: ID outside [0001, 9999]
- **WHEN** `HYPOTHESES.md` contains `## H0000. <slug>` or `## H10000. <slug>`
- **THEN** the parser surfaces an `INVALID_HYPOTHESIS_ID` warning and skips the entry
