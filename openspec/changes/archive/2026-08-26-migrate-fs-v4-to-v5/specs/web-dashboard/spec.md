## ADDED Requirements

### Requirement: Run detail page renders four canonical sections; never renders Method / Conclusion / Caveats

The run detail page (rendered by `apps/web/components/run-page.tsx` or equivalent) SHALL render `SectionCard`s for the post-v5 canonical run-README sections in the canonical order:

1. `Motivation` (rendered only when `sections.motivation` is non-null — optional section)
2. `Setup` (always rendered; placeholder if empty)
3. `Result` (always rendered; placeholder if empty)
4. `Artifacts` (always rendered; the auto-discovered file listing is appended to the user-maintained list)

The page SHALL NOT render `Method`, `Conclusion`, or `Caveats` cards under any circumstance. If a run README has any of those headings (which now surface as `RUN_HAS_METHOD` / `RUN_HAS_CONCLUSION` / `RUN_HAS_CAVEATS` parse warnings), the warning SHALL appear in the page's `parse_warnings` banner with a heading-specific relocation hint:

- `RUN_HAS_METHOD` → "Method on a run README belongs in `## Setup` of the same run"
- `RUN_HAS_CONCLUSION` → "Conclusion on a run README belongs in `## Result` of the same run"
- `RUN_HAS_CAVEATS` → "Caveats belongs on the parent experiment doc's `## Caveats`"

The page SHALL surface `UNKNOWN_H2_SECTION` parse warnings in the same `parse_warnings` banner — one bullet per heading, naming the heading text and the source line number.

#### Scenario: Run page with Motivation populated
- **GIVEN** a run README whose parsed sections include non-null `Motivation` alongside the required Setup/Result/Artifacts
- **WHEN** the run detail page renders
- **THEN** four `SectionCard`s appear in the order Motivation → Setup → Result → Artifacts
- **AND** no Method / Conclusion / Caveats cards appear anywhere

#### Scenario: Run page without Motivation
- **GIVEN** a run README with only Setup, Result, Artifacts populated
- **WHEN** the run detail page renders
- **THEN** three `SectionCard`s appear (Setup → Result → Artifacts) with no placeholder for the absent Motivation

#### Scenario: Run page surfaces forbidden-section warnings in the banner
- **GIVEN** a run README with `## Method`, `## Conclusion`, AND `## Caveats` (each with non-empty body)
- **WHEN** the run detail page renders
- **THEN** the page's `parse_warnings` banner contains three distinct bullets, one per heading, each with the heading-specific relocation hint
- **AND** no Method / Conclusion / Caveats cards are rendered as sections

#### Scenario: Run page surfaces UNKNOWN_H2_SECTION warnings
- **GIVEN** a run README with a custom `## Notes` heading
- **WHEN** the run detail page renders
- **THEN** the page's `parse_warnings` banner includes a bullet naming the `Notes` heading
- **AND** no `Notes` section is rendered as a typed `SectionCard`
- **AND** the body content under `## Notes` is preserved in the rendered markdown body where it appears in source order (so the user doesn't lose visual continuity of their content)
