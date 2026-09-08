---
name: memon-migrate-fs
description: Upgrade a memon project's on-disk FS convention by following each shipped migration guide and conversion script. Use only when the user explicitly asks to migrate; for review-required semantic upgrades such as v5 to v6, stage every Experiment, iterate with the user, record per-Experiment approval and hashes, and publish only after all candidates receive final approval.
disable-model-invocation: true
---

# memon-migrate-fs

The only skill allowed to update `.memon/version.json`, and the only one exempt
from the FS-version preflight — resolving a mismatch is its purpose. Never run
autonomously. The CLI issue handoff in `../PREFLIGHT.md` still applies.

## Determine the migration chain

```sh
memon --project-root . --format json fs-version check
```

- `match`: report that nothing is needed and stop.
- `uninitialised`: ask the user to install memon first; stop.
- `ahead`: never downgrade; ask the user to upgrade memon.
- `behind`: enumerate every `vN-to-vN+1` guide through the target.

Read every guide completely before writing. Each declares whether it is a
mechanical step or a review-required semantic migration and names its
deterministic conversion scripts; a missing guide or script is fatal.

Present the full chain and wait for explicit confirmation. A request that
triggered some other skill is not migration consent.

## Git and local staging preflight

For Git projects, require a clean tracked and untracked working tree. Never
auto-stash or discard work: show dirty paths and stop.

Keep review candidates local:

```text
.memon/migrations/v<N>-to-v<N+1>/<migration-id>/
├── state.yaml
├── live-backup/
└── experiments/
```

Add `.memon/migrations/` to `.git/info/exclude` if it is not already ignored;
do not touch the tracked `.gitignore` for migration state, and never commit
staging.

`state.yaml` records at least:

```yaml
schema_version: 1
migration: v5-to-v6
migration_id: 20260810T120000Z
published_at: null
experiments:
  E0001-example:
    status: APPROVED
    source_paths:
      - docs/experiments/E0001-example/README.md
      - logs/baseline-260810-120000/README.md
    source_hash: <combined hash of Experiment and referenced Run records>
    staged_hash: <hash of candidate bundle>
    approved_at: <ISO8601 with offset>
    stale_reason: null
```

Per-Experiment states are `DRAFT`, `APPROVED`, `STALE`, `PUBLISHED`. A missing
or ambiguous referenced Run record is a blocking source error. The directory and
state survive conversation boundaries: resume an existing matching migration
instead of starting a second candidate set.

## Mechanical step

For a guide explicitly marked mechanical:

1. Run its conversion script in `--check`/dry-run mode.
2. Show the planned file changes and request the guide-required confirmation.
3. Create a backup.
4. Run the deterministic, idempotent conversion.
5. Run every verification command from the guide.
6. Update the FS marker only after verification succeeds.
7. Submit the converted Experiment and wiki paths with `journal submit --files`
   (scope rules as in the publication step).
8. In Git mode, commit only explicit touched paths with the guide's fixed
   migration commit message.

Never improvise a semantic rewrite under this shorter path.

## Review-required semantic step

v5→v6 uses this workflow; any future guide may opt in.

### 1. Stage one Experiment at a time

Hash its complete source bundle as `source_hash`. Read every legacy section and
related Run record — unsupported or unknown headings are evidence, not
disposable errors, and rich legacy Run documents stay as they are unless the
guide converts them. Generate a complete target candidate **only** under
staging (canonical `README.md`, the three YAML files, any guide-required files)
using the current `memon-write-experiment-doc` schema/routing contract in
staging mode, never touching production. Run the guide's staging validator and
YAML conversion checks, then render Implementation, Investigation and Results
and show the README diff with diagnostics.

The Agent performs the semantic reconstruction — legacy coding tasks into
Implementation, experimental work into Investigation, retries grouped into
Variants, Results columns chosen, facts separated from Findings and Conclusion.
Do not pretend that classification is lossless.

### 2. Iterate until the user approves

Accept feedback on missing or misclassified work, wrong hierarchy or dependency,
wrong Variant grouping or selected Run, a needed column or enum option,
inaccurate Findings/Limitations/Conclusion, and legacy content that must stay
visible. Modify only the staged candidate, rerun validation and rendering, show
the new diff — no retry limit. On explicit approval record `staged_hash`,
`source_hash`, `approved_at`, set `APPROVED`; approval covers only those bytes.

### 3. Invalidate stale approvals

Before moving to another Experiment and again before publication, recompute
every approved source and staged hash. Differing candidate bytes → `STALE`,
rerun checks, re-approve the new bytes. Differing source bytes → start a new
staging migration from the new source and repeat review. Never carry approval
across changed bytes.

### 4. Require all approvals and final confirmation

Never partially publish. Continue until every Experiment is `APPROVED`, all
candidates validate, all cross-Experiment references validate, and all hashes
still match. Show a final summary of every Experiment, changed file, unresolved
diagnostic, and source/staged hash, then ask for one explicit publication
confirmation. Until it arrives: production files untouched, FS marker unchanged,
no commit.

### 5. Publish as one guarded operation

1. Recheck the Git tree and all hashes.
2. Project every approved candidate into an isolated validation root and run
   YAML validation, bundle lint, cross-reference checks, and all managed-section
   renders before touching production.
3. Copy current production files into the staging backup directory.
4. Promote every approved candidate with the guide's atomic publication
   script/rename strategy.
5. Repeat per-file validation, bundle lint, cross-reference checks, CLI
   rendering, and guide verification across the production tree.
6. On failure, restore from backup, leave the FS marker at its old version, and
   report.
7. Only after all production checks and state writes pass, atomically update
   `.memon/version.json` (`fs_convention_version`, `last_migrated_at`).
8. Re-run the version check and final smoke tests.
9. Submit the published paths with `journal submit --files` (`../PREFLIGHT.md`):
   guide-listed production paths under `docs/experiments/E<NNNN>-<slug>/` and
   `docs/wiki/`, nothing else — the FS marker, `.memon/migrations/`, Run records
   and `docs/hypotheses.md` are outside its scope. Batch per Experiment. A
   rejected submission never rolls back a verified migration: keep the files and
   report the unrecorded paths with the command and error.
10. In Git mode, stage only guide-listed production paths and the marker, then
    create the fixed migration commit.

The FS marker is the final write, never a promise to fix incomplete files later.

## YAML schema upgrades

Every YAML schema change is governed by an FS convention step whose guide ships
a deterministic conversion script: idempotent, dry-run capable, explicit about
source and target `schema_version`, comment/order/unknown-field preserving where
possible, atomic per file, and validated across every Experiment before the
global marker changes. Where semantic judgment is required the script builds the
mechanical skeleton and the review workflow handles meaning. Never upgrade YAML
silently while reading it.

## Final report

Report the version chain, approved/published Experiment count, verification
results, the `journal submit` invocation id(s) or the paths left unrecorded and
why, migration commit(s) or non-Git backup paths, and the retained staging path.
Do not delete staging automatically; it is the audit record until the user
removes it.

## Guardrails

- Never skip explicit start confirmation or final publication confirmation.
- Never edit production Experiment files during staged review.
- Never publish a subset of a review-required migration.
- Never accept changed source/candidate bytes under an old approval.
- Never bump the marker before successful production verification.
- Never use `git add .` or `git add -A`.
- Never auto-stash, reset, discard, or delete user work.
- Never commit `.memon/migrations/`.
- Never infer that parser success means a semantic migration is correct.
- Never rewrite, relocate, or delete a legacy `docs/journal.md`; leave it
  byte-for-byte as history this migration does not own.
- Never rewrite a legacy Run record into the minimal shape, or convert
  execution status into deprecation, as a side effect of migration.
- Never read a Journal file as migration input, and never let a failed Journal
  submission trigger a rollback of a verified migration.
