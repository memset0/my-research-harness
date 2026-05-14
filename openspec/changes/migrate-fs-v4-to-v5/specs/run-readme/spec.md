## MODIFIED Requirements

### Requirement: Run README body sections

The run `README.md` body SHALL be parsed against a canonical H2 list of four section names. Three sections are **required** (always parsed; empty body is permitted), and one is **optional** (rendered only when populated).

Canonical post-v5 section list (order matches the reading flow):

| Section | Required? | Purpose |
|---|---|---|
| `Motivation` | optional | Why this specific run was launched, if it differs from / refines the parent experiment's Motivation. Rare in practice — most runs inherit motivation from the parent exp. |
| `Setup` | required | Per-run inputs AND per-run methodology refinements (config, ckpt path, dataset slice, sweep parameter values, model variant, any methodology delta from the parent exp's Method). Methodology content lives here on the run side; the run README has no separate `Method` section. |
| `Result` | required | This run's own findings AND any per-run conclusion the user wants recorded alongside the run. Conclusion-style content lives here on the run side; the run README has no separate `Conclusion` section. |
| `Artifacts` | required | User-maintained list of expected/intended outputs in the form `- \`./path/\` — description` |

The web UI SHALL render each section as a `SectionCard` when its parsed body is non-null. The optional `Motivation` section with a null body SHALL be skipped (not rendered as an empty placeholder). The required sections SHALL render even when empty, with a placeholder label like "to fill".

The web UI augments `Artifacts` with an automatic file listing under the run dir; the manual list and the auto list are complementary (the manual list expresses *intent*, the auto list reflects *actuality*).

The sections `Method`, `Conclusion`, and `Caveats` are **removed** from the run README's canonical list. Each one's content has a designated home elsewhere:

- `Method` on the run side → content belongs in `## Setup` of the same run README (per-run methodology refinements are an aspect of the run's setup, not a separate section).
- `Conclusion` on the run side → content belongs in `## Result` of the same run README (per-run conclusions are the run's findings).
- `Caveats` on the run side → content belongs in the **parent experiment doc's** `## Caveats` (cross-run interpretation limits).

If a run README contains one of these forbidden headings:

- If the section body is non-empty, the parser SHALL surface a parse warning of `severity: 'warning'` with a code-specific suggestion:
  - `RUN_HAS_METHOD` → "relocate content into this run's `## Setup`"
  - `RUN_HAS_CONCLUSION` → "relocate content into this run's `## Result`"
  - `RUN_HAS_CAVEATS` → "relocate content into the parent experiment doc's `## Caveats`"
- If the section body is empty, the parser SHALL still surface the warning at `severity: 'info'` so the dangling heading can be auto-cleaned by the migration script.

The content SHALL be preserved verbatim in `body` so the user doesn't lose data; no typed `sections.method` / `sections.conclusion` / `sections.caveats` field is populated on the run record.

The legacy sections `Warnings` and `New Hypotheses` SHALL NOT appear in run READMEs (post-v3). If they do, the parser SHALL surface `LEGACY_SECTION_IN_RUN` per the prior requirement.

#### Scenario: Required section missing
- **WHEN** a run README is missing `## Result`
- **THEN** the parser records the absence on the run record but does not error; the frontend renders the section as a placeholder labeled "to fill"

#### Scenario: Optional Motivation populated renders in canonical order
- **GIVEN** a run README with non-null `Motivation`, `Setup`, `Result`, `Artifacts`
- **WHEN** the web UI renders the run detail page
- **THEN** four `SectionCard`s appear in this order: Motivation → Setup → Result → Artifacts
- **AND** no Method / Conclusion / Caveats cards are rendered

#### Scenario: Motivation absent skips rendering
- **GIVEN** a run README with only `Setup`, `Result`, `Artifacts` populated (no `Motivation`)
- **WHEN** the web UI renders the run detail page
- **THEN** only three `SectionCard`s appear (Setup → Result → Artifacts); no placeholder for the absent Motivation

#### Scenario: Run-side Method with content surfaces warning
- **GIVEN** a run README with `## Method` followed by non-empty body text
- **WHEN** the parser reads it
- **THEN** `parseWarnings` contains a `RUN_HAS_METHOD` entry naming the heading and pointing to this run's `## Setup` as the relocation target
- **AND** the body content is preserved verbatim in `body`
- **AND** no typed `sections.method` field is populated on the run record

#### Scenario: Run-side Conclusion with content surfaces warning
- **GIVEN** a run README with `## Conclusion` followed by non-empty body text
- **WHEN** the parser reads it
- **THEN** `parseWarnings` contains a `RUN_HAS_CONCLUSION` entry naming the heading and pointing to this run's `## Result` as the relocation target
- **AND** the body content is preserved verbatim in `body`
- **AND** no typed `sections.conclusion` field is populated on the run record

#### Scenario: Run-side Caveats with content surfaces warning
- **GIVEN** a run README with `## Caveats` followed by non-empty body text
- **WHEN** the parser reads it
- **THEN** `parseWarnings` contains a `RUN_HAS_CAVEATS` entry naming the heading and pointing to the parent exp doc as the relocation target
- **AND** the body content is preserved verbatim in `body`
- **AND** no typed `sections.caveats` field is populated on the run record

#### Scenario: Run-side forbidden section with empty body surfaces info-warning
- **GIVEN** a run README with `## Method` (or `## Conclusion` or `## Caveats`) followed by only whitespace / blank lines
- **WHEN** the parser reads it
- **THEN** `parseWarnings` contains a corresponding `RUN_HAS_*` entry of `severity: 'info'` recommending the dangling heading be removed

#### Scenario: Artifacts list parsed
- **WHEN** the `Artifacts` section contains `- \`./outputs/foo.csv\` — per-CFG breakdown`
- **THEN** the parser exposes `artifacts: [{path: "./outputs/foo.csv", description: "per-CFG breakdown"}]`

## ADDED Requirements

### Requirement: Run parser emits `UNKNOWN_H2_SECTION` warning for non-canonical H2 headings

The run-README parser SHALL emit a `parseWarnings` entry of `code: 'UNKNOWN_H2_SECTION'` whenever it encounters an H2 heading whose normalized text is not in the canonical post-v5 list (`Motivation`, `Setup`, `Result`, `Artifacts`) and is not separately covered by a more-specific code:

- `RUN_HAS_METHOD` for the forbidden `Method` heading
- `RUN_HAS_CONCLUSION` for the forbidden `Conclusion` heading
- `RUN_HAS_CAVEATS` for the forbidden `Caveats` heading
- `LEGACY_SECTION_IN_RUN` for the pre-v3 `Warnings` / `New Hypotheses` headings

The body following the unknown heading SHALL be preserved verbatim in `body`. The warning record SHALL include the heading text and the source line number.

#### Scenario: Unknown H2 in run README surfaces warning
- **GIVEN** a run README containing `## Notes` (not in canonical list, not one of the named forbidden sections)
- **WHEN** the parser reads it
- **THEN** `parseWarnings` includes `{ code: 'UNKNOWN_H2_SECTION', severity: 'warning', heading: 'Notes', line: <n>, ... }`
- **AND** the body content under `## Notes` is preserved verbatim in `body`

#### Scenario: Forbidden and unknown H2 produce distinct warning codes
- **GIVEN** a run README containing both `## Caveats` AND `## Findings`
- **WHEN** the parser reads it
- **THEN** `parseWarnings` includes one `RUN_HAS_CAVEATS` (for `Caveats`) AND one `UNKNOWN_H2_SECTION` (for `Findings`) — the two codes are mutually exclusive per heading
