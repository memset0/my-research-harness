## Why

The runtime half (`skills-extract-preflight-runtime`, commit e10e458) already shipped: `packages/skills/PREFLIGHT.md` exists as the canonical 4-branch preflight doc, and `memon install-skills` deposits it as a sibling of the `memon-*/` skill dirs in every populated target. Verified end-to-end: byte-equal copies land in `<target>/PREFLIGHT.md`; `targets[i].installed[]` includes `"PREFLIGHT.md"`.

This change is the **skills half**: replace the duplicated inline `## Preflight — FS convention version` block in each of the 7 spec-mutating SKILL.md files with a ≤5-line pointer that references `../PREFLIGHT.md` (the now-deposited sibling). After this lands and a fresh `install-skills` run propagates the new SKILL.md content, the duplication is gone — each skill's preflight section is a 3-line pointer, and the canonical 4-branch table lives in one place.

## What Changes

- Replace the `## Preflight — FS convention version` section in each of the 7 affected SKILL.md files with a 3-prose-line pointer:
  - `memon-write-script/SKILL.md` (current section: lines 17–42)
  - `memon-run-experiment/SKILL.md` (current: lines 14–40)
  - `memon-append-journal/SKILL.md` (current: lines 22–48)
  - `memon-append-warning/SKILL.md` (current: lines 30–50)
  - `memon-digest-journal/SKILL.md` (current: lines 37–63)
  - `memon-write-report/SKILL.md` (current: lines 28–54)
  - `memon-propose/SKILL.md` (current: lines 44–70)

  The pointer body is byte-equal across all 7 (a property the spec scenario asserts), with this exact text:

  ```
  ## Preflight — FS convention version

  Run `memon fs-version check --project-root . --format json` as the first
  step. If `status !== "match"`, STOP and follow the branch protocol in
  `../PREFLIGHT.md` (covers `match` / `behind` / `uninitialised` / `ahead`).
  ```

- `memon-migrate-fs/SKILL.md` is **NOT** modified — it carries its own self-described exemption note and never had an inline preflight section.
- Add one bullet to `packages/skills/README.md`'s `## Conventions baked into all skills` list: `- **Preflight protocol** lives in PREFLIGHT.md (same dir). All spec-mutating skills point to it instead of duplicating the branch table.`
- **BREAKING (spec-level)**: Modify the `memon-skills` `Spec-mutating skills SHALL preflight-check the FS convention version` requirement so the preamble in skill bodies is the condensed pointer, not the full 4-branch table. The 4-branch protocol itself does not change — it just lives in PREFLIGHT.md now.

Out of scope:
- The `memon fs-version check` CLI behavior, exit codes, JSON shape, or status enum — unchanged.
- `memon-migrate-fs` skill — unchanged.
- `install-skills.ts` runtime — already shipped in A1.

Acceptance gate (user-verifiable after apply):
- Each of the 7 modified SKILL.md files has a `## Preflight — FS convention version` section ≤5 prose lines.
- The body of that section is byte-equal across all 7 files (`md5sum` of each file's preflight section matches).
- The body references `../PREFLIGHT.md` literally.
- `memon install-skills --project-root /tmp/preflight-skills-smoke --agent claude` then `cat /tmp/preflight-skills-smoke/.claude/skills/memon-run-experiment/SKILL.md | head -10` shows the new pointer block (not the old 22-line table).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: MODIFY the existing `Spec-mutating skills SHALL preflight-check the FS convention version` requirement so the inline preamble is the condensed pointer (≤5 lines, references `../PREFLIGHT.md`, names the four status values) instead of the full 4-branch table.

## Impact

- **Code**: none.
- **Docs / skill bodies**: 7 `packages/skills/memon-*/SKILL.md` files (same delete + re-insert in each); `packages/skills/README.md` (one new bullet).
- **Specs**: delta on `memon-skills` (modify the preflight-preamble requirement).
- **Tests**: no test changes required (the install-skills test suite shipped in A1 already verifies PREFLIGHT.md deposit; A2's SKILL.md changes are pure content and don't add new runtime behavior to test).
- **Migration risk**: low. After the change ships, an installed `<target>/memon-foo/SKILL.md` will reference `../PREFLIGHT.md` as a sibling, which exists thanks to A1. Users who upgraded memon to a release containing A2 but did NOT re-run `install-skills` would see the OLD inline preflight blocks in their installed SKILL.md files — that's fine, the old behavior still works correctly. The new layout takes effect on next re-install.
- **Downstream agent behavior**: agents loading a SKILL.md after the next re-install see a 3-line pointer instead of a 22-line table. They still execute `memon fs-version check`, still bail on non-`match`, still know the four status values (the pointer names them). For the per-status user-facing dialogue text (e.g. the exact Chinese-language recommendation), they consult `../PREFLIGHT.md`.
