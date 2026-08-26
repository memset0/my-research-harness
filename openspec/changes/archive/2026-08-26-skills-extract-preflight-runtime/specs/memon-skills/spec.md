## ADDED Requirements

### Requirement: Bundled skills SHALL ship a canonical `PREFLIGHT.md` doc

A single canonical document `packages/skills/PREFLIGHT.md` SHALL exist in the bundled `@memon/skills` source. It SHALL contain the full 4-branch preflight protocol (`match` / `behind` / `uninitialised` / `ahead`) that spec-mutating skills consult when `memon fs-version check --project-root <p> --format json` returns a non-`match` status. The doc SHALL include the exact user-facing wording (English instructions plus the embedded Chinese-language dialogue lines that skills use when surfacing a non-`match` status to the user).

PREFLIGHT.md SHALL include a paragraph stating that `memon-migrate-fs` is exempt from the preflight (it IS the migration runtime and reads `.memon/version.json` directly).

This change introduces the doc only. The existing requirement that skill bodies inline the preflight preamble is **not modified by this change**; SKILL.md files keep their current inline preflight sections. (A follow-up change replaces the inline sections with pointers to PREFLIGHT.md.)

#### Scenario: PREFLIGHT.md exists in source
- **WHEN** a reader inspects the bundled `@memon/skills` source tree
- **THEN** `packages/skills/PREFLIGHT.md` exists as a sibling of the `memon-*/` skill directories
- **AND** its body enumerates all four status branches (`match`, `behind`, `uninitialised`, `ahead`) with the user-facing recommendation for each

#### Scenario: PREFLIGHT.md names the migrate-fs exemption
- **WHEN** a reader inspects `packages/skills/PREFLIGHT.md`
- **THEN** the body contains a sentence stating that `memon-migrate-fs` is exempt from the preflight, citing the reason (it IS the migration runtime)

#### Scenario: SKILL.md files are unchanged in this change
- **WHEN** a reader compares any of the seven affected SKILL.md files (`memon-write-script`, `memon-run-experiment`, `memon-append-journal`, `memon-append-warning`, `memon-digest-journal`, `memon-write-report`, `memon-propose`) before and after this change
- **THEN** the inline `## Preflight — FS convention version` section is byte-equal to its pre-change content
