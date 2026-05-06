## MODIFIED Requirements

### Requirement: Warnings table with Run column

When present, the experiment doc's `## Warnings` H2 section body SHALL
contain exactly one GFM table. Two header shapes are accepted:

- **v3 canonical (7 columns)**: `| Status | Created | Run | Category |
  Message | Resolved | Note |` (in that order). All new writes MUST
  emit this form.
- **v2 back-compat (6 columns)**: `| Status | Created | Category |
  Message | Resolved | Note |`. The parser SHALL accept this form for
  reads only; each parsed row is annotated with `run: null`. The
  section-bound writer SHALL upgrade the table to the 7-column form on
  its first write — there is no in-place 6-column write path.

Each subsequent row SHALL represent one warning. The table MAY be
preceded by a single descriptive paragraph but SHALL NOT contain other
prose between rows.

The `Run` column value (when present) SHALL be either:
- the run dir base name of the run that the warning applies to (e.g.
  `zero-snr-260502-110000`), OR
- `—` (em dash, or empty) when the warning applies to the experiment as
  a whole and is not attributable to a specific run.

Each warning row SHALL have:
- `Status` ∈ {`OPEN`, `RESOLVED`} (uppercase canonical form)
- `Created` (ISO8601 with timezone offset, set at append time)
- `Run` (run dir name or em-dash, in the v3 form; absent in v2 form
  where the parsed row defaults to `null`)
- `Category` ∈ {`methodology`, `result`, `config`, `data`, `repro`,
  `compare`, `infra`, `other`}
- `Message` (free-text, escaped)
- `Resolved` (ISO8601 with offset when status is RESOLVED, else `—`)
- `Note` (free-text, escaped, populated on resolve)

Each row SHALL carry a stable opaque row identifier embedded as
`<!-- id:w_<isoCreatedColonsToHyphens>_<4hex> -->` at the end of the row
line. Pipe escapes (`\|`) and newline encoding (`<br>`) follow the same
rules as v2.

#### Scenario: Valid v3 7-column table parses to typed array
- **GIVEN** a `## Warnings` section containing a 7-column header row
  plus two rows: one with `Run: zero-snr-260502-110000, Status: OPEN,
  Category: result` and one with `Run: —, Status: RESOLVED, Category:
  config, Resolved: 2026-05-04T11:00+08:00`
- **WHEN** the parser indexes the experiment
- **THEN** `experiment.warnings` is an array of two objects, the first
  with `run: "zero-snr-260502-110000"`, the second with `run: null`

#### Scenario: v2 6-column table back-compat parses with run=null
- **WHEN** the table header row is the legacy 6-column shape
  (`| Status | Created | Category | Message | Resolved | Note |`)
- **THEN** the parser succeeds; each parsed row carries `run: null`;
  no `WARNINGS_TABLE_HEADER_MISMATCH` is surfaced; the section-bound
  writer is permitted (it will emit 7-column on the next write)

<!-- Note: the original `WARNINGS_TABLE_HEADER_MISMATCH` rejection lived
as a scenario inside the "Warnings table with Run column" requirement,
not as its own requirement. The MODIFIED block above replaces that
requirement's body + scenarios entirely (the rejection scenario is
gone, replaced by the v2 6-col back-compat scenario), so no separate
REMOVED block is needed. -->

