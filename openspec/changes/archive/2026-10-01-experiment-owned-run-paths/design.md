## Context

Current Experiment parsers store basename IDs in `runs`; `computeMembership` intersects them with Run `experiment` claims. CLI create/link/unlink/delete and rename write both sides. Backend membership, citation freshness and eligibility paths also resolve IDs through Run discovery. See proposal.md for the change motivation. Removing one field alone will not remove those discovery calls.

## Goals / Non-Goals

Goals: direct member lookup, one authoritative declaration, deterministic conversion and measurable I/O reduction on cold caches.

Non-goals: moving Run outputs, changing result semantics, adding a persistent membership cache, promising all page-latency problems are solved, or migrating operator data without a reviewed plan. Global Run browsing and explicit project-wide doctor checks can still scan; an Experiment member request cannot.

## Decisions

1. `runs` contains normalized POSIX project-root-relative directory paths, for example `logs/group-a/train-260901-090000`. The README path is obtained by appending `README.md`. Project roots, not Experiment bundle locations, are the stable base, so Experiment renames do not rewrite Run references. Preserve current discovery roots (`logs`, `outputs`, `experiments`) and valid Run basenames; arbitrary output relocation is not part of this change. Reject absolute paths, backslashes, empty/dot/parent components and symlink escape. Bare IDs are not canonical v7 references.
2. Preserve current at-most-one-parent semantics. The same path claimed by two Experiments is a blocking conflict, not first-writer-wins. Unassigned Runs are valid. Different paths with the same basename are distinct resources. A bare-ID convenience selector can resolve only when unique; otherwise return candidates and require a path.
3. Run frontmatter no longer stores ownership. Parent display is derived from Experiment documents. Link/unlink, Experiment rename/delete and create-from-run must not rewrite Run READMEs. Membership is the declaration, not an intersection with a hydrated Run. Missing/unreadable members remain declared and get a separate validity diagnostic; never silently drop them.
4. Direct path identities must propagate through API DTOs, route selectors and query keys, not be collapsed back to `basename`. Audit results `variants[].runs`/`attempts`, imported run references, deprecation eligibility, document artifact links and Wiki references. Existing reference syntaxes can retain basename compatibility only when unambiguous and without triggering an unrelated discovery scan on the member-detail path. The migration must identify every ambiguous dependent reference and require a path-qualified resolution. Result contribution versus attempted-run semantics remain unchanged.
5. Implement a packaged reusable migration helper invoked by the existing migrate-fs workflow, plus a repository entry script if needed for batch invocation. Proposed interface: plan with `--project-root` and an output file; apply with the reviewed plan file; verify with the same plan. Plan contains relative paths, preimage hashes, resulting membership changes, Run-field removals, dependent-reference edits and blocking diagnostics. Do not put operator paths in bundled examples.
6. Planning performs the expensive legacy scan once: discover Run directories without descending into Run outputs; index every basename to all matching paths; resolve Experiment declarations and read legacy Run headers for a loss-prevention audit. Experiment-side declarations win; a contradictory or Run-only parent claim is a review blocker, not automatic ownership. A reviewed resolution either amends the Experiment plan or explicitly acknowledges dropping the legacy claim. Missing Run targets and duplicate claims are blockers; do not guess from slug prefixes.
7. Apply validates the complete plan before the first write, refuses dirty Git worktrees by default (an explicit operator-approved scoped override requires external backups and preservation of unrelated edits), rechecks fingerprints immediately before each mutation, and backs up all touched files. Use frontmatter-targeted edits preserving unknown fields, comments and Markdown bodies. Record a recovery manifest because multi-file writes cannot be atomic as a group. Rollback restores only files still matching this migration's postimages; do not overwrite concurrent edits. Verify all target invariants before advancing the FS marker; matching fully-applied plans are idempotent no-ops. No Git reset/clean or unrelated staging.
8. FS marker and release become 7 and 7.0.0 only in the release commit, after the migration guide and tooling exist. Version mismatches are intercepted by the two existing detection points (see D1); reads never auto-upgrade, and bare IDs are read-compatible but never written (see D2). The migration helper must remain able to read v6 independently of v7 runtime loaders. Avoid mixed v6/v7 writers during cutover.

## v7 release decisions

- **D1 — no marker gate on write paths.** v7 tools do not read `.memon/version.json` on CLI, Backend or Web write paths. Version detection stays at exactly the two points `fs-migration-runtime` already defines: skill preflight and `memon fs-version check` (also used by `install-skills`). Reasons: no 6.x release ever implemented a write-path gate, so adding one now would be a new cross-surface behavior with its own failure modes; the only deployed project is migrated before tools switch; and v7 writers only emit forms that the already-shipped 6.x readers accept. The earlier "v7 mutations of v6 projects fail" clause is revised accordingly.
- **D2 — read-compatible, write-canonical.** v7 parsing keeps accepting a bare Run ID in `runs` and resolves it by the existing automatic priority (path first; a bare ID only when one Run-root walk finds exactly one match, never opening unrelated READMEs). Structural lint reports `LEGACY_RUN_ID_REF` (warning) for such entries, and Run lint reports `RUN_LEGACY_EXPERIMENT_FIELD` (warning) for a leftover Run `experiment` field. Every writer emits project-relative paths only.
- **D3 — mock projects in v7 form.** `mock/project-a` and `mock/project-b` are converted with the repository's own `scripts/migrate-v6-to-v7.mjs` in keep-version mode (the mocks carry no marker; the runtime creates it), declaring paths and dropping Run `experiment` fields. Affected tests are updated in the same, separately revertible commit.
- **D4 — planner tolerance.** (a) A declared member directory that exists without `README.md` is a `MEMBER_README_MISSING` warning, not a blocker: there is no Run field to strip, the plan changes nothing there, and the directory belongs to the anomalies panel. (b) A declared path that is a symlink whose real path stays inside the project root is accepted and processed under the declared path, not rewritten to its target; a symlink escaping the project root remains a blocker. Files reachable through more than one accepted path are planned once.
- **D5 — bounded-I/O evidence is test-level.** Task 4.1 counts `discoverRuns`, `scanProjectRoot` and Run README reads for an Experiment with 3 members among N = 3 and N = 50 unrelated Runs, cold and warm, and asserts member resolution does not scale with N. No operator-project benchmark is run.
- **D6 — guide conformance.** `packages/core/migrations/v6-to-v7.md` follows `fs-migration-guide-authoring` exactly; `scripts/migrate-v6-to-v7.md` is the keep-version operator entry point and points to it.

## Risks / Trade-offs

- Path moves invalidate declarations → explicit diagnostics and user-directed path updates, not fallback searches.
- Reverse parent lookup still reads Experiment declarations → bounded declaration-only projection; no Run README scan. Measure it separately from direct member fetch.
- Legacy malformed YAML or ambiguous provenance → block the plan and report exact relative locations; preserve all source bytes until resolved.
- Large migrations or interrupted writes → preimage/postimage manifest, backups and conflict-aware recovery; never publish a partially migrated FS marker.
- Current fixed discovery roots may later need expansion → separate scope; migration reports unsupported paths instead of silently relocating data.

## Migration Plan

1. Implement path contracts and every consumer, then add the reusable planner/apply/verifier and the v6-to-v7 guide with the seven required sections.
2. Cover same-basename directories, missing targets, conflicting/Run-only claims, custom frontmatter, symlinks, dirty trees, interrupted apply, concurrent edits and idempotent reruns in neutral fixtures. Verify requested member reads perform zero global Run discovery, zero unrelated Run README reads and no Run-output traversal with both warm and cold caches.
3. Run an explicitly authorized read-only plan on the operator project and store it privately. Present all conflicts and the exact proposed write set for approval. Planning is not authorization to migrate.
4. Stop incompatible writers and take a recoverable snapshot; apply the approved plan, verify all declared paths and removal of Run ownership fields, then advance the FS marker through the migration runtime. Use commit message `chore(memon): migrate FS convention v6 -> v7` in Git mode; support the existing tarball fallback otherwise.
5. Deploy matching v7 central/CLI artifacts, verify membership/navigation and measure representative I/O/latency. Roll back project data and tooling together if verification fails. Preserve the explicit read-only central policy; migration writes require separate operator authorization.

### Staged rollout decision

An explicitly approved data-only migration MAY use `--keep-version` to apply
the membership conversion while preserving the v6 marker byte-for-byte.
Readers and writers SHALL support this state. Verification SHALL check the
actual data format separately from the release marker. Final v7 release and
marker advancement wait until all planned migrations are ready; this step
SHALL NOT trigger an automatic release or claim unrelated migrations passed.
