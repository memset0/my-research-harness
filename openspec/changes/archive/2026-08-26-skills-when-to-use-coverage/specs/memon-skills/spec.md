## ADDED Requirements

### Requirement: Every bundled skill body SHALL contain `When to use` and `When NOT to use` sections

Every memon skill body in `packages/skills/memon-*/SKILL.md` SHALL contain exactly one `## When to use` section and exactly one `## When NOT to use` section, positioned near the top of the body (after the `## Preflight — FS convention version` pointer and before the workflow / detail sections). Each section SHALL contain between 3 and 6 bullets inclusive (the existing skills' sections sit at the lower end; new sections in this change target 4–5). The bullets SHALL be one short sentence each.

`## When to use` bullets SHALL be positive declarative scenarios that name the trigger ("the user asks…", "you observed…", "an existing X needs Y"). They SHALL NOT be hedged or use "maybe" / "should consider" framing.

`## When NOT to use` bullets SHALL each begin with the `❌` glyph and SHALL name the alternative skill or surface where the work belongs instead (e.g. "❌ For status changes — `memon experiment status set`"). They SHALL NOT just say "don't use this skill" without naming the alternative.

This requirement applies to all eight bundled skills, including `memon-migrate-fs` (which already conforms).

#### Scenario: All 8 skills carry the sections
- **WHEN** a reader runs `grep -l '^## When to use$' packages/skills/memon-*/SKILL.md`
- **THEN** all 8 skill files appear in the output
- **AND** running `grep -l '^## When NOT to use$' packages/skills/memon-*/SKILL.md` also lists all 8

#### Scenario: Sections sit immediately after the preflight pointer
- **WHEN** a reader inspects any of the 8 SKILL.md files
- **THEN** the `## When to use` section heading appears in the file at a line number greater than the `## Preflight — FS convention version` heading line
- **AND** there is no other `## ` top-level section heading between the end of the preflight pointer and the start of `## When to use` (apart from the preflight section itself)

#### Scenario: Bullet count is between 3 and 6 inclusive
- **WHEN** a reader counts the bullets in either `## When to use` or `## When NOT to use` of any of the 8 skills
- **THEN** the count is at least 3 and at most 6

### Requirement: README matrix lists every bundled skill

The "Pick the right skill for the job" matrix at the top of `packages/skills/README.md` SHALL contain one row for every entry in `SKILL_NAMES` (currently 8 entries). The row order SHALL follow the README's existing narrative grouping (heavier-write skills before read-only ones; exceptions/special cases last).

#### Scenario: Matrix row count matches SKILL_NAMES length
- **WHEN** a reader counts the data rows of the "Pick the right skill for the job" matrix in `packages/skills/README.md`
- **THEN** the row count equals 8 (the length of `SKILL_NAMES` in `packages/skills/src/index.ts`)
- **AND** every name listed in `SKILL_NAMES` appears in exactly one row

#### Scenario: `memon-migrate-fs` is in the matrix
- **WHEN** a reader scans the "Pick the right skill for the job" matrix
- **THEN** there is a row whose "Use" column contains the literal string `memon-migrate-fs`
- **AND** the row's "Want to…" column describes the migration use case
