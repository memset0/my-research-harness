## ADDED Requirements

### Requirement: Bundled skills live only in `packages/skills`

Every bundled `memon-*` skill and the shared `PREFLIGHT.md` SHALL have exactly one source, under `packages/skills/`, and SHALL reach research projects only through `memon install-skills`. The harness repository's agent skill directories (`.claude/skills`, `.codex/skills`, `.opencode/skills`) SHALL NOT contain any `memon-*` skill or `PREFLIGHT.md`, and generators SHALL NOT write copies there. The skills test suite SHALL fail when such an entry exists.

#### Scenario: Stray mirror
- **GIVEN** `.claude/skills/memon-components/SKILL.md` exists in the harness repository
- **WHEN** the skills tests run
- **THEN** they fail naming that path

#### Scenario: Harness development skills stay
- **WHEN** `.claude/skills/` holds only `openspec-*` skills
- **THEN** the guard passes
