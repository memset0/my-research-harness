# v1 → v2 migration

## Background / Why

memon `FS_CONVENTION_VERSION` bumped from `1` to `2` to relocate two project-root files into the `docs/` subdirectory and lowercase their filenames so the on-disk layout becomes uniform with the rest of the long-form artefacts (reports, digests). The two files affected are `JOURNAL.md` and `HYPOTHESES.md`.

The motivating openspec change is `fs-v2-relocate-journal-hypotheses` (see `openspec/changes/archive/`). All memon code paths that read or write these files now expect the v2 paths; v1 projects MUST migrate before memon will operate on them.

This guide is the contract that `memon-migrate-fs` consumes for the v1 → v2 step. It is mandatory; if it is missing the runtime aborts (per `openspec/specs/fs-migration-runtime/spec.md`).

## Detection

Run each of the following from `<projectRoot>`. ALL of these conditions SHALL be true for a v1 project root:

- `test -f "$PROJECT_ROOT/JOURNAL.md" && echo OK` — legacy journal at the root.
- `test -f "$PROJECT_ROOT/HYPOTHESES.md" && echo OK` — legacy hypotheses at the root.
- `test ! -e "$PROJECT_ROOT/docs/journal.md" && echo OK` — v2 journal path does NOT yet exist.
- `test ! -e "$PROJECT_ROOT/docs/hypotheses.md" && echo OK` — v2 hypotheses path does NOT yet exist.
- `jq -r '.fs_convention_version' "$PROJECT_ROOT/.memon/version.json" | grep -qx 1 && echo OK` — version marker still says `1`.

If any of the four file checks fail (for example, a project that has only `JOURNAL.md` but no `HYPOTHESES.md`), proceed step-by-step: skip the missing-file diff for that file. See the `## Edge Cases` section.

## Diff (v1 → v2)

### File 1: project journal

before:

```text
<projectRoot>/JOURNAL.md
```

after:

```text
<projectRoot>/docs/journal.md
```

The file's content (frontmatter + event lines) is preserved byte-for-byte; only the path and filename change. The `last_digest_at` frontmatter block, every `[STATUS]` / `[NOTE]` / `[DIGEST]` line, and any user-added prose between events SHALL appear unchanged in the new file.

### File 2: project hypotheses

before:

```text
<projectRoot>/HYPOTHESES.md
```

after:

```text
<projectRoot>/docs/hypotheses.md
```

The file's content is preserved byte-for-byte; only the path and filename change. Every `## H<NNNN>. <slug>` section, the bullet items inside it, and any user-added prose SHALL appear unchanged in the new file.

### Filesystem prerequisite

If `<projectRoot>/docs/` does not exist, create it (`mkdir -p`) before moving files. The `docs/` directory may already hold `reports/` and `digests/` subdirectories from earlier work; they are unaffected.

## Target State (v2 Summary)

After a successful v1 → v2 migration, the project root SHALL look like this:

```
<projectRoot>/
  docs/
    journal.md          # was JOURNAL.md at root
    hypotheses.md       # was HYPOTHESES.md at root
    reports/            # unchanged (if present pre-migration)
    digests/            # unchanged (if present pre-migration)
  experiments/          # unchanged
  .memon/version.json   # fs_convention_version: 2
  config.yml            # unchanged
  …                     # any other user files unchanged
```

Specifically:

- `<projectRoot>/JOURNAL.md` does NOT exist.
- `<projectRoot>/HYPOTHESES.md` does NOT exist.
- `<projectRoot>/docs/journal.md` exists with the original journal content.
- `<projectRoot>/docs/hypotheses.md` exists with the original hypotheses content.
- `<projectRoot>/.memon/version.json` reports `fs_convention_version: 2` with `last_migrated_at` set to the ISO8601-with-offset timestamp of this migration step.

## Verification

```bash
# Each successful check prints OK; any non-zero exit aborts the migration.

# v1 paths are gone
test ! -e "$PROJECT_ROOT/JOURNAL.md" && echo OK
test ! -e "$PROJECT_ROOT/HYPOTHESES.md" && echo OK

# v2 paths exist
test -f "$PROJECT_ROOT/docs/journal.md" && echo OK
test -f "$PROJECT_ROOT/docs/hypotheses.md" && echo OK

# Journal frontmatter preserved (last_digest_at line is intact)
grep -q '^last_digest_at:' "$PROJECT_ROOT/docs/journal.md" && echo OK

# Hypotheses heading shape preserved (at least one H<NNNN>. section, or empty file)
grep -qE '^## H[0-9]{4}\.|^$' "$PROJECT_ROOT/docs/hypotheses.md" && echo OK

# Version marker advanced to 2
jq -r '.fs_convention_version' "$PROJECT_ROOT/.memon/version.json" | grep -qx 2 && echo OK

# last_migrated_at is non-null
jq -e '.last_migrated_at != null' "$PROJECT_ROOT/.memon/version.json" > /dev/null && echo OK
```

## Rollback Notes

If the migration aborts mid-step, the user has two recovery paths depending on whether the project root is a git repository:

- **Git mode** (project root is a git working tree): `git revert HEAD` undoes the just-committed migration step. The runtime's per-step protocol commits each step separately with the literal message `chore(memon): migrate FS convention v1 -> v2` (ASCII arrow, no body, no trailing period), so reverting that single commit restores the v1 layout exactly.
- **Non-git mode**: the runtime takes a tarball snapshot under `<projectRoot>/.memon/backup/` before each step. Extract the tarball back into `<projectRoot>` to restore the v1 state.

Tell the user: "v1 → v2 migration aborted. To roll back, run `git revert HEAD` (in git mode) or extract `<projectRoot>/.memon/backup/<latest>.tar.gz` (non-git mode), then investigate the failure before retrying."

## Edge Cases

- **Missing required file** — `<projectRoot>/JOURNAL.md` or `<projectRoot>/HYPOTHESES.md` does not exist. Handling: skip the corresponding move; do NOT create an empty placeholder. Confirm in the verification block by changing the matching `test -f` to `test ! -e` for the missing file's v1 path AND the missing file's v2 path. The migration still bumps `.memon/version.json` to v2 even with one or both files absent — a v2 project is allowed to have no journal and no hypotheses (the relevant readers' "no file" branch handles both).

- **User-added custom frontmatter fields** — the project's `JOURNAL.md` or `HYPOTHESES.md` has frontmatter keys not part of memon's documented schema. Handling: PRESERVE the entire frontmatter block byte-for-byte during the move. Custom keys SHALL appear unchanged in the new file. The migration only renames the path; it does NOT parse or rewrite frontmatter.

- **User mid-edit (working tree dirty)** — the project root has uncommitted changes when the user invokes `memon-migrate-fs`. Handling: this is enforced at the runtime level. Per `openspec/specs/fs-migration-runtime/spec.md` ("Working tree must be clean before migration begins (git mode)"), the runtime SHALL refuse to begin migration with a dirty tree and SHALL NOT delegate this check to individual guides. This guide assumes a clean tree.

- **Concurrent migration** — two `memon-migrate-fs` invocations against the same project root at once. Handling: the tool does NOT lock. Concurrent invocations are the user's problem; if a second invocation observes a half-migrated state (e.g. `docs/journal.md` exists but `JOURNAL.md` also still exists), it MAY refuse with an error and instruct the user to roll back to a known-good state and retry serially.

- **`docs/` already exists with reports/digests** — common case for projects that have already been writing reports or digests under `docs/`. Handling: not an edge case; the migration uses `mkdir -p` (idempotent), then moves the two files into `docs/`. Existing subdirectories under `docs/` are untouched.

- **Filesystem case-insensitivity (macOS HFS+ default)** — on a case-insensitive filesystem the user might already have a lowercase `journal.md` at the root or under `docs/` that conflicts with the move. Handling: the runtime SHALL refuse to overwrite an existing destination file. If `docs/journal.md` or `docs/hypotheses.md` exists pre-migration, abort with an error naming the conflict; the user resolves it (rename or remove the conflicting file) before retrying.
