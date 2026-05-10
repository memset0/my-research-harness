## ADDED Requirements

### Requirement: Anti-pattern content SHALL be collected under `## Anti-patterns`

Across the bundled skills, content of the form "❌ this skill must not do X" SHALL be collected in a single section titled `## Anti-patterns` per skill. The heading `## Constraints` SHALL NOT appear in any SKILL.md file. Skills with both `## Anti-patterns` and `## Errors` SHALL position `## Anti-patterns` immediately before `## Errors`.

The following content classifications are exempt from being moved into `## Anti-patterns`:

- **`## When NOT to use`** sections — when the routing-decision bullets already capture the anti-pattern role for that skill (e.g. `memon-append-journal`), no separate `## Anti-patterns` section is required.
- **`## Heuristics`** sections — content consisting of positive judgment guidance ("prefer …", "be willing to …") rather than blanket prohibitions stays under `## Heuristics`. `memon-propose` is the canonical example; its bullets are calibration / prioritisation guidance, not "never do X" rules. The heading `## Heuristics` SHALL be reserved for this kind of content.

#### Scenario: No SKILL.md uses `## Constraints`
- **WHEN** a reader runs `grep -l '^## Constraints$' packages/skills/memon-*/SKILL.md`
- **THEN** the output is empty (no file matches)

#### Scenario: 6 of 8 skills use `## Anti-patterns`
- **WHEN** a reader runs `grep -l '^## Anti-patterns$' packages/skills/memon-*/SKILL.md`
- **THEN** the output lists 6 files: `memon-write-script`, `memon-run-experiment`, `memon-append-warning`, `memon-migrate-fs`, `memon-digest-journal`, `memon-write-report`

#### Scenario: `memon-propose` keeps `## Heuristics`
- **WHEN** a reader inspects `packages/skills/memon-propose/SKILL.md`
- **THEN** it contains exactly one `## Heuristics` section
- **AND** it does NOT contain a `## Anti-patterns` section
- **AND** the Heuristics bullets are a mix of positive guidance and prioritisation advice (not blanket prohibitions)

#### Scenario: `memon-append-journal` relies on `## When NOT to use`
- **WHEN** a reader inspects `packages/skills/memon-append-journal/SKILL.md`
- **THEN** it contains exactly one `## When NOT to use` section
- **AND** it does NOT contain a `## Anti-patterns` section (`## When NOT to use` covers the role)

#### Scenario: `## Anti-patterns` is positioned before `## Errors`
- **WHEN** a reader inspects any SKILL.md that contains both headings
- **THEN** `## Anti-patterns` appears at a smaller line number than `## Errors`
