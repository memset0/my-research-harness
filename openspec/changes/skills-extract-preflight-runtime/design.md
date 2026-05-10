## Context

`memon install-skills` is the bundled-skills synchroniser. Its current contract (specced under `openspec/specs/memon-cli/spec.md` line 479+) treats only `memon-*/` directories as in-scope: it removes existing `memon-*/` dirs in each target, copies fresh ones from `@memon/skills`, and explicitly leaves any non-`memon-*` artifact alone. The strict-namespace rule is what makes the synchroniser safe to re-run against a project root that has unrelated content (e.g. `openspec-propose/` skills, hand-written notes).

To extract the duplicated preflight preamble from 7 SKILL.md files, the canonical text needs to live somewhere skills can reference by relative path. The simplest layout is a sibling of the `memon-*/` dirs at the root of each target: post-install, an agent reading `<target>/memon-foo/SKILL.md` resolves `../PREFLIGHT.md` to the sibling. For this to work, the synchroniser has to deposit `PREFLIGHT.md` as a sibling, which means widening its scope beyond `memon-*` namespacing.

This change is the runtime half of the extraction plan. It introduces the canonical doc and the sibling-copy mechanism, but **does not** change any SKILL.md content. Skills keep their inline preflight blocks; the new `PREFLIGHT.md` sits alongside but is unreferenced by skill bodies. The follow-up change (`skills-extract-preflight-skills`) flips the references over after the user has verified that `PREFLIGHT.md` actually lands in their target dirs.

## Goals / Non-Goals

**Goals:**
- `packages/skills/PREFLIGHT.md` exists as the single canonical source for the 4-branch preflight protocol.
- `memon install-skills` deposits `PREFLIGHT.md` as a sibling of the `memon-*/` dirs in every populated target dir.
- Test coverage for: default 3-target install, single-target via `--agent`, `--target` override (non-agent), `--dry-run`, stale-overwrite, non-namespaced-files-preserved.
- The user can verify the runtime change end-to-end by re-running `install-skills` against a scratch project root and inspecting the output.

**Non-Goals:**
- Editing SKILL.md content (deferred to A2).
- Updating `packages/skills/README.md` (deferred to A2 — the README's "all skills point to PREFLIGHT.md" claim only becomes true after A2).
- Modifying the `memon-skills` requirement that skills inline the preamble (deferred to A2).
- Adding a content-hash check / skip-if-unchanged optimization to install-skills (overwrite is fine; size is one small file).
- Versioning the PREFLIGHT.md schema (no protocol-version field; PREFLIGHT.md is a soft contract).

## Decisions

### Decision 1: PREFLIGHT.md is a sibling of `memon-*/`, not inside any skill dir

`PREFLIGHT.md` lives at `packages/skills/PREFLIGHT.md` in source and at `<target>/PREFLIGHT.md` post-install. Sibling placement (vs. inside-each-skill) avoids re-introducing the per-skill duplication this change is removing.

Alternatives considered:
- *Inside each skill dir* (`memon-foo/PREFLIGHT.md`): duplicates 8× on disk after install. Defeats the point.
- *In a sub-directory* (`packages/skills/_shared/PREFLIGHT.md`): adds a special-case dir name install-skills has to NOT treat as a `memon-*` skill. Adding one named exception (`PREFLIGHT.md`) is less invasive than a `_shared/` exception.

### Decision 2: Synchroniser scope extends to `PREFLIGHT.md` by name only

`memon install-skills` copies `<source>/PREFLIGHT.md` → `<target>/PREFLIGHT.md` as a named exception. It does NOT copy any other non-`memon-*` source artifact (no README, no `package.json`, no `dist/`, etc.). Future siblings would each need explicit handling.

Rationale: keeps the synchroniser's contract narrow. Promiscuously copying any non-`memon-*` artifact would make the source dir's presence semantics unpredictable — what if a developer drops a tmp file in `packages/skills/` while iterating?

### Decision 3: Overwrite always; no skip-if-unchanged

On every non-`--dry-run` invocation, `PREFLIGHT.md` is unconditionally written from source (even if a target already has a byte-identical copy). This matches the existing per-skill replacement behavior (each `memon-*/` is removed and re-copied as a unit, no incremental sync).

Skip-if-unchanged would add a hash check and an exit-condition branch, with no observable benefit for a single small file.

### Decision 4: Stale `PREFLIGHT.md` in target gets overwritten, not deleted

If a target dir's `PREFLIGHT.md` already exists (e.g. from a prior install), it gets overwritten on the next install. It is NOT removed under the existing "remove `memon-*/` dirs not in source" rule, because PREFLIGHT.md is a named-file artifact, not a namespaced dir.

This means: if a future change *removes* `PREFLIGHT.md` from source, an installed target's stale `PREFLIGHT.md` will linger until the user manually deletes it. That's an acceptable trade-off — the alternative ("remove if not in source") would require generalising the synchroniser's removal rule from "namespaced dir prefix" to "anything we ever copied", which is a much bigger contract change.

### Decision 5: `installed[]` JSON array includes the literal `"PREFLIGHT.md"` per target

When the synchroniser writes `PREFLIGHT.md` to a target, `targets[i].installed` (in the `--format json` output) includes the string `"PREFLIGHT.md"` alongside the skill-dir basenames. In `--dry-run` mode, the string still appears in `installed[]` (the no-write contract is preserved) so callers see what would be written.

The existing `installed[]` semantics is "skill dir basenames"; widening it to also include the sibling file's name is the simplest extension. An alternative — adding a separate `siblings[]` field — would require every JSON consumer to opt in to the new shape. Including in `installed[]` is a smaller change for downstream readers.

### Decision 6: PREFLIGHT.md content sourced verbatim from `memon-write-script/SKILL.md`

The new `packages/skills/PREFLIGHT.md` body is extracted verbatim from `packages/skills/memon-write-script/SKILL.md` lines 17–42, with these adjustments:
- Convert from `## Preflight — FS convention version` (a heading that lives inside a SKILL) to `# Preflight — FS convention version` (top-level for a standalone doc).
- Add a one-paragraph intro explaining what this doc is for and which skills consult it.
- Keep the existing parenthetical naming `memon-migrate-fs` as exempt; promote it from a parenthetical to a full sentence at the bottom of the doc.

`memon-write-script` is chosen as the source because it's the longest-lived copy; the wording has had the most review. Other skills' copies are byte-equal to it (verified during the broader review that motivated this change), so the choice doesn't lose information.

## Risks / Trade-offs

- **Risk**: A user who upgrades memon but doesn't re-run `install-skills` won't get `PREFLIGHT.md` in their target dirs. → **Mitigation**: This is the same behavior as adding a new skill — the user has always needed to re-run `install-skills` to pull updates. Release notes should call this out, but no special migration code is needed. A2 (the skills update) will surface a missing-`PREFLIGHT.md` symptom anyway when the SKILL pointers can't resolve.
- **Risk**: `installed[]` adds a new string `"PREFLIGHT.md"` that downstream tooling (e.g. ad-hoc scripts grepping for skill names) might mishandle. → **Mitigation**: known consumers in this repo are the test fixtures and the human-readable trailer. Both are updated in this change. External consumers (none known) would need to handle the extra string; the JSON shape itself is otherwise unchanged.
- **Trade-off**: Decision 4 leaves stale `PREFLIGHT.md` in targets if it's ever removed from source. Acceptable; a future cleanup change can address.
- **Trade-off**: A1 doesn't add value standalone — `PREFLIGHT.md` lands in target dirs but isn't referenced by any SKILL.md. The value materializes once A2 ships. The split itself is the value (verification gate).

## Migration Plan

This change is purely additive. No on-disk or wire migration required. After apply:

1. User upgrades the memon binary (or pulls source).
2. User runs `memon install-skills --project-root <p>` against any project root where they want the new doc.
3. Target dirs gain `PREFLIGHT.md` as a sibling of the `memon-*/` dirs.
4. SKILL.md content is unchanged; agents reading them see the existing inline preflight blocks.

User-verification gate (mandatory before A2 ships, per the project's split-runtime-from-skills rule):

```sh
pnpm --filter @memon/cli build
memon install-skills --project-root /tmp/preflight-runtime-smoke --agent claude --format json | jq '.targets[0].installed'
ls -la /tmp/preflight-runtime-smoke/.claude/skills/PREFLIGHT.md
diff /tmp/preflight-runtime-smoke/.claude/skills/PREFLIGHT.md packages/skills/PREFLIGHT.md
```

All four lines should succeed. The `installed[]` JSON should contain `"PREFLIGHT.md"`; the file should exist; bytes should match.

Rollback: revert this change. Existing `PREFLIGHT.md` files in users' target dirs would remain (orphan), but cause no harm — no SKILL.md references them yet. A subsequent cleanup install-skills run would not delete them (per Decision 4); the user can manually `rm` if desired.

## Open Questions

None. The split / placement / naming decisions above are all deterministic given the constraints. A2's design will need to decide what the in-skill pointer text looks like, but that's deferred and doesn't constrain A1.
