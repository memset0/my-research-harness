## Context

memon's on-disk schema is at `FS_CONVENTION_VERSION = 1`. The constant exists precisely to gate breaking changes like this one — when the version bumps, every existing project root has a `.memon/version.json` that says `1`, and the migrate-fs runtime is responsible for guiding it forward via the version-pair guide at `packages/core/migrations/v<N>-to-v<N+1>.md`.

Two specs already pin the runtime's expectations:

- `fs-migration-runtime/spec.md`: defines detection at install + skill entry, the user-confirmation gate, the working-tree-clean precondition, the per-step protocol with fixed commit messages, and the "missing guide aborts" rule.
- `fs-migration-guide-authoring/spec.md`: defines the seven-section structure of every guide, the verification fail-closed rule, the fixed commit-message format `chore(memon): migrate FS convention v<N> -> v<N+1>`, and the four canonical edge cases.

This change is the first real exercise of that machinery (the `v1` → `v2` step is the first non-trivial guide). It SHALL author the guide to the meta-spec, not improvise.

The chokepoints in code that compute the canonical paths today:

- `packages/core/src/journal/append.ts` and `parse.ts` — append/parse the file, take a path argument from the caller.
- `packages/core/src/hypotheses/parse.ts` — same pattern; path comes from the caller.
- `apps/web/lib/runtime.ts` lines 84–93 — exposes `hypothesesPath(project)` / `journalPath(project)` that join `p.root` with the literal `'HYPOTHESES.md'` / `'JOURNAL.md'`.
- `apps/web/lib/runtime.ts` line 138 — the cache initialiser computes path arrays for the `FileCache`.
- CLI commands (`packages/cli/src/commands/*`) compute paths inline via `join(root, 'JOURNAL.md')`.

Most code paths take a path argument, so the canonical-path mutation is concentrated in a few "compose the path" sites. Renaming "the literal string" rather than "the API shape" keeps the surface area tight.

## Goals / Non-Goals

**Goals:**
- Live constant `FS_CONVENTION_VERSION === 2`.
- Every memon-internal read/write of journal & hypotheses files targets the new paths.
- A correct, executable `v1-to-v2.md` guide exists and verifies against a v1 fixture.
- Mock data and tests reflect v2 directly (mock projects are dev fixtures, not user-owned data).
- Spec deltas land for `journal`, `hypotheses`, `fs-version-tracking`.

**Non-Goals:**
- No automatic migration of real on-disk projects. The `sparse-fsdp` working tree (or any other v1 project) MUST be migrated by the user invoking `memon-migrate-fs`. The change does not touch user repos.
- No introduction of "compat fallback" reads — code SHALL NOT silently fall back to root-level `JOURNAL.md` if `docs/journal.md` is missing. v1 projects MUST go through the migrate-fs flow; the install-time detection requirement in `fs-migration-runtime` already surfaces this to the user.
- No bump of any other on-disk artefact (READMEs, reports, digests, `.memon/`).

## Decisions

### D1. Canonical paths are literal strings, computed at the chokepoints
Every code path that today writes the literal string `'JOURNAL.md'` or `'HYPOTHESES.md'` SHALL be updated to write `'docs/journal.md'` / `'docs/hypotheses.md'`. We deliberately do NOT introduce constants like `JOURNAL_RELATIVE_PATH` exported from `@memon/core`:

- The literal appears in maybe 12–15 call sites across CLI, core, and web. A constant adds an import line per site without removing real risk.
- More importantly, the migration guide itself uses the literal strings in `## Diff` blocks; if a future change moves them again, the guide and the constant would both have to update, doubling the work without doubling the safety.

What we DO factor: `apps/web/lib/runtime.ts`'s `hypothesesPath()` / `journalPath()` already centralise the path within the runtime — those two functions get updated; downstream callers don't need to know the literal.

### D2. No compat fallback. Hard fail on the old path.
A common temptation: `if (existsSync(oldPath)) { use it } else { use newPath }`. Rejected because:

- It silently keeps v1 projects "working" without forcing them through the migrate-fs gate. The whole point of `FS_CONVENTION_VERSION` is to refuse to half-operate on the wrong schema.
- It hides bugs: when the v2 path is supposed to be there but isn't, the agent reads stale v1 data instead of failing loudly.
- The migration runtime already has a clean upgrade path with user confirmation, working-tree clean check, and rollback notes. Use it.

If a v1 project hits the v2 code, `parseHypotheses` / `parseJournal` get an `ENOENT` for the docs path, which is the existing "no file" branch — same as a brand-new project. Combined with the install-time version-mismatch banner from `fs-migration-runtime`, the user is steered to migrate.

### D3. Skill text is updated wholesale, every reference
Skills are markdown, agent-targeted, and exact-string-precision matters. We do not say "see SKILL.md, fix later." Every `JOURNAL.md` / `HYPOTHESES.md` mention in `packages/skills/**/SKILL.md` and `packages/skills/README.md` SHALL be edited to `docs/journal.md` / `docs/hypotheses.md` in the same change. Cross-references (e.g. "the digest writer reads JOURNAL.md") get the new path verbatim.

Skills that already say "the journal" without the file path don't need editing — only literal path mentions do. We grep, fix, then grep again to confirm zero matches in `packages/skills/`.

### D4. Mock data is migrated by `git mv`, not by re-running migrate-fs against it
The mock projects are checked-in fixtures — they're authored content, not user data. We move the files in this change directly so the v1 → v2 transition lands as one commit including fixtures. Running `memon-migrate-fs` against the mock projects would also work, but produces a less-readable diff (the migrate-fs commit message + commit-per-step structure is for user repos, not for source control of memon's own fixtures).

`mock/project-b/` has no `docs/` directory yet; the move creates it.

### D5. Guide structure follows the meta-spec verbatim
Per CLAUDE.md "Authoring an FS-convention migration guide" and `openspec/specs/fs-migration-guide-authoring/spec.md`:

- Seven H2 sections in fixed order: `Background / Why`, `Detection`, `Diff (v1 → v2)`, `Target State (v2 Summary)`, `Verification`, `Rollback Notes`, `Edge Cases`.
- Detection bullets are literal commands (e.g. `test -f <root>/JOURNAL.md && echo OK`), not prose.
- Verification is a fenced `bash` block where each line is a comment or a runnable command, every command prints OK on success, every non-zero aborts.
- Rollback Notes contains the literal commit message string `chore(memon): migrate FS convention v1 -> v2`.
- Edge Cases addresses (or marks not-applicable for) the four canonical situations: missing required file, custom frontmatter, dirty tree, concurrent invocation.

The `Diff` section uses two per-file subsections — one for `JOURNAL.md` → `docs/journal.md`, one for `HYPOTHESES.md` → `docs/hypotheses.md` — each with a fenced `before` block (the v1 path) and an `after` block (the v2 path). Frontmatter content is preserved byte-for-byte; only the path and filename change.

### D6. Tests assert the new paths and the constant
Existing tests that reference the old paths get updated alongside the move; the unit-test of `FS_CONVENTION_VERSION` (in whatever spec/scenario validates "starts at 1") is now historical context — the live test asserts `=== 2`. Per `fs-version-tracking`'s "Initial value is 1" scenario: this scenario is about the value at the FIRST archive of the constant, not the current value. Reading it that way means the scenario stays true historically without needing a delta. The new live assertion lives wherever today's test asserts `=== 1` — it bumps to `=== 2`.

## Risks / Trade-offs

- [Risk] A grep miss leaves a stale `JOURNAL.md` / `HYPOTHESES.md` literal in some lesser-touched file (an old migration script, a doc fragment) → confused agent. → Mitigation: explicit grep audit at the end of `## 4. Verification` in tasks.md (`grep -rn "JOURNAL\.md\|HYPOTHESES\.md" packages apps .claude --include="*.ts" --include="*.tsx" --include="*.md"` should print only the migration guide itself + intentional historical references in `openspec/changes/archive/`).

- [Risk] User has uncommitted changes when they pull this commit; their `JOURNAL.md` / `HYPOTHESES.md` exist at v1 paths and memon code refuses to read them. → Mitigation: `fs-migration-runtime`'s install-time banner already exists for this. The user sees "Project FS convention is at v1; current memon expects v2. Run the migrate-fs skill to upgrade." Documented in the guide's `Rollback Notes`.

- [Risk] The migration guide's verification block depends on shell tools that aren't on every cluster. → Mitigation: meta-spec already mandates POSIX coreutils + git + grep + memon only. We honour it.

- [Risk] Real working repo (`/mnt/weka/home/hao.zhang/TTT/git/sparse-fsdp`) is at v1; after this commit lands, the dashboard shows that project as "v1 mismatch". → Acceptable. The user can run migrate-fs against it after merging. The other workflow alternative (auto-migrate on first read) is rejected per D2.

- [Risk] Running grep replace-all could rename `HYPOTHESES.md` strings inside test snapshots that are intentionally testing v1 detection. → Mitigation: only update strings outside `openspec/specs/fs-migration-guide-authoring/`, `openspec/specs/fs-migration-runtime/`, and `openspec/changes/archive/`. Verification step explicitly asserts those paths still contain old literals (they're historical).

## Migration Plan

This proposal IS the migration plan for memon-internal artefacts. For user data (real project roots), `memon-migrate-fs` is the entrypoint; the guide authored here drives it. Rollback for the memon-internal change is `git revert` of the apply commit.

## Open Questions

None — the meta-spec for migration guides is mature and prescriptive enough that we have no judgement calls left for the guide itself. Code-side rename surface is mechanical.
