## Why

Across the 8 bundled skill files, the section that gathers "things this skill must NOT do" goes by three different names:

- 4 skills use `## Anti-patterns`: `memon-write-script`, `memon-run-experiment`, `memon-append-warning`, `memon-migrate-fs`.
- 2 skills use `## Constraints` with mixed ✅ / ❌ bullets: `memon-digest-journal`, `memon-write-report`.
- 1 skill uses `## Heuristics` (positive judgment guidance, not anti-patterns): `memon-propose`.
- 1 skill (`memon-append-journal`) has no dedicated section; the `## When NOT to use` section already covers it.

A reader scanning multiple skills sees inconsistent header naming for what is essentially the same content shape. Worse, the `## Constraints` sections in `memon-digest-journal` and `memon-write-report` blend two distinct concerns:

- ✅ bullets that re-state workflow imperatives ("INVOCATION_TIME captured at start", "show drafts inline") — already covered in the workflow body as bold directives.
- ❌ bullets that are genuine anti-patterns ("Never advance `last_digest_at` past `INVOCATION_TIME`", "Never modify experiment READMEs") — belong with the other skills' Anti-patterns content.

This change unifies the naming for the ❌-style content under `## Anti-patterns`.

## What Changes

- Rename `## Constraints` → `## Anti-patterns` in `memon-digest-journal/SKILL.md`. Drop the 5 ✅ bullets — every one is already an imperative explicitly stated in the workflow body (see design.md Decision 2 for the per-bullet mapping). Keep the 6 ❌ bullets.
- Rename `## Constraints` → `## Anti-patterns` in `memon-write-report/SKILL.md`. Drop the 3 ✅ bullets — same reason. Keep the 4 ❌ bullets.
- `memon-propose/SKILL.md`'s `## Heuristics` is **NOT** renamed. Its content is positive judgment guidance ("Prefer hypotheses with status OPEN or PARTIAL", "Don't be afraid to propose negative results"), categorically different from anti-patterns. Heuristics stays.
- `memon-append-journal/SKILL.md` is **NOT** modified. Its `## When NOT to use` section already covers the anti-patterns role; there's no `## Constraints` or `## Heuristics` to rename.
- The 4 skills that already use `## Anti-patterns` are **NOT** modified.

Acceptance gate (verifiable after apply):
- `grep -l '^## Constraints$' packages/skills/memon-*/SKILL.md` returns nothing.
- `grep -l '^## Anti-patterns$' packages/skills/memon-*/SKILL.md` returns 6 paths (4 existing + 2 renamed).
- `grep -l '^## Heuristics$' packages/skills/memon-*/SKILL.md` returns 1 path (`memon-propose` — preserved intentionally).
- The Anti-patterns section in each of the 6 skills appears immediately before `## Errors` (where Errors exists) or at the bottom of the workflow body (where it doesn't).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: ADD a requirement that anti-pattern content is collected under `## Anti-patterns` (not `## Constraints`), positioned just before `## Errors` where the latter exists. Note explicitly that `## Heuristics` is a different and preserved section name for positive judgment guidance.

## Impact

- **Code**: none.
- **Docs / skill bodies**: 2 SKILL.md files (`memon-digest-journal`, `memon-write-report`) lose their `## Constraints` heading + 5 + 3 ✅ bullets, and gain `## Anti-patterns` headings with the existing ❌ bullets preserved.
- **Specs**: delta on `memon-skills` (ADD a requirement on section naming + position).
- **No runtime changes**.
- **Migration risk**: zero. Pure heading rename + bullet pruning. The deleted ✅ bullets re-state workflow imperatives that are already in the doc body; agents lose no information.
