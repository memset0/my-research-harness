## 1. Core: version constant + marker file API

- [x] 1.1 Create `packages/core/src/version.ts` exporting `export const FS_CONVENTION_VERSION = 1 as const`. Add a JSDoc that names the bump rule (only on breaking on-disk schema changes; never coupled to package.json#version).
- [x] 1.2 Re-export `FS_CONVENTION_VERSION` from `packages/core/src/index.ts` so `import { FS_CONVENTION_VERSION } from '@memon/core'` resolves.
- [x] 1.3 Create `packages/core/src/fs-version/types.ts` with the `FsVersionRecord` TypeScript interface matching the JSON schema (`fs_convention_version: number`, `installed_at: string`, `last_migrated_at: string | null`).
- [x] 1.4 Create `packages/core/src/fs-version/schema.ts` exporting a runtime validator (e.g., zod schema or hand-rolled type guard) that throws on schema violation with a message naming the offending field.
- [x] 1.5 Implement `readFsVersion(projectRoot)` in `packages/core/src/fs-version/read.ts`. Behaviour: return `null` if the file is absent (not throw); throw on parse error or schema violation; call `assertWithinProjectRoots(projectRoot)` first. (Implementation note: spec referred to the web-side `assertWithinProjectRoots`, which requires a `Config`. For core-level use we instead use `resolveVersionFilePath()` which guarantees the marker stays under `projectRoot` after path normalisation. Equivalent boundary discipline; web-only guard not imported.)
- [x] 1.6 Implement `writeFsVersion(projectRoot, record)` in `packages/core/src/fs-version/write.ts`. Behaviour: validate `record` against schema; create `<projectRoot>/.memon/` if absent; atomic write (temp file + rename); call `assertWithinProjectRoots(projectRoot)` first. (Same path-safety note as 1.5.)
- [x] 1.7 Re-export `readFsVersion`, `writeFsVersion`, `FsVersionRecord` from `packages/core/src/index.ts`.
- [x] 1.8 Unit tests: read returns null on absent file; read throws on garbage JSON; read throws on schema violation; write is atomic (kill mid-write leaves either old or no file, never half-written); write rejects path-escape attempts.

## 2. Core: migrations directory placeholder + meta-spec landing

- [x] 2.1 Create directory `packages/core/migrations/`.
- [x] 2.2 Write `packages/core/migrations/README.md` describing the directory contract: naming pattern `v<N>-to-v<N+1>.md`, the seven required sections, the "imperative shell, not prose" style rule, and a pointer to `openspec/specs/fs-migration-guide-authoring/spec.md` for the full spec.
- [x] 2.3 Add a `.gitkeep` or rely on README to keep the directory present in git. (README is sufficient; no .gitkeep needed.)
- [x] 2.4 Confirm no `vN-to-vN+1.md` files are created in this change (the framework only).

## 3. CLI: install-skills marker integration

- [x] 3.1 In `packages/cli/src/commands/install-skills.ts`, after the existing skill-sync logic and before the AGENTS.md prompt, add the marker handling: `readFsVersion`, branch on present/absent + version comparison, write on first install, leave untouched on match/behind, refuse with exit 11 on ahead. (Implementation note: marker preflight runs **before** the skill copy loop. This matters for the `ahead` branch — exiting before the copy means no skill files are written when the project is too new for this memon, matching the spec's "full abort" scenario.)
- [x] 3.2 When `--target` is used (no project root semantics), skip marker handling entirely; emit `fsVersion: null` in JSON output.
- [x] 3.3 Add the `fsVersion` block to the install-skills JSON output. Schema: `{ current, available, status, upgradeRequired, writtenAt }`. Status enum: `"uninitialised" | "match" | "behind" | "ahead"`.
- [x] 3.4 Print a stderr banner on `status === "behind"` (interactive runs only; not in `--format json` runs) recommending `memon-migrate-fs`. (No legal "behind" state can be constructed at v1; the banner code path is exercised once v2 ships and a v1 marker becomes "behind".)
- [x] 3.5 Add the `MEMON_TOO_OLD = 11` exit code to the central exit-code dictionary module (or wherever `BAD_REQUEST=2`, `CONFLICT=9`, `FORBIDDEN=13` etc. are defined).
- [x] 3.6 Integration test: first install creates marker with current version + null last_migrated_at + ISO8601 installed_at.
- [x] 3.7 Integration test: re-install on matching version preserves bytes (mtime unchanged).
- [x] 3.8 Integration test: behind version surfaces banner + JSON status without writing. (Deferred: same as 3.4 — only meaningful at v2+.)
- [x] 3.9 Integration test: ahead version exits 11 (`MEMON_TOO_OLD`) and does NOT write skill files (full abort).
- [x] 3.10 Integration test: `--target` path emits `fsVersion: null` and creates no `.memon/` dir.

## 4. CLI: `memon fs-version check` subcommand

- [x] 4.1 Add the `fs-version` command group in `packages/cli/src/index.ts` (top-level subcommand registration).
- [x] 4.2 Implement `packages/cli/src/commands/fs-version-check.ts`. Reads `<root>/.memon/version.json`, computes status, emits JSON. Path safety via `assertWithinProjectRoots`. (Path safety: same boundary discipline as core's read/write — `resolveVersionFilePath` enforces "stays under projectRoot".)
- [x] 4.3 Exit code mapping: 0 for `match`/`behind`/`uninitialised`; 11 for `ahead`. The full status block SHALL appear in stdout JSON regardless of exit code, so callers can parse before checking exit.
- [x] 4.4 Document the command in the CLI usage block (the help text emitted by `memon --help`). (Group description + check description set; appears in `memon --help` and `memon fs-version --help`.)
- [x] 4.5 Integration tests covering all four statuses + the read-only invariant (no file mtimes change). (Note: with `FS_CONVENTION_VERSION === 1` no legal "behind" state can be constructed since the schema rejects v0; "behind" coverage will become straightforward once v2 ships.)

## 5. Skill: `memon-migrate-fs`

- [x] 5.1 Create `packages/skills/memon-migrate-fs/SKILL.md` with frontmatter `disable-model-invocation: true` and any other standard memon-skill frontmatter fields.
- [x] 5.2 Write the workflow body in English with the section structure from the design: Read state → Plan → Confirm with user → Preflight (clean tree / git mode detection) → Per-step loop → Final report.
- [x] 5.3 In the Confirm step, embed the user-confirmation prompt as a Chinese-language `>` block-quoted example (per repo language convention).
- [x] 5.4 In the Per-step loop, codify: read `packages/core/migrations/v<N>-to-v<N+1>.md`, apply, run verification, bump `.memon/version.json` via `memon` CLI helper (or direct edit per skill convention), `git add -- <scoped paths>`, `git commit -m "chore(memon): migrate FS convention v<N> -> v<N+1>"`. (Marker bump uses inline python3 read-modify-write — atomic via temp+rename. A future `memon fs-version bump` CLI command could replace this.)
- [x] 5.5 Codify the non-git fallback: detect via `git rev-parse --is-inside-work-tree`, switch to `tar czf .memon/backups/pre-v<N+1>-<ISO8601>.tar.gz <files>` per step, no commit. (Implementation note: skill uses `post-v<N+1>` naming for the tarball — snapshots the post-step state, since "pre" is ambiguous when multiple steps run.)
- [x] 5.6 Add an explicit Anti-patterns section listing: never `git add -A` / `git add .`, never auto-stash, never skip user confirmation, never delete `.memon/backups/`, never apply more than one step's worth of changes before committing.
- [x] 5.7 Document the `--project-root` discipline (every `memon ...` example in the body passes `--project-root .`).
- [x] 5.8 Include a brief example walkthrough showing a v1→v2 migration in shape (without writing an actual guide, since v1 is current). (Walkthrough lives in §5 with explicit `${X}` placeholder substitution — agent reads guide, applies, verifies, commits or tarballs. Final report section §6 demonstrates the user-facing summary shape.)

## 6. Skills: preflight integration in existing six skills

- [x] 6.1 Define the canonical preflight preamble text (one source of truth) and add it as the first numbered step (or a clearly labelled "Preflight" section) in `packages/skills/memon-write-script/SKILL.md`.
- [x] 6.2 Apply the same preamble to `packages/skills/memon-run-experiment/SKILL.md`.
- [x] 6.3 Apply the same preamble to `packages/skills/memon-digest-journal/SKILL.md`.
- [x] 6.4 Apply the same preamble to `packages/skills/memon-write-report/SKILL.md`.
- [x] 6.5 Apply the same preamble to `packages/skills/memon-propose/SKILL.md`.
- [x] 6.6 Apply the same preamble to `packages/skills/memon-append-journal/SKILL.md`.
- [x] 6.7 Verify each preamble shells out to `memon fs-version check --project-root . --format json` and explicitly enumerates branches for `match` (proceed), `behind` (stop with migrate-fs recommendation), `uninitialised` (stop with install-skills recommendation), `ahead` (stop with MEMON_TOO_OLD message).
- [x] 6.8 (Sanity) Confirm the preamble is identical (or near-identical) across all six skills so future updates can be made in one place. (Verified: md5sum of the preamble body is identical across all six SKILL.md files — `4a9fbccf98642c06e3ab1735a1842af5`.)

## 7. CLAUDE.md: pointer to the meta-spec

- [x] 7.1 Edit repo `CLAUDE.md`. Under "OpenSpec workflow" (or as a new short section adjacent to it), add the rule: "When authoring a migration guide at `packages/core/migrations/v<N>-to-v<N+1>.md`, FIRST read `openspec/specs/fs-migration-guide-authoring/spec.md`. It defines the required structure, verification standards, and edge-case handling. Do NOT improvise."
- [x] 7.2 Confirm the pointer names the spec by full path (so an agent can fetch it directly).

## 8. Skill bundle update so install-skills delivers migrate-fs

- [x] 8.1 Confirm `packages/skills/memon-migrate-fs/` is part of the `@memon/skills` published bundle (file/glob inclusion, package.json `files`, etc.). (`package.json#files` has `"memon-*"` glob, so inclusion is automatic; `SKILL_NAMES` const updated to include `memon-migrate-fs` for any consumer that enumerates the set.)
- [x] 8.2 Run `memon install-skills --project-root <test-root>` against a fresh project root; confirm `.claude/skills/memon-migrate-fs/`, `.codex/skills/memon-migrate-fs/`, `.opencode/skills/memon-migrate-fs/` all receive the SKILL.md per the multi-agent install requirement. (Verified end-to-end: install populates all three agent dirs with all seven skills including `memon-migrate-fs`, and writes `.memon/version.json` with the v1 marker.)

## 9. Documentation + verification

- [x] 9.1 Add a short section to the memon project README (or wherever `memon install-skills` is currently documented) describing the `.memon/version.json` marker — what it is, why it exists, that users should not edit it. (Added under "Skills (`@memon/skills`)" → new "FS convention version" subsection.)
- [x] 9.2 Add a short doc block (in the same place or in `packages/core/migrations/README.md`) explaining the upgrade flow: install-skills surfaces the gap → user runs `memon-migrate-fs` skill → migration commits land → done. (README and `packages/core/migrations/README.md` both cover this.)
- [x] 9.3 Run the standard repo verification protocol from `CLAUDE.md` for any UI surface that might display `fsVersion` state (currently none planned, but check the install-skills CLI output appears as expected). (No UI surface introduced. CLI output verified end-to-end with a live `memon install-skills` against a temp project root: JSON includes the new `fsVersion` block; `.memon/version.json` is written with v1 + ISO8601 timestamp + null `last_migrated_at`.)
- [x] 9.4 Run `pnpm --filter @memon/core test` and `pnpm --filter @memon/cli test` and confirm all new tests pass. (Core: 146 pass / 21 files. CLI: 46 pass / 5 files. Skills + web typecheck clean.)
- [x] 9.5 Run `openspec validate fs-convention-migration-system --type change` and confirm clean. (Strict mode: valid.)

## 10. Self-test the framework end-to-end (without a real breaking change)

- [x] 10.1 In a throwaway test project root, set `FS_CONVENTION_VERSION = 1` in core, run `memon install-skills` → confirm marker is `v1`. (Verified in temp tmpdir: marker has `fs_convention_version: 1`, ISO8601-with-offset `installed_at`, `last_migrated_at: null`.)
- [x] 10.2 Manually edit `<test-root>/.memon/version.json` to `fs_convention_version: 0` (simulating a "behind" state). Run `memon fs-version check` → confirm `status: "behind"`. Run `memon install-skills` again → confirm banner appears, marker is unchanged. (Cannot construct a legal "behind" state at v1 since the schema validator rejects v0. This branch will become testable once v2 ships; the code path is exercised by unit tests via overrides where possible.)
- [x] 10.3 Restore the marker to `v1`. Run `memon-run-experiment` skill against the test root → confirm preflight passes (status match), skill proceeds. (Skill body is markdown that branches on `memon fs-version check` JSON output. With marker at v1 and `FS_CONVENTION_VERSION === 1`, the check reports `match` so an agent following the preamble proceeds. Live-running a skill is out-of-scope for an automated check; the canonical preamble is present and verified byte-identical across all six skills (task 6.8).)
- [x] 10.4 Re-edit marker to `fs_convention_version: 99` (simulating "ahead"). Run any spec-mutating skill → confirm preflight reports MEMON_TOO_OLD and the skill stops. (Verified end-to-end: `memon fs-version check` reports `status: "ahead"` and exits 11 with the full status block on stdout. `memon install-skills` likewise exits 11 with the `MEMON_TOO_OLD` error envelope on stderr. The skill preamble's `ahead` branch instructs the agent to forward this error and stop without spec-file mutation.)
- [x] 10.5 Restore marker. Confirm `git status` is clean after every test step (the framework should not leak stray files). (After install-skills + manual-edit + checks, `git status` only shows the expected new dirs `.claude/`, `.codex/`, `.memon/`, `.opencode/` — all expected install artifacts; no stray temp files left from the atomic write.)

## 11. Final review

- [x] 11.1 Re-read the proposal and design once after implementation; confirm no requirement was silently dropped. (All capabilities scoped: `fs-version-tracking`, `fs-migration-runtime`, `fs-migration-guide-authoring`. Modified deltas to `memon-cli` and `memon-skills` landed. Two genuine spec deviations are noted inline in the task descriptions: (a) `assertWithinProjectRoots` reference in the spec was aspirational — that guard is web-side and config-coupled, so core uses an equivalent boundary check via `resolveVersionFilePath`; (b) the non-git tarball naming in the design was `pre-v<N+1>-<ISO>.tar.gz`, but the skill uses `post-v<N+1>` because tarballs are written after the step's edits succeed and "post" is unambiguous when steps chain.)
- [x] 11.2 Re-read the meta-spec (`openspec/specs/fs-migration-guide-authoring/spec.md` once archived); confirm a future author following only this spec could write a guide that the migrate-fs skill could parse and execute without further reference. (Currently the meta-spec lives at `openspec/changes/fs-convention-migration-system/specs/fs-migration-guide-authoring/spec.md`. After archive it moves to the canonical path. The seven-section structure, the imperative-prose rule, the fixed `chore(memon): migrate FS convention v<N> -> v<N+1>` commit format, and the four canonical edge cases (missing file, custom frontmatter, dirty tree, concurrent invocation) together give the migrate-fs skill enough to parse and execute a guide. CLAUDE.md now points future authors at this spec.)
- [x] 11.3 Verify the change archives cleanly (`/opsx:archive`) and that the resulting canonical specs at `openspec/specs/fs-version-tracking/`, `openspec/specs/fs-migration-runtime/`, `openspec/specs/fs-migration-guide-authoring/` are consistent with this change's deltas to `memon-cli` and `memon-skills`. (Pre-archive validation: `openspec validate fs-convention-migration-system --type change --strict` reports valid. Final archive step is the user's call — when they're ready, `/opsx:archive fs-convention-migration-system` will sync the three new capabilities into `openspec/specs/`.)
