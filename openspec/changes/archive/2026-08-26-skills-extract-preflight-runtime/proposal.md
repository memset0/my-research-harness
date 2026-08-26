## Why

The `Preflight — FS convention version` block is duplicated nearly verbatim across **7 of the 8** bundled skill files in `packages/skills/`: each carries the same ~22-line 4-branch table (`match` / `behind` / `uninitialised` / `ahead`). The plan is to extract the table into a single canonical doc and have each skill point to it via relative path. This is the **runtime half** of that plan: ship the canonical doc + extend `memon install-skills` to deposit it as a sibling of the `memon-*/` dirs in each target. **The SKILL.md files themselves are not touched in this change** — they keep their inline preflight blocks. Once this lands and the user re-runs `install-skills` to confirm `PREFLIGHT.md` materialises in their target dirs, the follow-up change (`skills-extract-preflight-skills`) will replace the inline blocks with pointers.

Splitting runtime + skills is a project rule (`feedback_split_runtime_then_skills`): runtime ships first, user-verifies, then skills. Past co-changes have shipped skill instructions describing runtime behavior the runtime didn't actually deliver — splitting prevents that drift.

## What Changes

- Add `packages/skills/PREFLIGHT.md` — the canonical 4-branch preflight protocol doc. Body extracted verbatim from the existing inline section in `memon-write-script/SKILL.md` (the longest-lived copy), with one extra paragraph naming the `memon-migrate-fs` exemption.
- Extend `memon install-skills` (the CLI) to copy `PREFLIGHT.md` from the bundled source to each populated target dir, as a **sibling** of the `memon-*/` skill dirs. The file is overwritten on every non-`--dry-run` invocation. In `--dry-run` mode it appears in `installed[]` without being written to disk.
- Add test cases to `packages/cli/src/commands/install-skills.test.ts` covering: default 3-target install, `--agent claude` single-target, `--dry-run`, stale-overwrite, non-namespaced-files-preserved.
- Update `packages/cli/src/commands/install-skills.ts` to handle `PREFLIGHT.md` as a sibling deposit (not a `memon-*/` dir).

Out of scope (deferred to follow-up `skills-extract-preflight-skills`):
- Modifying any of the 7 spec-mutating SKILL.md files. They keep their inline preflight blocks for now.
- Updating `packages/skills/README.md`'s "Conventions" list.
- Modifying the `memon-skills` requirement that mandates the inline preamble — that requirement is currently satisfied by inline blocks; A2 is what flips it to "points to PREFLIGHT.md".

Acceptance gate (user-verifiable after apply):
- `pnpm --filter @memon/cli build && memon install-skills --project-root /tmp/preflight-runtime-smoke --agent claude` → `/tmp/preflight-runtime-smoke/.claude/skills/PREFLIGHT.md` exists with bytes equal to `packages/skills/PREFLIGHT.md`.
- `memon install-skills --project-root /tmp/foo --agent claude --dry-run --format json` → JSON output's `targets[0].installed` includes `"PREFLIGHT.md"`, but the file is not on disk.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: ADDED requirement that `packages/skills/PREFLIGHT.md` exists in the bundled source as the canonical 4-branch preflight doc. The existing requirement that skill bodies inline the preflight preamble is **not modified in this change**; it stays as-is and is satisfied by the existing inline blocks. (A2 will modify that requirement.)
- `memon-cli`: MODIFIED `memon install-skills` synchroniser requirement to also deposit `PREFLIGHT.md` as a sibling of the `memon-*/` dirs in each populated target. JSON output's `targets[].installed` now includes `"PREFLIGHT.md"` when the file was deposited.

## Impact

- **Code**: `packages/cli/src/commands/install-skills.ts` (5–10 LOC additive — copy one extra file per target).
- **Tests**: `packages/cli/src/commands/install-skills.test.ts` (5 new test cases).
- **New file**: `packages/skills/PREFLIGHT.md`.
- **Specs**: delta on `memon-cli` (install-skills extension); delta on `memon-skills` (PREFLIGHT.md exists).
- **No SKILL.md edits.** Files in `packages/skills/memon-*/` are NOT touched.
- **No README.md edits.**
- **Downstream agent behavior**: unchanged. SKILL.md files still have inline preflight blocks; agents reading them behave exactly as before.
- **Migration risk**: ~zero. The runtime change is additive (one extra file copy per install). If `install-skills` previously deposited K skill dirs per target, it now deposits K skill dirs + 1 file per target. Existing `installed[]` consumers that only iterated skill dir names see one extra string `"PREFLIGHT.md"`.

The verification gate (between A1 and A2) is the user manually re-running `install-skills` against a scratch dir and confirming the file lands. Once the user signs off, A2 ships and SKILL.md files start referencing the now-deposited `../PREFLIGHT.md`.
