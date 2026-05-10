## 1. Rename + prune in `memon-digest-journal/SKILL.md`

- [ ] 1.1 Locate the existing `## Constraints` section.
- [ ] 1.2 Replace the heading with `## Anti-patterns`.
- [ ] 1.3 Delete all 5 ✅ bullets:
  - "✅ `INVOCATION_TIME` and `OBSERVED_LAST_DIGEST_AT` are captured at start..."
  - "✅ Each digest covers a strict, non-overlapping interval..."
  - "✅ Same date → append to the existing date's file. New date → new file..."
  - "✅ Doctor checks happen before the digest body is finalized..."
  - "✅ Race-safe via re-read of `last_digest_at`..."
- [ ] 1.4 Keep all 6 ❌ bullets verbatim. Their phrasing already matches the convention.
- [ ] 1.5 Verify `## Anti-patterns` now sits immediately before `## Errors` in the file.

## 2. Rename + prune in `memon-write-report/SKILL.md`

- [ ] 2.1 Locate the existing `## Constraints` section.
- [ ] 2.2 Replace the heading with `## Anti-patterns`.
- [ ] 2.3 Delete all 3 ✅ bullets:
  - "✅ Always record the `selector` verbatim..."
  - "✅ Show drafts inline before any file write..."
  - "✅ Numbering is global across `docs/reports/`..."
- [ ] 2.4 Keep all 4 ❌ bullets verbatim.
- [ ] 2.5 Verify `## Anti-patterns` now sits immediately before `## Errors` in the file.

## 3. Verify other skills are untouched

- [ ] 3.1 `git diff packages/skills/memon-write-script/SKILL.md` is empty.
- [ ] 3.2 `git diff packages/skills/memon-run-experiment/SKILL.md` is empty.
- [ ] 3.3 `git diff packages/skills/memon-append-warning/SKILL.md` is empty.
- [ ] 3.4 `git diff packages/skills/memon-migrate-fs/SKILL.md` is empty.
- [ ] 3.5 `git diff packages/skills/memon-append-journal/SKILL.md` is empty.
- [ ] 3.6 `git diff packages/skills/memon-propose/SKILL.md` is empty.
- [ ] 3.7 `git diff packages/cli/` is empty (no runtime changes).

## 4. Verification

- [ ] 4.1 `grep -l '^## Constraints$' packages/skills/memon-*/SKILL.md | wc -l` — output `0`.
- [ ] 4.2 `grep -l '^## Anti-patterns$' packages/skills/memon-*/SKILL.md | wc -l` — output `6`.
- [ ] 4.3 `grep -l '^## Heuristics$' packages/skills/memon-*/SKILL.md | wc -l` — output `1` (`memon-propose`).
- [ ] 4.4 For each skill that has both `## Anti-patterns` and `## Errors`, the Anti-patterns line number is smaller than the Errors line number.
- [ ] 4.5 `openspec validate skills-section-naming-unify --type change` — clean.
