# fs-migration-runtime Specification

## Purpose
Defines how a project whose on-disk layout is older than the installed `FS_CONVENTION_VERSION` is detected and migrated: mandatory user confirmation, a clean worktree and per-step commits in git mode, backup tarballs otherwise, and staged approval for semantic steps. It serves operators upgrading research projects, with the `memon-migrate-fs` skill orchestrating the protocol. The per-version guides under `packages/core/migrations/` are the executable contract; the version marker itself is owned by `fs-version-tracking`.

## Requirements

### Requirement: Two detection points for version mismatch

A project root's FS convention version SHALL be checked against `FS_CONVENTION_VERSION` at exactly two points:

1. **At `memon install-skills` time.** Whenever the command runs, after writing the skill files, it SHALL read `.memon/version.json` (creating it on first install per `fs-version-tracking`), compare to `FS_CONVENTION_VERSION`, and surface mismatch in the output.
2. **At skill preflight time.** Every memon skill that reads or writes a spec file (the project root's `README.md`, `HYPOTHESES.md`, `JOURNAL.md`, or anything under `<projectRoot>/docs/reports/` or `<projectRoot>/docs/wiki/`) SHALL invoke `memon fs-version check --project-root <p>` as the first executable step in its workflow body and branch on the result.

Pure read-only memon CLI commands (e.g., `memon show`, `memon hypotheses read`) SHALL NOT preflight-check, to avoid adding latency to non-mutating operations. Skills that only invoke read-only CLI commands and never write a spec file are also exempt; in practice all current skills mutate spec files, so all of them preflight.

#### Scenario: install-skills reports match
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: <FS_CONVENTION_VERSION>`
- **WHEN** `memon install-skills --project-root <root> --format json` runs
- **THEN** the JSON output includes `fsVersion: { current: <V>, available: <V>, status: "match", upgradeRequired: false }`

#### Scenario: install-skills reports behind
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 1` and `FS_CONVENTION_VERSION === 3`
- **WHEN** `memon install-skills --project-root <root>` runs
- **THEN** stderr includes a banner: `WARNING: Project FS convention is at v1; current memon expects v3. Run the migrate-fs skill to upgrade.`
- **AND** JSON output includes `fsVersion: { current: 1, available: 3, status: "behind", upgradeRequired: true }`
- **AND** `<root>/.memon/version.json` is left UNCHANGED (install does not migrate)

#### Scenario: Skill preflight on match
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: <FS_CONVENTION_VERSION>`
- **WHEN** any memon-* skill runs against `<root>` and executes its preflight
- **THEN** `memon fs-version check --project-root <root> --format json` reports `status: "match"`
- **AND** the skill proceeds to its main workflow

#### Scenario: Skill preflight on behind blocks workflow
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 1` and the running memon has `FS_CONVENTION_VERSION === 2`
- **WHEN** any memon-* skill runs against `<root>` and executes its preflight
- **THEN** `memon fs-version check` reports `status: "behind"`
- **AND** the skill SHALL NOT proceed to its main workflow
- **AND** the skill SHALL surface the gap to the user and recommend invoking `memon-migrate-fs`

#### Scenario: Read-only commands skip preflight
- **WHEN** `memon show <id> --project-root <root>` runs
- **THEN** the command does NOT call `memon fs-version check`
- **AND** the command runs normally regardless of `.memon/version.json` state

### Requirement: User confirmation is mandatory before any migration

The `memon-migrate-fs` skill SHALL NOT execute migration steps without explicit user confirmation. The skill workflow SHALL be:

1. Read `<root>/.memon/version.json` to determine `currentVersion`. If the file is absent, abort with a clear error directing the user to run `memon install-skills` first.
2. Determine `targetVersion = FS_CONVENTION_VERSION`.
3. If `currentVersion === targetVersion`: tell the user "already up to date" and exit.
4. If `currentVersion > targetVersion`: surface the forward-compat error (see `memon-cli` modified spec, exit code `MEMON_TOO_OLD`).
5. Otherwise enumerate the steps that will run (`v<X>→v<X+1>` for X in `[currentVersion .. targetVersion-1]`). For each step, verify that `packages/core/migrations/v<X>-to-v<X+1>.md` exists in the installed memon; if any guide is missing, abort with an error listing the missing guide(s).
6. Present the plan to the user in plain language: "Project is at FS convention v<X>; tool expects v<Y>. I will run <N> migration step(s): v<X>→v<X+1>, ..., v<Y-1>→v<Y>. Proceed?"
7. Wait for explicit confirmation. Only on affirmative response does the migration proceed to the per-step protocol.

A user message that triggered the agent for any other reason (e.g., "add a journal entry", "summarise progress") SHALL NEVER be treated as implicit consent to migrate.

#### Scenario: Confirmation is asked before migration
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 1` and `FS_CONVENTION_VERSION === 3`
- **WHEN** the user invokes `memon-migrate-fs`
- **THEN** the skill enumerates the planned steps to the user
- **AND** the skill explicitly asks for confirmation before doing any filesystem mutation beyond reading
- **AND** if the user declines, no `.memon/version.json` write occurs and no migration commit is made

#### Scenario: Already up to date
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version === FS_CONVENTION_VERSION`
- **WHEN** the user invokes `memon-migrate-fs`
- **THEN** the skill reports "already up to date" and exits without any filesystem mutation

#### Scenario: Missing guide aborts before any change
- **GIVEN** `<root>` is at v1, `FS_CONVENTION_VERSION === 3`, and `packages/core/migrations/v2-to-v3.md` exists but `v1-to-v2.md` does not
- **WHEN** the user invokes `memon-migrate-fs`
- **THEN** the skill aborts before applying any change
- **AND** the error message names the missing guide(s)

### Requirement: Working tree must be clean before migration begins (git mode)

If `<projectRoot>` is a git repository, `memon-migrate-fs` SHALL refuse to begin migration when the working tree has any uncommitted changes (modified, staged, or untracked files within the project root).

The skill SHALL invoke `git status --porcelain` (scoped to the project root) and treat any non-empty output as a dirty tree. On dirty tree, it SHALL surface the offending files to the user and instruct the user to commit, stash, or discard their work before re-invoking. The skill SHALL NOT auto-stash on the user's behalf.

#### Scenario: Dirty tree blocks migration
- **GIVEN** `<root>` is a git repo with one modified file `README.md`
- **WHEN** the user confirms migration in `memon-migrate-fs`
- **THEN** the skill runs `git status --porcelain` and observes non-empty output
- **AND** the skill aborts with a message naming `README.md` and instructing the user to commit / stash / discard before retrying
- **AND** no `.memon/version.json` write occurs

#### Scenario: Untracked file also counts as dirty
- **GIVEN** `<root>` is a git repo with no modified files but one untracked file `notes.txt`
- **WHEN** migration is attempted
- **THEN** the skill aborts with the same dirty-tree refusal

#### Scenario: Clean tree allows migration
- **GIVEN** `<root>` is a git repo with no modified, staged, or untracked files
- **WHEN** migration is attempted and the user confirms
- **THEN** the skill proceeds to the per-step protocol

### Requirement: Per-step protocol with git commits in git mode

Once migration begins (user confirmed, tree clean, all guides present), the skill SHALL execute the following loop:

```
for v in [currentVersion .. targetVersion - 1]:
  read packages/core/migrations/v<v>-to-v<v+1>.md
  apply the file-level changes described in the guide
  run the verification commands listed in the guide; if any fail, abort
  update <root>/.memon/version.json: fs_convention_version = v+1, last_migrated_at = <now>
  git add -- <files this step touched, including .memon/version.json>
  git commit -m "chore(memon): migrate FS convention v<v> -> v<v+1>"
```

The commit message SHALL match the literal pattern `chore(memon): migrate FS convention v<N> -> v<N+1>` (no trailing period; arrow is two ASCII characters `->`, not a Unicode arrow). This format is matched by tooling and SHOULD NOT vary.

`git add` SHALL be scoped to specific files this step touched. `git add -A` and `git add .` SHALL NOT be used, to avoid sweeping in unrelated work from concurrent agent sessions.

If verification fails for a step, the skill SHALL NOT commit; it SHALL instead surface the failure to the user along with `git diff` output for the staged-but-not-committed changes, and the user can decide whether to keep, amend, or discard.

#### Scenario: Multi-step migration produces multi commits
- **GIVEN** `<root>` is at v1 with a clean tree, `FS_CONVENTION_VERSION === 3`
- **WHEN** the user confirms and migration runs
- **THEN** after success, `git log --oneline` shows two new commits in order:
  - `chore(memon): migrate FS convention v1 -> v2`
  - `chore(memon): migrate FS convention v2 -> v3`
- **AND** `<root>/.memon/version.json` reports `fs_convention_version: 3`

#### Scenario: Each step's commit is self-contained
- **WHEN** the user inspects the diff of `chore(memon): migrate FS convention v1 -> v2`
- **THEN** the diff contains only files described as changed by `v1-to-v2.md` plus `.memon/version.json`
- **AND** the diff does NOT contain changes that belong to v2-to-v3

#### Scenario: Scoped staging prevents contamination
- **GIVEN** during the migration a parallel agent session creates an unrelated untracked file `scratch.txt` in `<root>` between two steps
- **WHEN** the second migration step commits
- **THEN** `scratch.txt` is NOT included in the commit
- **AND** `scratch.txt` remains as an untracked file in the working tree

#### Scenario: Verification failure pauses the run
- **GIVEN** during the v2-to-v3 step, the guide's verification command reports a failed grep
- **WHEN** the verification fails
- **THEN** the skill does NOT run `git commit`
- **AND** the skill surfaces the failed verification command's output and the staged diff to the user
- **AND** subsequent steps (if any) do NOT run
- **AND** `<root>/.memon/version.json` already reflects v3 in the staged-but-uncommitted diff (the user can choose to discard with `git restore --staged --worktree -- .` or amend manually)

### Requirement: Non-git project roots fall back to backup tarballs

If `<projectRoot>` is not a git repository (`git rev-parse --is-inside-work-tree` returns non-zero or "fatal: not a git repository"), the migration runtime SHALL switch to backup-tarball mode:

- The dirty-tree check is skipped (no git to query).
- Before each step's edits, the skill SHALL write `<projectRoot>/.memon/backups/pre-v<N+1>-<ISO8601-timestamp>.tar.gz` containing every file the step is about to modify, plus `.memon/version.json` itself.
- After applying the step's edits and running verification, the skill SHALL still update `.memon/version.json` and proceed to the next step. There is no commit.
- If any step's verification fails, the skill SHALL surface the failure and tell the user how to restore from the most recent backup tarball.

The skill SHALL NOT delete backup tarballs automatically. Garbage collection of `.memon/backups/` is the user's responsibility (a future iteration may add a `memon fs-version prune-backups` command).

#### Scenario: Non-git mode writes a tarball per step
- **GIVEN** `<root>` is not a git repo, currently at v1, `FS_CONVENTION_VERSION === 3`
- **WHEN** the user confirms migration
- **THEN** before the v1-to-v2 step's edits, `<root>/.memon/backups/pre-v2-<timestamp>.tar.gz` exists with the files the guide will modify
- **AND** before the v2-to-v3 step's edits, `<root>/.memon/backups/pre-v3-<timestamp>.tar.gz` similarly exists
- **AND** no `git commit` runs

#### Scenario: Non-git verification failure surfaces backup
- **GIVEN** during a non-git migration, v2-to-v3 verification fails
- **WHEN** the failure is reported
- **THEN** the user is told the path to `<root>/.memon/backups/pre-v3-<timestamp>.tar.gz` and instructed to extract it manually if they want to roll back

### Requirement: `memon-migrate-fs` skill orchestrates the protocol

A skill at `packages/skills/memon-migrate-fs/SKILL.md` SHALL exist with the following properties:

- **Frontmatter**: `disable-model-invocation: true` (user-invoked only — never auto-fired by an agent's heuristics).
- **Body language**: English (per repo convention); user-facing dialogue Chinese (embedded as block-quoted examples).
- **Workflow sections** in this order:
  1. **Read state**: read `.memon/version.json`, determine current and target versions.
  2. **Plan**: enumerate steps; verify all required guides exist.
  3. **Confirm with user**: present plan, wait for explicit confirmation.
  4. **Preflight**: clean-tree check (git mode) or skip (non-git mode).
  5. **Per-step loop**: for each step, read the guide, apply, verify, bump marker, commit (or tarball).
  6. **Final report**: summarise what changed, point user at the new `.memon/version.json`, link to the commits (git mode) or backups (non-git mode).
- **Anti-patterns** explicitly listed: never `git add -A`, never auto-stash, never skip user confirmation, never delete backups.

#### Scenario: Skill is user-invoked only
- **WHEN** a reader inspects `packages/skills/memon-migrate-fs/SKILL.md` frontmatter
- **THEN** it contains `disable-model-invocation: true`

#### Scenario: Body is English, examples are Chinese
- **WHEN** a reader samples 5 random headings and 10 random paragraphs from the SKILL body
- **THEN** all sampled text is in English
- **AND** the user-confirmation example prompts appear inside `>` block quotes in Chinese

#### Scenario: Anti-patterns enumerate the safety rules
- **WHEN** a reader inspects the SKILL's "Anti-patterns" section
- **THEN** it explicitly lists at minimum: "never `git add -A` / `git add .`", "never auto-stash on the user's behalf", "never skip user confirmation", "never delete `.memon/backups/`"

### Requirement: v3→v4 transform fills exp-side fields and migrates run-side archive sidecar

The `migrate-fs` runtime SHALL recognise `FS_CONVENTION_VERSION === 4` as the current version and SHALL apply the v3→v4 transform per `packages/core/migrations/v3-to-v4.md`. The transform SHALL be NOT a no-op — it walks both experiment docs and run dirs.

For each `docs/experiments/E*.md` file:
1. Parse the YAML frontmatter.
2. If `status:` is missing, insert `status: OPEN` (in canonical key order between `title` and `archived`); preserve any user-set value if present.
3. If `archived:` is missing, insert `archived: false` (in canonical key order between `status` and `runs`); preserve any user-set value if present.
4. If either field was inserted, atomically rewrite the doc and bump `updated_at` to the migration's ISO timestamp. If neither field changed (idempotent re-run), do not rewrite and do not bump `updated_at`.

For each run dir under the project's discovered roots:
1. Parse the run README's frontmatter.
2. If `archived:` is missing, compute `<derived> = exists('<runDir>/.archived')` and insert `archived: <derived>` (in canonical key order between `gpus` and `entry`); preserve any user-set value if present.
3. If `archived:` was inserted, atomically rewrite the README and bump `updated_at`.
4. After the README write succeeds AND the README's `archived` reflects the sidecar's prior signal, `unlink('<runDir>/.archived')` if the sidecar exists. The sidecar deletion is **strictly after** the README rewrite; if anything fails between, the sidecar remains and a re-run can retry idempotently.

The transform SHALL stamp `.memon/version.json` to `fs_convention_version: 4` after both walks succeed (and ONLY after both walks succeed). On any per-file failure within either walk, the transform SHALL surface the failure to the user without stamping the version (per the existing migration runtime's per-step protocol).

The transform SHALL preserve user-added custom frontmatter keys verbatim and SHALL NOT reorder existing keys (only insert the new ones in their canonical position).

#### Scenario: Migration writes status + archived on a v3 exp doc
- **GIVEN** a v3 exp doc whose frontmatter has `id`, `slug`, `title`, `runs`, `created_at`, `updated_at` (no `status` or `archived` keys)
- **WHEN** the v3→v4 migration runs against the project
- **THEN** the doc's frontmatter now has `status: OPEN` and `archived: false` inserted in their canonical positions
- **AND** the doc's `updated_at` is bumped to the migration's timestamp
- **AND** the doc's other fields are unchanged in value and order

#### Scenario: Migration converts run-side sidecar to frontmatter
- **GIVEN** a v3 run dir with README having no `archived` field AND `<runDir>/.archived` present
- **WHEN** the v3→v4 migration runs
- **THEN** the run README's frontmatter has `archived: true` inserted between `gpus` and `entry`
- **AND** the README's `updated_at` is bumped
- **AND** `<runDir>/.archived` no longer exists (`unlink`ed after the README write)

#### Scenario: Migration fills archived: false on non-archived run
- **GIVEN** a v3 run dir with README having no `archived` field AND no `<runDir>/.archived` sidecar
- **WHEN** the v3→v4 migration runs
- **THEN** the run README's frontmatter has `archived: false` inserted
- **AND** no sidecar deletion happens (none existed)

#### Scenario: Idempotent re-run is a no-op
- **GIVEN** a project where the v3→v4 migration has already run successfully
- **WHEN** the migration runs again
- **THEN** no exp doc is rewritten (all already have `status` and `archived`)
- **AND** no run README is rewritten
- **AND** the version stamp file shows `fs_convention_version: 4` (unchanged)
- **AND** no `updated_at` fields are bumped

#### Scenario: Custom frontmatter key preserved
- **GIVEN** a v3 exp doc whose frontmatter includes a custom user-added key like `wandb_project: "rad-ai"`
- **WHEN** the v3→v4 migration runs
- **THEN** the custom key is preserved verbatim in the migrated doc
- **AND** the new `status: OPEN` and `archived: false` keys are inserted in their canonical positions without disturbing the custom key

#### Scenario: Sidecar deletion fails but README write succeeded
- **GIVEN** a partial-failure scenario where the README rewrite committed `archived: true` but the subsequent `unlink('<runDir>/.archived')` failed
- **WHEN** the migration's per-step protocol completes
- **THEN** the version stamp is NOT bumped to 4 (since not all per-file work succeeded)
- **AND** the user is shown the per-file failure with instructions to clean up
- **AND** a subsequent re-run finds the README already has `archived: true` (skip the rewrite) and re-attempts the sidecar `unlink` (idempotent)

### Requirement: Semantic migrations may require staged per-item approval

When a migration guide declares staged semantic review, `memon-migrate-fs` SHALL generate candidates in a persistent gitignored staging directory and SHALL NOT mutate live data during drafting. It SHALL record source/staged hashes and per-item approval. Source changes invalidate approval. It SHALL publish only after every item is approved, final validation succeeds, and the user gives final confirmation. It SHALL update the global FS marker last.

#### Scenario: One unapproved experiment prevents publication
- **GIVEN** all but one staged Experiment are approved
- **WHEN** the migration is resumed
- **THEN** no live Experiment is replaced and the FS marker remains unchanged

#### Scenario: Source changes cannot bless an old candidate
- **GIVEN** an Experiment candidate was generated from a recorded source bundle
- **WHEN** its Experiment README or any referenced Run README changes
- **THEN** the old candidate becomes `STALE`
- **AND** it cannot be reapproved without starting new staging from the changed source

#### Scenario: Candidates fail before production copy
- **GIVEN** every candidate has an approval hash but one staged bundle fails validate or lint
- **WHEN** final publication is requested
- **THEN** isolated staged validation fails before any live file or backup is written
- **AND** the FS marker remains unchanged

### Requirement: Reviewed v6-to-v7 path migration
The v6-to-v7 migration SHALL provide a reusable batch planner, explicit apply and verifier. Planning SHALL be read-only and resolve legacy Experiment Run IDs to unique paths using a bounded one-time inventory. Missing targets, duplicate basename candidates, duplicate owners, ambiguous dependent references and contradictory or Run-only ownership claims SHALL block automatic application until explicit resolutions are reviewed. It SHALL never infer ownership solely from a legacy Run claim. A declared member directory that exists but has no `README.md` is not a blocker: the plan records a `MEMBER_README_MISSING` warning, keeps the declaration and leaves the directory untouched, since there is no Run field to strip. A declared path that is a symlink whose real path stays inside the project root is accepted and processed under its declared path without rewriting it to the target; a symlink whose real path escapes the project root remains a blocker. A file reachable through several accepted paths is planned once.

#### Scenario: Ambiguous legacy ID
- **WHEN** a legacy ID matches two Run directories
- **THEN** the plan reports candidate relative paths and apply refuses the unresolved plan without changing project files

#### Scenario: README-less declared member
- **WHEN** an Experiment declares an existing Run directory that has no `README.md`
- **THEN** the plan keeps the declaration, reports `MEMBER_README_MISSING` as a warning, plans no change for that directory and is not blocked by it

#### Scenario: Symlinked member path
- **WHEN** a declared Run path is a symlink resolving inside the project root
- **THEN** the plan accepts it under the declared path; if the symlink resolves outside the project root, the plan reports a blocker and reads nothing outside

#### Scenario: Run-only claim
- **WHEN** a Run claims an Experiment that does not list it
- **THEN** planning requires an explicit decision to amend the Experiment declaration or drop that claim before removing the Run field

### Requirement: Migration preserves data and recovers safely
Apply SHALL check reviewed source fingerprints, preserve unknown frontmatter and document bodies, back up touched files, and modify only planned membership/reference fields and FS metadata. Run outputs SHALL not be moved or traversed. Dirty worktrees SHALL be refused by default. An explicit operator approval MAY enable scoped dirty-tree apply with fingerprint checks and external backups; it SHALL NOT authorize staging unrelated pre-existing edits. Verification SHALL complete before publishing the v7 marker. Interrupted migrations SHALL support recovery without overwriting concurrent edits; fully applied verified plans SHALL be idempotent.

#### Scenario: Source changes after approval
- **WHEN** a planned file changes before apply
- **THEN** apply rejects the stale plan without overwriting the edit or advancing the FS marker

#### Scenario: Partial apply recovery
- **WHEN** a migration is interrupted after some file writes
- **THEN** recovery uses recorded preimages/postimages and refuses to overwrite files edited since those writes

### Requirement: Consecutive guide and version gate
The migration SHALL ship `v6-to-v7.md` using the seven-section guide contract, all four canonical edge cases and exact Git message `chore(memon): migrate FS convention v6 -> v7`. FS convention 7 SHALL correspond to application release Major 7, initially 7.0.0. Version mismatches SHALL be intercepted at exactly the two existing detection points — skill preflight and `memon fs-version check` (including its use by `memon install-skills`) — and ordinary CLI, Backend and Web write paths SHALL NOT read the marker. Reads SHALL never auto-migrate data, and no writer SHALL advance the marker outside the reviewed migration.

Staged rollout: An explicitly approved data-only migration MAY use `--keep-version` to apply the membership conversion while preserving the v6 marker byte-for-byte. Readers and writers SHALL support this state. Verification SHALL check the actual data format separately from the release marker. Final v7 release and marker advancement wait until all planned migrations are ready; this step SHALL NOT trigger an automatic release or claim unrelated migrations passed.

#### Scenario: Old project opened by new tooling
- **WHEN** a v7 skill or `memon fs-version check` runs against a project whose marker is 6
- **THEN** the check reports `behind`, the skill stops before any spec-file write and recommends the reviewed migration, and no project file changes

#### Scenario: Direct writer on a v6 project
- **WHEN** a v7 CLI, Backend or Web mutation runs directly against a v6 project
- **THEN** it does not consult the marker and writes only canonical v7 forms (project-relative `runs` paths, no Run `experiment` field), which v6 readers of the prepared data already accept
