## Context

`git log` shows `.claude/skills/memon-read-results/SKILL.md` added by 69414bf (feature commit wrote the skill into the agent directory; the package copy came later and diverged) and `.claude/skills/memon-components/SKILL.md` added by d7a2b1f as the fifth generated output of `scripts/component-docs.ts` (`claudeSkill`, written "if present"), following `memon-wiki-skill` requirements that ask for harness-repo copies of `memon-wiki` and `memon-components`. No `.claude/skills/memon-wiki/` exists.

## Decisions

1. Delete both tracked copies; the package trees are the only sources.
2. Remove the `claudeSkill` output from `component-docs.ts` (write and `--check`).
3. Guard test in `packages/skills` (runs in the skills test suite): for each of `<repo>/.claude/skills`, `.codex/skills`, `.opencode/skills`, fail on any `memon-*` entry or `PREFLIGHT.md`.
4. `install-skills` refuses a project root whose `packages/skills/package.json` declares `"name": "@memon/skills"` with `BAD_REQUEST` (exit 2) naming the checkout, before writing anything. This covers both a direct run and `memon update --skills-root <harness checkout>` (update reports the failed root as it does for any install failure).
5. Mounted-mode wiki work from the harness directory keeps working for operators who install memon skills at user level or run agents from the project; the skill text is unchanged.

## Risks

- An operator who relied on the harness-repo copy to run `memon-components` guidance from the harness directory loses it; the project installs carry the current skill.
