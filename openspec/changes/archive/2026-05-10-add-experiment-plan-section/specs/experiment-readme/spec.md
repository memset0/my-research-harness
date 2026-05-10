## MODIFIED Requirements

### Requirement: Experiment doc body sections

The experiment doc body SHALL contain the following H2 sections in this
order: `Motivation`, `Method`, `Plan`, `Conclusion`, `Caveats`,
`Warnings`. The parser SHALL tolerate additional non-canonical H2
sections appearing anywhere (preserved verbatim by writers that don't
target them).

The `## New Hypotheses` section SHALL NOT exist in the experiment doc.
Hypothesis-related discussion (testing existing hypotheses or proposing
new ones) lives inline in `Motivation` and `Conclusion`. The structured
record of hypotheses lives in `docs/hypotheses.md` and the
`hypotheses[]` frontmatter array.

The `## Plan` section is the canonical home for forward-looking TODOs
and per-iteration reflections accumulated across the experiment's
member runs. Its body SHALL be free-form markdown. It MAY contain GFM
task list items (`- [ ]` / `- [x]`, `* [ ]` / `* [x]` synonyms also
accepted), nested lists at any depth (each nested item independently
allowed to carry a checkbox), free-form paragraphs, plain bullets, and
sub-headings. The parser SHALL preserve the body verbatim and SHALL
NOT extract individual task items into a structured field.

The parser SHALL store the Plan section body on the experiment record
as `sections.plan: string | null` (null when the section is absent or
its body is empty after trim), parallel to `sections.motivation`,
`sections.method`, `sections.conclusion`, `sections.caveats`.

The serializer SHALL emit `## Plan` in the canonical position
(immediately after `## Method` and before `## Conclusion`) on every
round-trip, even when `sections.plan` is null or empty (placeholder
behavior, consistent with how other empty body sections are emitted
today).

#### Scenario: Section missing or empty
- **WHEN** an experiment doc is missing `## Method`
- **THEN** the parser records the absence on the experiment record but
  does not error; the frontend renders the section as a placeholder
  labeled "to fill"

#### Scenario: New Hypotheses section flagged
- **WHEN** an experiment doc contains a `## New Hypotheses` section (e.g.
  carried over from a v2 run)
- **THEN** the parser surfaces a `LEGACY_NEW_HYPOTHESES_SECTION` warning,
  preserves the body verbatim, and steers the user to relocate the
  content into `Motivation` / `Conclusion` / `docs/hypotheses.md`

#### Scenario: Plan section absent does not error
- **WHEN** an experiment doc has no `## Plan` H2 (e.g. a doc authored
  before this requirement landed)
- **THEN** the parser records `sections.plan = null` and surfaces no
  warning; on next serializer round-trip the writer emits an empty
  `## Plan` placeholder in the canonical position

#### Scenario: Plan body with nested GFM task lists round-trips verbatim
- **GIVEN** an experiment doc whose `## Plan` body is:
  ```
  - [x] Run baseline at LR=1e-4
    - converged but loss plateaued early; try warmup next
  - [ ] Try LR=3e-4 + warmup
    - [ ] Sweep batch size [32, 64, 128]
    - [ ] Compare against rotary baseline
  ```
- **WHEN** the doc is parsed and re-serialized via
  `serializeExperimentReadme`
- **THEN** the emitted `## Plan` body equals the original body
  byte-for-byte modulo trailing whitespace normalization, including
  every `[ ]` / `[x]` marker, indentation, and nesting structure

#### Scenario: Plan body preserves non-checkbox content
- **GIVEN** an experiment doc whose `## Plan` body interleaves
  checkbox items, plain paragraphs, and `### Sub-heading` lines
- **WHEN** the doc is parsed and re-serialized
- **THEN** the round-tripped body preserves all content (checkboxes,
  paragraphs, sub-headings) in original order

#### Scenario: Plan section ordering enforced on serialize
- **GIVEN** a parsed experiment record with non-null
  `sections.motivation` / `sections.method` / `sections.plan` /
  `sections.conclusion` / `sections.caveats` and a non-empty
  `warningsRaw`
- **WHEN** `serializeExperimentReadme` is called
- **THEN** the emitted body contains `## Plan` exactly once, located
  after the `## Method` block's body and before the `## Conclusion`
  H2 line

#### Scenario: Empty Plan placeholder on round-trip of legacy doc
- **GIVEN** an experiment doc authored before this change with no
  `## Plan` heading at all
- **WHEN** the doc is parsed (with `sections.plan = null`) and then
  re-serialized
- **THEN** the emitted body contains a `## Plan` H2 heading in the
  canonical position with an empty body (no task items written by
  the serializer itself)
