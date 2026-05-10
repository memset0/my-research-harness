## 1. Drop `disable-model-invocation: true` from 5 SKILL.md files

- [ ] 1.1 Remove the line `disable-model-invocation: true` from `packages/skills/memon-write-script/SKILL.md` frontmatter.
- [ ] 1.2 Remove the line `disable-model-invocation: true` from `packages/skills/memon-run-experiment/SKILL.md` frontmatter.
- [ ] 1.3 Remove the line `disable-model-invocation: true` from `packages/skills/memon-digest-journal/SKILL.md` frontmatter.
- [ ] 1.4 Remove the line `disable-model-invocation: true` from `packages/skills/memon-write-report/SKILL.md` frontmatter.
- [ ] 1.5 Remove the line `disable-model-invocation: true` from `packages/skills/memon-propose/SKILL.md` frontmatter.
- [ ] 1.6 Verify `packages/skills/memon-migrate-fs/SKILL.md` still has `disable-model-invocation: true`.
- [ ] 1.7 Verify `memon-append-journal` and `memon-append-warning` still have no such line (they never did).

## 2. README updates

- [ ] 2.1 Update the "Invocation policy" section in `packages/skills/README.md` to reflect the new state: 7 skills are model-invocable; only `memon-migrate-fs` is user-only. Reframe the rationale ("only the schema migration entry-point requires a human gate; other skills' internal flows are the safety mechanism").
- [ ] 2.2 In the "Pick the right skill for the job" matrix, update the Notes column for the 5 newly-flipped skills — drop the leading "User-invoked." phrase where it appears, since it no longer distinguishes them. Keep "Model-invocable." annotations where they help the reader (append-journal / append-warning have those today). For `memon-migrate-fs`, the Notes column SHOULD now name "User-invoked." explicitly because that's the differentiator.

## 3. Verification

- [ ] 3.1 `grep -l '^disable-model-invocation: true$' packages/skills/memon-*/SKILL.md` returns exactly one path (`memon-migrate-fs/SKILL.md`).
- [ ] 3.2 `grep -c '^disable-model-invocation' packages/skills/memon-*/SKILL.md` per file: 1 only for migrate-fs; 0 for all others.
- [ ] 3.3 README's "Invocation policy" section names the new 7/1 split and `memon-migrate-fs` as the lone exception.
- [ ] 3.4 README matrix's Notes column reflects the updated phrasing (no "User-invoked." prefix on the 5 affected rows).
- [ ] 3.5 `openspec validate skills-allow-model-invocation --type change` is clean.
- [ ] 3.6 `git diff packages/cli/` is empty (no runtime changes).
- [ ] 3.7 No SKILL.md body content (anything after the second `---` frontmatter delimiter) is modified — only the frontmatter line is removed.
