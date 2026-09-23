## Why

The harness repository's own `.claude/skills/` tracks two memon skills, `memon-components` and `memon-read-results`, although bundled skills belong in `packages/skills/` and reach research projects only through `memon install-skills`. `memon-read-results` was first written straight into `.claude/skills/` and is now a stale copy that differs from the package; `memon-components` is a byte mirror that `scripts/component-docs.ts` keeps writing because two `memon-wiki-skill` requirements ask for harness-repo copies (the `memon-wiki` copy they require never existed). Agents developing the harness see stale or duplicated project-facing skills, and nothing stops the next mirror.

## What Changes

- Remove `.claude/skills/memon-components/` and `.claude/skills/memon-read-results/` from the harness repository.
- `scripts/component-docs.ts` stops generating the `.claude/skills/memon-components/SKILL.md` copy.
- Drop the harness-repo copy requirements from `memon-wiki-skill`; bundled skills live only under `packages/skills/`.
- Guards: a skills test fails when the harness repository's `.claude/skills`, `.codex/skills`, or `.opencode/skills` holds a `memon-*` skill or `PREFLIGHT.md`; `memon install-skills` refuses (exit 2) a project root that is the memon harness checkout itself.
- `AGENTS.md` names `packages/skills/*/SKILL.md` as the skill sources.
- CLI change -> MINOR release together with the in-flight wiki changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-wiki-skill`: no harness-repo copies of `memon-wiki` or `memon-components`.
- `memon-skills`: bundled skills live only in `packages/skills/` and never in the harness repository's agent skill directories.
- `memon-cli`: `install-skills` refuses the harness checkout as a project root.

## Impact

- Deleted: `.claude/skills/memon-components/SKILL.md`, `.claude/skills/memon-read-results/SKILL.md`.
- `scripts/component-docs.ts`, `packages/skills/src/*.test.ts`, `packages/cli/src/commands/install-skills.ts` (+ test), `AGENTS.md`.
- Harness-development skills (`openspec-*`) under `.claude/skills/` are unaffected.
