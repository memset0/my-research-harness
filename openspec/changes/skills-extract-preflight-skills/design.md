## Context

A1 (`skills-extract-preflight-runtime`, commit e10e458) shipped the canonical `packages/skills/PREFLIGHT.md` and extended `memon install-skills` to deposit it as a sibling of the `memon-*/` skill dirs in each populated target. SKILL.md content was deliberately not touched in A1 — the verification gate was "PREFLIGHT.md materialises in target dirs", which is now confirmed.

This change flips the references: the 7 spec-mutating SKILL.md files lose their inline 22-line `## Preflight — FS convention version` blocks and gain a 3-line pointer to `../PREFLIGHT.md` instead. The pointer body is identical across all 7 files (a property the new spec scenario will assert), so future drift is mechanically detectable.

## Goals / Non-Goals

**Goals:**
- Each of the 7 spec-mutating SKILL.md files contains exactly one `## Preflight — FS convention version` section consisting of a 3-prose-line pointer body (heading + blank line + 3 prose lines = 5 source lines).
- The pointer body is byte-equal across all 7 files (verified by hashing each section).
- The pointer:
  1. Imperatively invokes `memon fs-version check --project-root . --format json`.
  2. Instructs STOP on any non-`match` status.
  3. References `../PREFLIGHT.md` by that exact relative path.
  4. Names the four status values (`match`, `behind`, `uninitialised`, `ahead`) in a closed-enum form.
- `packages/skills/README.md`'s "Conventions baked into all skills" list gains one bullet pointing readers at the new PREFLIGHT.md location.
- `memon install-skills` produces installed SKILL.md trees where every spec-mutating skill points to a `../PREFLIGHT.md` that exists as its sibling.

**Non-Goals:**
- Updating `memon-migrate-fs/SKILL.md` (it carries its own exemption note; never had an inline preflight section).
- Changing the per-status user-facing dialogue wording (lives in PREFLIGHT.md now, but the wording itself is unchanged from what was inline before).
- Adding a regression test that scans each SKILL.md for the literal pointer text (deferred — the spec scenario plus the manual md5sum check on apply is enough; if drift is observed, a future change can add an automated check).
- Touching install-skills.ts or its tests (already done in A1).

## Decisions

### Decision 1: Pointer wording (3 prose lines, fixed)

The pointer body, byte-equal across all 7 SKILL.md files:

```
## Preflight — FS convention version

Run `memon fs-version check --project-root . --format json` as the first
step. If `status !== "match"`, STOP and follow the branch protocol in
`../PREFLIGHT.md` (covers `match` / `behind` / `uninitialised` / `ahead`).
```

Rationale:
- **Imperative-first**: The first sentence is the action the agent must take. Agents that follow imperatives elsewhere in the body will follow this one.
- **Names the closed enum**: The agent knows the four expected status values without reading PREFLIGHT.md, so it can branch correctly even before consulting the canonical doc for wording.
- **Relative path is literal**: `../PREFLIGHT.md` is exactly what an agent should `cat` from inside `<target>/memon-foo/SKILL.md`.
- **Minimal**: 3 prose lines after the heading. No fluff.

### Decision 2: Byte-equality across the 7 files is enforced by spec, verified by hashing

The spec scenario "Pointer text is consistent across the seven skills" mandates that the body of the `## Preflight — FS convention version` section be byte-equal across all 7 affected files. Apply-time verification: extract the section from each file, hash, compare. All hashes must be identical.

This is the same verification approach A1 used for "PREFLIGHT.md content sourced verbatim from `memon-write-script/SKILL.md`": a single content fingerprint, compared.

Alternative (not adopted): a CI test that scans each SKILL.md for the literal pointer template. Deferred. Adds test fixture overhead for a constraint that's verifiable manually with one md5sum command.

### Decision 3: README bullet wording

Add to `packages/skills/README.md`'s `## Conventions baked into all skills` list:

```
- **Preflight protocol** lives in `PREFLIGHT.md` (same dir). All
  spec-mutating skills point to it instead of duplicating the branch
  table.
```

Position: alongside the existing bullets ("All `memon ...` calls take `--project-root` explicitly", "mtime optimistic locking", etc.). Insert as the second bullet — after the `--project-root` rule (most fundamental), before the mtime-locking rule.

### Decision 4: `memon-migrate-fs/SKILL.md` is untouched

`memon-migrate-fs` never had an inline preflight section — it has a self-described exemption note ("This skill is exempt from the standard FS-version preflight"). That note stays as-is. The skill is still listed in `packages/skills/PREFLIGHT.md`'s migration-runtime-exemption paragraph; no further action needed in this skill.

## Risks / Trade-offs

- **Risk**: A user who upgrades memon to a release containing A2 but does NOT re-run `install-skills` keeps the old inline blocks in their installed `.claude/skills/`. → **Mitigation**: This is the same as for any skill content update. Their old SKILL.md still works correctly (full inline preflight). Re-installing picks up the new pointer-based version.
- **Risk**: An agent reading a pointer SKILL.md but loading a stale `../PREFLIGHT.md` (e.g. from before A1 shipped). → **Mitigation**: Can't happen — A1 is shipped + verified, and re-installs always overwrite PREFLIGHT.md from source. If an agent reads a SKILL.md with the new pointer, the install that put it there also put the corresponding PREFLIGHT.md.
- **Risk**: An agent reads the pointer, doesn't consult PREFLIGHT.md, and falls back to its training-data understanding of the preflight protocol. → **Mitigation**: The pointer literally lists the four status values, so the agent has the closed-enum information without needing to read PREFLIGHT.md. PREFLIGHT.md only adds the per-status user-facing dialogue.
- **Trade-off**: After this lands, a reader inspecting just one SKILL.md sees a 3-line pointer instead of a 22-line self-contained table. That's exactly the intent (deduplicate), but it does mean readers have to consult one more file when they want the full per-branch wording. Acceptable — most reads of preflight content happen during error-state handling (when the agent has hit a non-`match` status and needs to know what to say to the user), at which point loading one more file is fine.

## Migration Plan

After apply:

1. The 7 SKILL.md files in source contain the new pointer block.
2. `packages/skills/README.md` has the new bullet.
3. `openspec/specs/memon-skills/spec.md` (post-archive) reflects the modified preflight-preamble requirement.
4. Users who run `memon install-skills` against any project root after pulling this change get the new pointer-based SKILL.md content in their target dirs. PREFLIGHT.md was already there from A1; the relative `../PREFLIGHT.md` reference resolves correctly.

User-verification gate:

```sh
# After this change is applied locally:
md5sum <(awk '/^## Preflight — FS convention version$/,/^## /{if($0 ~ /^## / && $0 !~ /^## Preflight/) exit; print}' packages/skills/memon-write-script/SKILL.md) \
       <(awk '/^## Preflight — FS convention version$/,/^## /{if($0 ~ /^## / && $0 !~ /^## Preflight/) exit; print}' packages/skills/memon-run-experiment/SKILL.md) \
       <(awk '/^## Preflight — FS convention version$/,/^## /{if($0 ~ /^## / && $0 !~ /^## Preflight/) exit; print}' packages/skills/memon-append-journal/SKILL.md) \
       <(awk '/^## Preflight — FS convention version$/,/^## /{if($0 ~ /^## / && $0 !~ /^## Preflight/) exit; print}' packages/skills/memon-append-warning/SKILL.md) \
       <(awk '/^## Preflight — FS convention version$/,/^## /{if($0 ~ /^## / && $0 !~ /^## Preflight/) exit; print}' packages/skills/memon-digest-journal/SKILL.md) \
       <(awk '/^## Preflight — FS convention version$/,/^## /{if($0 ~ /^## / && $0 !~ /^## Preflight/) exit; print}' packages/skills/memon-write-report/SKILL.md) \
       <(awk '/^## Preflight — FS convention version$/,/^## /{if($0 ~ /^## / && $0 !~ /^## Preflight/) exit; print}' packages/skills/memon-propose/SKILL.md)
# Expected: all seven hashes are identical.

# After re-install:
pnpm --filter @memon/cli build
node packages/cli/dist/index.js install-skills --project-root /tmp/preflight-skills-smoke --agent claude
head -10 /tmp/preflight-skills-smoke/.claude/skills/memon-run-experiment/SKILL.md
# Expected: the pointer block is at the top, references ../PREFLIGHT.md.
```

Rollback: revert this change. SKILL.md files restore to inline-preflight form. PREFLIGHT.md sibling stays in target dirs (orphan, harmless).

## Open Questions

None — all decisions are deterministic given A1's verified runtime contract.
