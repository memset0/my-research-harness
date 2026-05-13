# v3 → v4 migration

## Background / Why

memon `FS_CONVENTION_VERSION` bumped from `3` to `4` to introduce
**human-managed lifecycle frontmatter** on both run READMEs and
experiment docs. The motivating change is `lifecycle-frontmatter-v4`
(see `openspec/changes/lifecycle-frontmatter-v4/`).

In v4:

- The run-status enum gains a sixth value `INTERRUPTED`, written only on
  explicit human action ("kill this run, I changed my mind"). Old
  `FAILED` callers that meant "I stopped this on purpose" should be
  re-typed as `INTERRUPTED` going forward; existing v3 READMEs are NOT
  retyped by this migration (the user's intent isn't recoverable from a
  past `FAILED`).
- The experiment-doc frontmatter gains a required `status:
  ExperimentStatus` field with values `OPEN` / `RESOLVED` /
  `ABANDONED`. Default `OPEN`. Same human-only write semantics.
- Both run READMEs and exp docs gain a required `archived: boolean`
  field. The legacy `<runDir>/.archived` sidecar mechanism is
  deprecated; the migration converts each existing sidecar into
  `archived: true` on the corresponding README and unlinks the sidecar.
  Exp-side archive is new (v3 had no exp-doc archive concept).

The migration is **deterministic**: no clustering, no user-confirm
loop, no judgement required. Every existing exp doc gets `status:
OPEN, archived: false` if missing; every existing run README gets
`archived: <derived>` where `<derived>` is true iff a sidecar was
present. Re-running the migration on already-migrated content is a
no-op.

## Detection

The migrate-fs runtime confirms the project is in v3 state via these
literal checks (each SHALL be a runnable shell snippet that exits 0
when the condition holds):

- Version stamp present and at v3:
  `jq -r .fs_convention_version <projectRoot>/.memon/version.json | grep -q '^3$' && echo OK`
- At least one experiment doc exists OR at least one run dir matches
  the regex (skip the migration silently when neither exists):
  `find <projectRoot>/docs/experiments -maxdepth 1 -name 'E*-*.md' 2>/dev/null | head -1 | grep -q . || \
   find <projectRoot> -type d -regex '.*-[0-9]\{6\}-[0-9]\{6\}' 2>/dev/null | head -1 | grep -q . && echo OK`
- For at least one exp doc, the frontmatter lacks the `status:` key
  (sanity check that we haven't already migrated):
  `find <projectRoot>/docs/experiments -name 'E*-*.md' -print -quit | xargs -I {} sh -c \
   'awk "/^---$/{n++;next} n==1" {} | grep -q "^status:" && echo "v4 already" || echo "v3"'`

If any check unexpectedly fails the runtime SHALL surface the failure
and abort before any write.

## Diff (v3 → v4)

### File 1: `<projectRoot>/<...>/<runDir>/README.md`

**before** (v3):

```yaml
---
id: foo-260513-100000
name: foo
status: FINISHED
experiment: E0001-zero-snr
created_at: '2026-05-13T10:00:00+08:00'
updated_at: '2026-05-13T11:00:00+08:00'
finished_at: '2026-05-13T11:00:00+08:00'
host: gpu-04
pid: null
gpus: [0, 1]
entry: ./run.sh
command: bash run.sh
wandb: null
---

## Setup
…
```

**after** (v4):

```yaml
---
id: foo-260513-100000
name: foo
status: FINISHED
experiment: E0001-zero-snr
created_at: '2026-05-13T10:00:00+08:00'
updated_at: '<migration timestamp>'
finished_at: '2026-05-13T11:00:00+08:00'
host: gpu-04
pid: null
gpus: [0, 1]
archived: false
entry: ./run.sh
command: bash run.sh
wandb: null
---

## Setup
…
```

The new `archived: <bool>` line is inserted between `gpus:` and
`entry:` (the canonical v4 key order). When the run dir contained a
`<runDir>/.archived` sidecar pre-migration, the line reads `archived:
true` and the sidecar is unlinked AFTER the README write succeeds.

`updated_at` is bumped only when the README actually changed (i.e. the
field was missing). Idempotent re-runs do NOT bump.

### File 2: `<projectRoot>/<runDir>/.archived` (legacy sidecar)

**before** (v3): zero-byte sidecar file present iff the run was
archived.

**after** (v4): file removed. The archive state lives in the
README's frontmatter only.

### File 3: `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md`

**before** (v3):

```yaml
---
id: E0001-zero-snr
slug: zero-snr
title: Zero SNR study
runs: [foo-260513-100000]
hypotheses: []
tags: []
created_at: '2026-05-13T08:00:00+08:00'
updated_at: '2026-05-13T08:00:00+08:00'
---
```

**after** (v4):

```yaml
---
id: E0001-zero-snr
slug: zero-snr
title: Zero SNR study
status: OPEN
archived: false
runs: [foo-260513-100000]
hypotheses: []
tags: []
created_at: '2026-05-13T08:00:00+08:00'
updated_at: '<migration timestamp>'
---
```

`status:` and `archived:` are inserted after `title:`, in canonical key
order. Existing values (e.g. user hand-edited `status: RESOLVED`
already) are preserved verbatim.

### File 4: `<projectRoot>/.memon/version.json`

**before** (v3):

```json
{
  "fs_convention_version": 3,
  "installed_at": "<unchanged>",
  "last_migrated_at": "<previous migration time>"
}
```

**after** (v4):

```json
{
  "fs_convention_version": 4,
  "installed_at": "<unchanged>",
  "last_migrated_at": "<this migration's timestamp>"
}
```

## Target State (v4 Summary)

The migration completes when:

- Every `docs/experiments/E*-*.md` frontmatter has both `status` (a
  member of `OPEN | RESOLVED | ABANDONED`) and `archived` (boolean).
- Every run README under each project root has `archived` (boolean) in
  frontmatter, in canonical position (between `gpus` and `entry`).
- No `<runDir>/.archived` sidecar files exist anywhere under any
  project root.
- `.memon/version.json` reports `fs_convention_version: 4` with
  `last_migrated_at` set to the migration's ISO8601 timestamp.

## Verification

```bash
# Run all checks. Each SHALL print OK on success and exit non-zero on failure.

# 1. Version stamp at v4.
jq -r .fs_convention_version <projectRoot>/.memon/version.json | grep -q '^4$' && echo OK

# 2. Every exp doc has status + archived in frontmatter.
find <projectRoot>/docs/experiments -name 'E*-*.md' -print0 2>/dev/null | \
  xargs -0 -I {} sh -c 'awk "/^---$/{n++;next} n==1" {} | grep -q "^status:" && \
                         awk "/^---$/{n++;next} n==1" {} | grep -q "^archived:" || \
                         (echo "MISSING status/archived in {}"; exit 1)' && echo OK

# 3. Every run README has archived in frontmatter.
find <projectRoot> -type d -regex '.*-[0-9]\{6\}-[0-9]\{6\}' 2>/dev/null | \
  xargs -I {} sh -c '[ -f {}/README.md ] && \
                      awk "/^---$/{n++;next} n==1" {}/README.md | grep -q "^archived:" || \
                      (echo "MISSING archived in {}/README.md"; exit 1)' && echo OK

# 4. No legacy .archived sidecar files anywhere.
find <projectRoot> -name '.archived' -type f 2>/dev/null | grep -q . && \
  (echo "Legacy .archived sidecar still present"; exit 1) || echo OK
```

## Rollback Notes

If the migration fails partway, the user can recover by:

1. **Git mode**: `git restore --staged --worktree -- .` to discard the
   staged-but-uncommitted changes from the failed step. The expected
   commit message for the migration is the literal string
   `chore(memon): migrate FS convention v3 -> v4` (no body, no
   trailing period; the arrow is two ASCII characters `->`, NOT a
   Unicode arrow).
2. **Non-git mode**: extract the most recent backup tarball at
   `<projectRoot>/.memon/backups/pre-v4-<timestamp>.tar.gz`.

Manual recovery from a partial state (e.g. some sidecars deleted but
`.memon/version.json` not stamped to 4): re-running the migration is
safe — it's idempotent. The runtime detects already-migrated files
and skips them.

## Edge Cases

- **Missing `docs/experiments/` directory**: skip the exp-side step
  silently. The run-side step still runs (sidecar→frontmatter) and
  the version stamp still bumps.
- **User-added custom frontmatter fields**: preserve verbatim. The
  migration only inserts the new keys (`status`, `archived`) in their
  canonical positions; it does NOT reorder existing keys or touch
  any user-added field.
- **User mid-edit (working tree dirty)**: the runtime per
  `fs-migration-runtime/spec.md` refuses to start the migration
  unless the git working tree is clean. This is enforced upstream of
  this guide; the guide itself does not need to handle dirty trees.
- **Concurrent migrations**: not the migration's problem. The user is
  responsible for not running `memon-migrate-fs` twice in parallel
  against the same project root. The tool does not lock; if you do
  invoke it twice, you may get duplicate `[ARCHIVE]` JOURNAL events
  and a noisy git diff. A brief warning to that effect is sufficient.
- **Run README has `archived:` already (from a prior partial migration
  attempt)**: the rewrite is a no-op (no `updated_at` bump). The
  sidecar — if also present — is still unlinked because the
  README + sidecar coexisting state is the inconsistency the migration
  resolves.
- **Exp doc has `status:` set to a non-canonical value (e.g. user
  typo)**: the parser's `normalizeExperimentStatus` defaults the
  in-memory value to `OPEN` and surfaces a parse error. The migration
  treats the field as missing and overwrites it to `OPEN` in the
  re-serialized output. The user sees a one-line warning in the
  migration report.
