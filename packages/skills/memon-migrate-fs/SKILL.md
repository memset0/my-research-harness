---
name: memon-migrate-fs
description: Upgrade a project root's on-disk layout from one FS convention version to the next by reading natural-language migration guides (`packages/core/migrations/v<N>-to-v<N+1>.md`) and applying them step-by-step. Run when `memon install-skills` or any other memon skill reports `fs-version: behind`. Never auto-fires; user must invoke explicitly and confirm before any filesystem mutation.
argument-hint: <usually empty; reads .memon/version.json and target version from FS_CONVENTION_VERSION>
disable-model-invocation: true
license: MIT
metadata:
  author: memset0
  version: "0.1.0"
---

# memon-migrate-fs

This is the **only** skill that bumps `<projectRoot>/.memon/version.json`'s
`fs_convention_version` field. It reads natural-language migration guides
shipped under `packages/core/migrations/v<N>-to-v<N+1>.md` and applies them
sequentially, with a `git commit` boundary between every step (or a backup
tarball when the project root isn't a git repo).

This skill is exempt from the standard FS-version preflight that other
memon-* skills run — it IS the migration runtime. It reads
`.memon/version.json` directly as part of its own state-determination
step.

## When to use

- `memon install-skills` reported `fsVersion.status: "behind"` and printed a
  banner recommending you run this skill.
- Another memon-* skill refused to run with a "project FS convention is at
  v<X>; tool expects v<Y>" message.
- The user explicitly asked to upgrade the project's on-disk layout.

## When NOT to use

- ❌ The user just wants to add a journal entry / write a README — version
  mismatch is a precondition, not a goal in itself. Surface the gap, get
  user confirmation, *then* run this skill.
- ❌ `fsVersion.status: "ahead"` (project is newer than this memon). This
  skill does NOT downgrade. Tell the user to upgrade memon instead.
- ❌ Working tree has uncommitted changes (in a git repo). Refuse and ask
  the user to commit / stash / discard first. Do NOT auto-stash.

## Workflow

### 1. Read state

```sh
# Always pass --project-root . explicitly (project convention).
memon fs-version check --project-root . --format json
```

Parse the JSON. Branch on `status`:

- `match` → tell the user "already up to date, nothing to do" and stop.
- `uninitialised` → tell the user "this project root has not had memon
  installed yet; run `memon install-skills --project-root .` first" and
  stop.
- `ahead` → forward the `MEMON_TOO_OLD` error to the user and stop. Do
  not attempt downgrade.
- `behind` → continue.

Capture `currentVersion = $current` and `targetVersion = $available`.

### 2. Plan

Enumerate every step from `currentVersion` to `targetVersion - 1`. For each
step `v<X>→v<X+1>`, verify that `packages/core/migrations/v<X>-to-v<X+1>.md`
exists in the installed memon. If any guide is missing, abort with an
error listing the missing guide(s) — do NOT proceed.

```sh
# Resolve the migrations dir. The CLI doesn't expose it directly; resolve
# from the @memon/core package or the bundled skills source. In Claude
# Code, typically the project's checked-out memon repo at
# packages/core/migrations/.
ls packages/core/migrations/v${X}-to-v$((X+1)).md
```

### 3. Confirm with user

Present the plan in plain language and wait for explicit confirmation.
Embed the prompt as user-facing dialogue (Chinese):

> 当前 project root 的 FS 约定版本是 v${currentVersion}，工具要求 v${targetVersion}。我会运行 ${N} 个迁移步骤：v${currentVersion}→v${currentVersion+1}, ..., v${targetVersion-1}→v${targetVersion}。是否确认开始迁移？(y/N)

Only on affirmative response (`y` / `yes`) does the migration proceed.
Any other answer (including silence / decline) means stop without writing
anything to disk.

A user message that triggered the agent for some other reason (e.g. "add a
journal entry") MUST NEVER be treated as implicit consent. The
confirmation step is mandatory.

### 4. Preflight — clean tree (git mode) or fallback detection

```sh
# Detect git mode.
if git -C . rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_MODE=1
else
  GIT_MODE=0
fi
```

If `GIT_MODE=1`:

```sh
# Refuse if working tree is dirty (modified, staged, or untracked).
status=$(git -C . status --porcelain)
if [ -n "$status" ]; then
  echo "Working tree is dirty; refuse to migrate." >&2
  echo "$status" >&2
  exit 1
fi
```

If working tree is dirty, surface the offending files to the user and tell
them to commit / stash / discard before retrying. Do NOT auto-stash.

If `GIT_MODE=0` (project root is not a git repo), prepare the backup
directory:

```sh
mkdir -p .memon/backups
```

### 5. Per-step loop

For each step `v<X>→v<X+1>` from `currentVersion` to `targetVersion - 1`:

```sh
# Read the guide.
GUIDE=packages/core/migrations/v${X}-to-v$((X+1)).md

# Apply the changes described in the guide. The guide will list the exact
# files to read/edit. Do exactly what it says — no improvisation.

# Run the verification commands from the guide's `## Verification`
# section. Every command must exit 0. If any fail, abort: surface the
# failure and the staged diff, stop the loop. Do NOT commit.

# Bump the marker. Read the existing record, change the version + set
# last_migrated_at to the current ISO8601-with-offset timestamp, write
# atomically. Use a small helper script or inline jq/python:
NOW=$(date +%Y-%m-%dT%H:%M:%S%:z)
python3 -c "
import json, sys
p = '.memon/version.json'
with open(p) as f: r = json.load(f)
r['fs_convention_version'] = $((X+1))
r['last_migrated_at'] = '$NOW'
import os
tmp = p + '.tmp'
with open(tmp, 'w') as f: json.dump(r, f, indent=2); f.write('\n')
os.rename(tmp, p)
"

if [ "$GIT_MODE" = "1" ]; then
  # Stage ONLY files this step touched (read from the guide's file list)
  # plus the marker. Never `git add -A` / `git add .` — parallel agent
  # sessions may have unrelated dirty files.
  git -C . add -- <files-this-step-touched> .memon/version.json
  git -C . commit -m "chore(memon): migrate FS convention v${X} -> v$((X+1))"
else
  # Non-git mode: snapshot the touched files into a tarball BEFORE the
  # next step so the user has a rollback artifact. Use the guide's file
  # list. Tarball name uses the next version (post-step state).
  tar -czf ".memon/backups/post-v$((X+1))-${NOW}.tar.gz" .memon/version.json <files-this-step-touched>
fi
```

The commit message is **fixed**: `chore(memon): migrate FS convention v<X> -> v<X+1>`. ASCII arrow `->`, not Unicode `→`. No body, no trailing period. Tooling may grep for this format.

### 6. Final report

Tell the user:

- How many steps ran successfully.
- The final `fs_convention_version` value (verify by reading the marker
  one more time).
- Either the list of new git commits (`git log --oneline -n <N>`) or the
  list of backup tarballs created.

> 迁移完成。从 v${currentVersion} 升级到 v${targetVersion}。
> 共 ${N} 步：
> - v1 → v2 (commit abcd123)
> - v2 → v3 (commit efgh456)
> 已写入 `.memon/version.json`。如需回退，可用 `git reset --hard HEAD~${N}`。

## Anti-patterns

- ❌ **Never `git add -A` / `git add .`** — these sweep in unrelated dirty
  files from concurrent agent sessions, contaminating the migration
  commit. Always stage explicitly with `git add -- <paths>`.
- ❌ **Never auto-stash on the user's behalf** — if the working tree is
  dirty, refuse and ask the user. Stashing silently can hide work the user
  was actively doing.
- ❌ **Never skip the user-confirmation step** — even if the gap is small
  (e.g. v1→v2). The user must say "yes" before any filesystem write.
- ❌ **Never delete `.memon/backups/`** — those tarballs are the user's
  rollback artifact in non-git mode. Garbage collection is the user's
  responsibility (a future `memon fs-version prune-backups` may help).
- ❌ **Never apply more than one step's changes before committing** —
  each step has its own commit so the user can `git reset --hard HEAD~1`
  to undo just the most recent step. Batching steps into one commit
  defeats the rollback boundary.
- ❌ **Never improvise outside what the guide says** — the migration guide
  is the contract. If the guide is missing or incomplete, abort and report
  the gap; do not "fill in" what you think it should say.
- ❌ **Never edit `.memon/version.json` by hand** without going through
  the read-modify-write cycle above. If the schema validator rejects
  your write, fix the input — do not bypass it.

## Errors

| exit | meaning |
|---|---|
| 0  | success |
| 1  | generic failure (working tree dirty, missing guide, verification failed) |
| 11 | MEMON_TOO_OLD — the project root is newer than the running memon; tell user to upgrade memon |
