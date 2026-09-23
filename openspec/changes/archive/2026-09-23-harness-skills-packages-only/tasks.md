## 1. Implementation

- [x] 1.1 Delete `.claude/skills/memon-components/` and `.claude/skills/memon-read-results/`; drop the `claudeSkill` output from `scripts/component-docs.ts`; `node scripts/component-docs.mjs --check` passes.
- [x] 1.2 Add the skills guard test and the `install-skills` harness-checkout refusal with a focused test.
- [x] 1.3 Update `AGENTS.md` skill-source wording.

## 2. Verification

- [x] 2.1 Skills tests, `install-skills` tests, component-docs check; confirm `git ls-files .claude/skills` lists only `openspec-*`.
