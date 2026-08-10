# v5 → v6 migration

## Background / Why

memon `FS_CONVENTION_VERSION` moves from `5` to `6` for the structured Experiment document change in `openspec/changes/structured-experiment-docs-v6/`. Version 6 replaces the overloaded free-form `Method`, `Plan`, and `Caveats` organization with nine canonical README sections and three schema-versioned YAML sidecars: `implementation.yaml`, `investigation.yaml`, and `results.yaml`.

This transformation is semantic and potentially lossy. Draft every Experiment in persistent local staging, preserve ambiguous material, iterate with the user until that Experiment is explicitly approved, and publish nothing until every Experiment is approved and the user gives one final project-wide confirmation.

## Detection

- `test "$(jq -r .fs_convention_version .memon/version.json)" = "5" && echo OK` — require the v5 global marker.
- `test -d docs/experiments && echo OK` — require the Experiment store.
- `test -z "$(find docs/experiments -mindepth 2 -maxdepth 2 \( -name implementation.yaml -o -name investigation.yaml -o -name results.yaml \) -print -quit)" && echo OK` — reject a partial/manual v6 sidecar installation.
- `git rev-parse --is-inside-work-tree >/dev/null 2>&1 || echo NON_GIT_MODE` — select Git or non-Git handling.
- `test -z "$(git status --porcelain=v1 --untracked-files=all -- . 2>/dev/null)" && echo OK` — in Git mode, require a clean worktree; commit, stash manually, or discard changes before continuing.

Run the checks from `<projectRoot>`. If the marker is below `5`, apply every earlier guide first. If it is above `5`, stop and upgrade the memon binary. Do not overwrite a pre-existing v6 sidecar while the marker remains at v5.

## Diff (v5 → v6)

### File 1: `<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md`

Preserve frontmatter and all user-authored information. Reclassify the body into the canonical order below. Keep the three managed sections as exact one-line pointers; never paste generated YAML projections into the README.

```before
## Motivation

Why this experiment exists.

## Method

Protocol, code changes, and launch details mixed together.

## Plan

- [ ] Implement the loader.
- [ ] Compare baseline and tuned runs.

## Conclusion

Run table, observations, limitations, and final answer mixed together.

## Caveats

Known validity limits.

## Warnings

Operational warnings.
```

```after
## Motivation

Why this experiment exists.

## Design

Stable protocol and cross-Variant experimental design.

## Implementation

> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.

## Investigation

> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.

## Results

> Managed in [results.yaml](./results.yaml); read and update that file directly.

## Findings

Cross-Variant interpretation supported by the Results.

## Limitations

Known validity bounds and unresolved caveats.

## Conclusion

The final answer confirmed with the user.

## Warnings

Operational warnings.
```

Move stable protocol from `Method` to `Design`. Split coding work from old `Plan` into Implementation and empirical questions into Investigation. Move run-comparison facts into Results, interpretation into Findings, validity bounds into Limitations, and only the confirmed final answer into Conclusion. Preserve every unsupported or ambiguous sentence in staging until the user assigns or explicitly discards it.

### File 2: `<projectRoot>/docs/experiments/E<NNNN>-<slug>/implementation.yaml`

```after
schema_version: 1
items:
  - id: IMP0001
    title: Implement the loader
    status: DONE
    description: Add the data-loading path needed by every Variant.
    depends_on: []
    acceptance_criteria:
      - The loader passes its focused tests.
    files:
      - src/loader.py
    children: []
```

Use nested `children` for hierarchy and `depends_on` IDs for dependency edges. Valid statuses are `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, and `DROPPED`.

### File 3: `<projectRoot>/docs/experiments/E<NNNN>-<slug>/investigation.yaml`

```after
schema_version: 1
items:
  - id: INV0001
    title: Determine whether tuning improves accuracy
    status: IN_PROGRESS
    question: Does the tuned recipe outperform the baseline?
    depends_on:
      - IMP0001
    success_criteria:
      - Tuned accuracy exceeds baseline accuracy.
    variant_ids:
      - V0001
      - V0002
    children: []
```

Use nested `children` independently from the Implementation tree. Valid statuses are `PLANNED`, `IN_PROGRESS`, `BLOCKED`, `ANSWERED`, `INCONCLUSIVE`, and `DROPPED`. Keep Investigation and Results separate; connect them with `variant_ids`.

### File 4: `<projectRoot>/docs/experiments/E<NNNN>-<slug>/results.yaml`

```after
schema_version: 1
columns:
  - key: optimizer
    label: Optimizer
    group: parameter
    type: enum
    options:
      - adamw
      - sgd
  - key: accuracy
    label: Accuracy
    group: metric
    type: number
variants:
  - id: V0001
    name: Baseline
    status: COMPLETED
    description: Default training recipe.
    parameters:
      optimizer: adamw
    metrics:
      accuracy: 0.81
    runs:
      - baseline-250101-120000
    attempts:
      - baseline-250101-110000
    provenance:
      repo: https://github.com/example/project
      commit: 0123456789abcdef
      entry: train.py
      recipe: recipes/baseline.yaml
      env:
        DATASET: example-v1
```

Create every Variant before launching its Runs; zero-run `PLANNED` Variants are valid. Put adopted Runs in `runs`. Put failed, interrupted, superseded, or rejected launches in `attempts`. Never list one Run in both. Valid Variant statuses are `PLANNED`, `RUNNING`, `COMPLETED`, `FAILED`, `INCONCLUSIVE`, and `DROPPED`.

### File 5: `<projectRoot>/.memon/migrations/v5-to-v6/<migration-id>/state.yaml`

This file and all candidates stay local through Git's per-worktree exclude file. The executor adds `/.memon/migrations/` to `.git/info/exclude`; it never changes a tracked `.gitignore`.

```after
schema_version: 1
migration: v5-to-v6
migration_id: 20260810T120000Z
published_at: null
experiments:
  E0001-example:
    status: DRAFT
    source_path: docs/experiments/E0001-example/README.md
    source_paths:
      - docs/experiments/E0001-example/README.md
      - logs/baseline-260810-120000/README.md
    source_hash: <sha256>
    staged_hash: null
    approved_at: null
    stale_reason: null
```

An approval records a combined hash over the source Experiment README and every Run README referenced by its frontmatter, plus the complete staged-bundle hash. A later Experiment or referenced Run edit changes the state to `STALE` and requires a new staging migration so an old candidate cannot overwrite new source. A candidate-only edit also changes the state to `STALE`; rerun checks and approve those new candidate bytes. A missing or ambiguous referenced Run README blocks staging.

### File 6: `<projectRoot>/.memon/version.json`

```before
{
  "fs_convention_version": 5,
  "installed_at": "...",
  "last_migrated_at": "..."
}
```

```after
{
  "fs_convention_version": 6,
  "installed_at": "...",
  "last_migrated_at": "<ISO8601 timestamp>"
}
```

Keep `installed_at` unchanged. Update this marker only after every live candidate has been installed and the migration state has been durably recorded.

### Execution workflow

1. Set `MEMON_SOURCE` to the memon source checkout that contains this guide.
2. Initialize persistent staging without mutating a live Experiment:

   ```bash
   STAGING="$(node "$MEMON_SOURCE/packages/core/migrations/scripts/v5-to-v6-stage.mjs" init --project-root "$PWD")"
   test -f "$STAGING/state.yaml" && echo OK
   ```

3. Process Experiment directories in sorted ID order. Read its live README and every referenced Run README. Edit only `$STAGING/experiments/<id>/README.md` and the three YAML files beside it.
4. Render the staged README and the three YAML-derived human-readable sections. Show the user the old/new diff and the Results comparison. Keep applying user feedback only in staging.
5. Run schema, reference, dependency, pointer, and canonical-section lint on the staged four-file bundle. Resolve errors before approval. Preserve ambiguous old content and ask the user where it belongs; never silently delete it.
6. Record that Experiment's explicit approval:

   ```bash
   node "$MEMON_SOURCE/packages/core/migrations/scripts/v5-to-v6-stage.mjs" approve --staging "$STAGING" --experiment '<id>'
   ```

7. Resume after an interruption by running:

   ```bash
   node "$MEMON_SOURCE/packages/core/migrations/scripts/v5-to-v6-stage.mjs" status --staging "$STAGING"
   ```

8. After every Experiment is approved, verify all source hashes, candidate hashes, files, and the unchanged v5 marker:

   ```bash
   node "$MEMON_SOURCE/packages/core/migrations/scripts/v5-to-v6-stage.mjs" verify --staging "$STAGING"
   ```

9. Show the complete approval summary and request one final explicit user confirmation. Use the `migration_id` shown in `$STAGING/state.yaml` as the confirmation token only after the user confirms.
10. Publish the complete set. Before touching production, the executor builds an isolated projection of every approved candidate and runs `validate`, `lint`, and all three managed-section renders. It then copies all candidates, repeats those checks on the production paths while the marker remains v5, verifies every live bundle hash, durably records publication state, and updates the marker as the final write. A staged failure leaves production untouched; a production failure restores the live backup and v5 marker:

    ```bash
    MIGRATION_ID="$(sed -n 's/^migration_id: //p' "$STAGING/state.yaml")"
    MEMON_BIN="$(command -v memon)"
    node "$MEMON_SOURCE/packages/core/migrations/scripts/v5-to-v6-stage.mjs" publish --staging "$STAGING" --confirm "$MIGRATION_ID" --memon-bin "$MEMON_BIN"
    ```

11. Run the Verification block. Commit only after every command succeeds.

## Target State (v6 Summary)

```text
<projectRoot>/
├── .memon/
│   ├── version.json                         # fs_convention_version: 6
│   └── migrations/v5-to-v6/<id>/           # local staged candidates, hashes, approvals, backup
└── docs/experiments/
    └── E0001-example/
        ├── README.md                        # nine canonical H2 sections; three exact pointers
        ├── implementation.yaml              # schema_version: 1; nested IMP tree
        ├── investigation.yaml               # schema_version: 1; nested INV tree
        ├── results.yaml                     # schema_version: 1; columns + Variants
        ├── code-review/
        └── user-owned Experiment artifacts
```

Run directories and existing Markdown Reports remain unchanged. A newly requested HTML Report may use a report directory, but this migration does not rewrite existing Reports.

## Verification

```bash
set -e

test "$(jq -r .fs_convention_version .memon/version.json)" = "6" && echo OK

find docs/experiments -mindepth 1 -maxdepth 1 -type d -name 'E*-*' | while read -r d; do
  test -f "$d/README.md"
  test -f "$d/implementation.yaml"
  test -f "$d/investigation.yaml"
  test -f "$d/results.yaml"
  grep -Fqx '> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.' "$d/README.md"
  grep -Fqx '> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.' "$d/README.md"
  grep -Fqx '> Managed in [results.yaml](./results.yaml); read and update that file directly.' "$d/README.md"
  id="$(basename "$d")"
  memon --project-root . --format json experiment doc lint "$id" | jq -e '.ok == true' >/dev/null
done
echo OK

memon --project-root . --format json experiment ls | jq -e '.experiments | type == "array"' >/dev/null && echo OK
memon --project-root . --format json doctor | jq -e '[.issues[] | select(.severity == "error")] | length == 0' >/dev/null && echo OK
```

Open the web dashboard. Confirm that Implementation, Investigation, and Results show the shared human-readable Markdown projection; confirm that an unsupported legacy H2 remains visible with a diagnostic instead of disappearing. Commit the migration with the exact message `chore(memon): migrate FS convention v5 -> v6` and no body.

## Rollback Notes

Stop concurrent writers before rollback. In Git mode, revert the migration commit with `git revert --no-edit <migration-commit-sha>`; the commit message is exactly `chore(memon): migrate FS convention v5 -> v6`. Before commit, restore each README from `$STAGING/live-backup/<id>/README.md`, remove only the three sidecars installed by this publish, and restore the pre-publish marker. In non-Git mode, extract the pre-migration snapshot with `tar -xf .memon/backups/pre-v6-<timestamp>.tar.gz -C .`. Keep staging and backups until the restored v5 state passes its checks.

## Edge Cases

- **Missing required file:** Stop that Experiment when its live README or a Run README required for semantic reconstruction is missing. Name the missing path. Do not create an empty replacement or approve the candidate.
- **User-added custom frontmatter:** Preserve every user-added frontmatter field verbatim. Modify only memon-owned sections and sidecars.
- **Dirty working tree:** The executor refuses `init` and `publish` in Git mode when any tracked or untracked project file is dirty. Commit, stash manually, or discard the changes; never auto-stash.
- **Concurrent migration:** Do not run two v5-to-v6 sessions for one project root. The executor does not lock competing processes; stop the second invocation.
- **Source changed during review:** A change to the Experiment README or any referenced Run README makes `status` change the prior approval to `STALE`. Do not reapprove the old candidate. Start a new staging migration from the new source bundle, regenerate the affected conversion, rerun lint, show the new diff, and request approval again.
- **Staged candidate changed after approval:** `status` changes the prior approval to `STALE`. Rerun lint and request approval again.
- **Ambiguous old Plan item:** Preserve it in staging and ask whether it belongs in Implementation, Investigation, Findings, or an explicitly retained unsupported section. Never guess and publish.
- **Unsupported H2:** Render the original body during review. v6 lint rejects it. Map it to a canonical section or obtain an explicit documented exception; resolving it is the default.
- **Pre-existing YAML sidecar:** Stop initialization and inspect the partial/manual state. Do not overwrite or merge it automatically.
- **Publish interruption:** The executor restores live READMEs, removes only the sidecars it installed, restores the v5 marker, and retains a failed backup. Run `verify` before retrying.
