---
name: memon-migrate-fs
description: Upgrade a memon project's on-disk FS convention by following each shipped migration guide and conversion script. Use only when the user explicitly asks to migrate; for review-required semantic upgrades such as v5 to v6, stage every Experiment, iterate with the user, record per-Experiment approval and hashes, and publish only after all candidates receive final approval.
disable-model-invocation: true
---

# memon-migrate-fs

This is the only skill allowed to update `.memon/version.json`. It is exempt
from normal skill preflight because resolving an FS mismatch is its purpose.
Never run autonomously.

## Determine the migration chain

Run:

```sh
memon --project-root . --format json fs-version check
```

- `match`: report that nothing is needed and stop.
- `uninitialised`: ask the user to install memon first; stop.
- `ahead`: do not downgrade; ask the user to upgrade memon.
- `behind`: enumerate every `vN-to-vN+1` guide through the target.

Resolve and read every guide completely before writing. Each guide declares
whether it is a mechanical step or a review-required semantic migration and
names any deterministic conversion scripts. A missing guide/script is fatal.

Present the full chain and wait for explicit user confirmation. A request that
triggered some other skill is not migration consent.

## Git and local staging preflight

For Git projects, require a clean tracked and untracked working tree before
starting. Never auto-stash or discard work. Show dirty paths and stop.

Keep review candidates local under:

```text
.memon/migrations/v<N>-to-v<N+1>/<migration-id>/
├── state.yaml
├── live-backup/
└── experiments/
```

Add `.memon/migrations/` to the repository-local `.git/info/exclude` if it is
not already ignored. Do not modify the tracked project `.gitignore` merely for
migration state, and never include staging in a commit.

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
    source_hash: <combined hash of Experiment and referenced Run READMEs>
    staged_hash: <hash of candidate bundle>
    approved_at: <ISO8601 with offset>
    stale_reason: null
```

Per-Experiment states are `DRAFT`, `APPROVED`, `STALE`, and `PUBLISHED`.
Treat a missing or ambiguous referenced Run README as a blocking source error.

The directory and state survive conversation boundaries. Resume an existing
matching migration instead of starting a second candidate set.

## Mechanical step

For a guide explicitly marked mechanical:

1. Run its conversion script in `--check`/dry-run mode.
2. Show the planned file changes and request the guide-required confirmation.
3. Create a backup.
4. Run the deterministic, idempotent conversion.
5. Run every verification command from the guide.
6. Update the FS marker only after verification succeeds.
7. In Git mode, commit only explicit touched paths with the guide's fixed
   migration commit message.

Never improvise a semantic rewrite under this shorter path.

## Review-required semantic step

v5→v6 uses this strict workflow. Any future guide may opt into it too.

### 1. Stage one Experiment at a time

For the next unapproved Experiment:

1. Hash its complete source bundle and record `source_hash`.
2. Read every legacy section and related Runs. Unsupported/unknown headings are
   evidence, not disposable errors.
3. Generate a complete target candidate only under the staging directory:
   canonical `README.md`, `implementation.yaml`, `investigation.yaml`, and
   `results.yaml`, plus any guide-required files.
4. Use the current `memon-write-experiment-doc` schema/routing contract in
   staging mode. Do not touch the production Experiment.
5. Run the guide's staging validator and YAML conversion checks.
6. Render Implementation, Investigation, and Results as human-readable Markdown
   and show the README diff and diagnostics to the user.

The Agent performs semantic reconstruction: split legacy coding tasks into
Implementation, experimental work into Investigation, group retries into
Variants, choose Results columns, and separate facts/Findings/Conclusion. Do not
pretend this classification is lossless.

### 2. Iterate until the user approves

Accept feedback such as:

- missing or incorrectly classified work;
- wrong hierarchy/dependency;
- wrong Variant grouping or selected Run;
- a needed Results column or enum option;
- inaccurate Findings, Limitations, or Conclusion;
- legacy content that must remain visible.

Modify only the staged candidate, rerun validation/rendering, and show the new
diff. Repeat without a fixed retry limit.

When the user explicitly approves that Experiment, record `staged_hash`,
`source_hash`, and `approved_at`; set it `APPROVED`. Approval applies only to
those exact bytes.

### 3. Invalidate stale approvals

Before moving to another Experiment and again before publication:

- recompute every approved source hash;
- recompute every approved staged hash.

If candidate bytes differ, mark that Experiment `STALE`, rerun checks, and
request approval for the new candidate bytes. If source bytes differ, do not
reapprove the old candidate: start a new staging migration from the new source,
regenerate the conversion, and repeat review. Never carry approval across
changed bytes.

### 4. Require all approvals and final confirmation

Do not partially publish an approved Experiment. Continue until every
Experiment is `APPROVED`, all candidate files validate, all cross-Experiment
references validate, and all hashes still match.

Show a final summary of every Experiment, changed file, unresolved diagnostic,
and source/staged hash. Then ask for one explicit final publication
confirmation. Until that confirmation:

- production Experiment files remain untouched;
- the FS marker remains unchanged;
- no migration commit is created.

### 5. Publish as one guarded operation

After final confirmation:

1. Recheck the Git tree and all hashes.
2. Project every approved candidate into an isolated validation root and run
   YAML validation, bundle lint, cross-reference checks, and all managed-section
   renders before touching production.
3. Copy current production files into the staging `backup/` directory.
4. Promote every approved candidate using the guide's atomic publication
   script/rename strategy.
5. Repeat per-file YAML validation, bundle lint, cross-reference checks, CLI
   rendering, and guide verification across the production tree.
6. If verification fails, restore from the backup, leave the FS marker at its
   old version, and report the failure.
7. Only after all production checks and migration-state writes pass, atomically update
   `.memon/version.json` (`fs_convention_version` and `last_migrated_at`).
8. Re-run the version check and final smoke tests.
9. In Git mode, stage only guide-listed production paths and the marker; never
   stage `.memon/migrations/` or unrelated files. Create the fixed migration
   commit.

The FS marker is the final write, never a promise that incomplete files will be
fixed later.

## YAML schema upgrades

Every YAML schema change is governed by an FS convention step. The guide must
ship a deterministic conversion script that is:

- idempotent;
- capable of dry-run/check mode;
- explicit about source and target `schema_version`;
- comment/order/unknown-field preserving where possible;
- atomic per file;
- validated across every Experiment before the global marker changes.

If semantic judgment is required, the script creates the mechanical skeleton
and the review-required workflow handles meaning. Never upgrade YAML silently
while reading it.

## Final report

Report the version chain, approved/published Experiment count, verification
results, migration commit(s) or non-Git backup paths, and retained local staging
path. Do not delete staging automatically; it is the audit record until the user
chooses to remove it.

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
