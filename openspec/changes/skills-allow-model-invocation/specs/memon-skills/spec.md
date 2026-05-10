## MODIFIED Requirements

### Requirement: Skill invocation policy split by risk tier

The bundled skills under `packages/skills/memon-*/` SHALL declare invocation control via the `disable-model-invocation` frontmatter field according to risk tier:

- Skills that perform **irreversible-without-git-revert filesystem schema mutations** (write across multiple version steps, create git commits as part of normal operation) SHALL set `disable-model-invocation: true` (user-invoked only). At archive time the sole member of this tier is: `memon-migrate-fs`.
- All other bundled skills MAY omit the field (model-invocable). At archive time these are: `memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`, `memon-append-journal`, `memon-append-warning`.

The intent is: only the schema migration entry-point requires a human gate at the invocation layer, because its mutations span multiple files in lockstep + create git commits and a wrong autonomous invocation would be expensive to unwind. All other skills carry their own internal confirmation flows (user-facing prompts in Chinese before any non-trivial write, mtime-locked conflict handling, recovery loops with user surface points) — those internal flows are the safety mechanism, and the frontmatter flag is not redundantly required.

`memon-drive` (the conversational orchestrator skill) MAY autonomously invoke any of the seven model-invocable skills above as sub-tools, so a per-sub-skill frontmatter gate would defeat the orchestrator's usefulness. The user has explicitly accepted this trade-off.

#### Scenario: Migrate-fs is user-invoked
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-migrate-fs/SKILL.md`
- **THEN** it contains the line `disable-model-invocation: true`

#### Scenario: Append-journal allows model invocation
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-append-journal/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is `false`)

#### Scenario: Append-warning allows model invocation
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-append-warning/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is `false`)

#### Scenario: Heavy-but-non-migration skills allow model invocation
- **WHEN** a reader inspects the frontmatter of any of `memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`
- **THEN** no `disable-model-invocation: true` line is present

#### Scenario: Exactly one skill remains user-only
- **WHEN** a reader runs `grep -l '^disable-model-invocation: true$' packages/skills/memon-*/SKILL.md`
- **THEN** the output contains exactly one path: `packages/skills/memon-migrate-fs/SKILL.md`
