# fs-migration-runtime Specification

## Purpose
TBD - created by archiving change fs-convention-migration-system. Update Purpose after archive.
## Requirements
### Requirement: Two detection points for version mismatch

A project root's FS convention version SHALL be checked against `FS_CONVENTION_VERSION` at exactly two points:

1. **At `memon install-skills` time.** Whenever the command runs, after writing the skill files, it SHALL read `.memon/version.json` (creating it on first install per `fs-version-tracking`), compare to `FS_CONVENTION_VERSION`, and surface mismatch in the output.
2. **At skill preflight time.** Every memon skill that reads or writes a spec file (the project root's `README.md`, `HYPOTHESES.md`, `JOURNAL.md`, or anything under `<projectRoot>/docs/digests/` or `<projectRoot>/docs/reports/`) SHALL invoke `memon fs-version check --project-root <p>` as the first executable step in its workflow body and branch on the result.

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

