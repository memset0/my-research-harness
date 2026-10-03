---
name: memon-write-experiment-doc
description: Apply targeted, concurrency-safe updates to an Experiment README, its implementation and investigation YAML and its experiment.json Results description, and record Run measurements in result.csv through memon. Preserve unsupported content, batch related changes, lint once and record direct maintenance without mandatory subagents or Run prose.
---

# memon-write-experiment-doc

The shared writing workflow, not a required new agent. Follow `../PREFLIGHT.md`
and read the relevant part of [the bundle reference](references/experiment-bundle.md).
Use the caller's intent and verified evidence; decide no research direction,
launch nothing and write no Run record.

## Read and route

Read the current files you will change and capture their hashes. Do not trust a
stale caller copy or read every Run to justify a bundle edit. An execution
handoff supplies IDs, outcome, verified measurements/provenance and whether
conditions changed. If incomplete or contradictory, request recovery of that
specific fact; never infer retry equivalence from a Variant ID.

| Change | Source |
|---|---|
| Engineering work/evidence | `implementation.yaml` |
| Questions, criteria, empirical progress/outcomes | `investigation.yaml` |
| Columns, groups, Variants, planned values, Variant `runs`, provenance | `experiment.json` |
| A Run's measured parameters, metrics and env values | that Run's `result.csv` via `memon run result set` |
| Renamed, moved, re-typed, re-scaled or deleted recorded values | `schema-upgrades/` + `memon experiment schema upgrade` |
| Interpretation / scope limits / final answer | Findings / Limitations / Conclusion |
| Actionable anomaly | Canonical Warnings table, preserving stable row IDs |

`children` is hierarchy; `depends_on` is blocking. An annotation explains a
column/value, not its validation schema. Predeclare Variants (and the columns
you expect) in `experiment.json` before launch; keep every Variant Run in the
README `runs`, list a Run in at most one Variant, never retrospectively relabel
an execution, never declare a derived status (`RUNNING`, `COMPLETED`,
`FAILED`), and never infer `ANSWERED` from execution status. The Variant table
itself is generated: read it with `memon experiment results table|summary` and
never open, edit or commit `.memon/index/results/`.

## Edit one coherent batch

Preserve comments, unknown keys/sections, duplicate occurrences, ordering and
all bytes outside the intended change. Keep managed pointers exact; never paste
rendered projections into README. Conflicting pointers, invalid/newer schemas
or duplicate managed sections are gaps to report, not permission to overwrite
content. Migration alone relocates unsupported material under user approval.

Recheck hashes before writing. On conflict, reread/reapply once, then surface an
unresolved conflict; never force over another writer. Direct YAML and
`experiment.json` editing is normal (keep unknown keys, two-space JSON). Use the
optional annotation helper only when useful and `memon-components` only for a
component block.

Record measured values per Run with `memon run result set <run>
<path>[:<stat>]=<value>...` (or `--from` a `path,stat,value` CSV): statistics
as `stats` rows (`mean`, `std`, `n`, …), never packed strings such as
`0.31 ± 0.02` or JSON text, and never step histories, checkpoints or tracking
identities. The Run must already be linked to the Experiment and listed in its
Variant's `runs`. A direct `result.csv` edit must keep the
`$experiment_schema_version` row, unique `(path, stat)` pairs and the declared
types. When a command reports `RESULT_FILE_IGNORED`, show the user the deciding
rule and the printed fix command and change an ignore file only after the user
agrees.

Keep original measurements, Run identities and provenance. Evidence is derived:
a listed Run counts when it is `FINISHED` and not deprecated, so a finished Run
that must not count is deprecated with the user's decision, never removed from
the Variant or relabelled. Preserve Variant `runs` when a Run is deprecated;
replacement Runs of the same Variant become evidence on their own.

Changing the meaning or location of recorded values (rename, move, re-type,
re-scale, delete) follows the reference's upgrade procedure: write the
`schema-upgrades/<N>-to-<N+1>` transform, run `memon experiment schema upgrade
<id> --to <N+1>` without `--apply`, show the user the diff, and apply only
after approval. On `RESULT_SCHEMA_MISMATCH`, report the listed files and the
upgrade command instead of editing result files one by one
(`../PREFLIGHT.md`, Results files).

> dry run 显示 3 个文件会改：`metrics.fid` 重命名为 `metrics.eval.fid`，版本 1 → 2。
> 确认后我用 `--apply` 执行（会先备份到 `.memon/backups/schema-upgrade/`）。

New claims must cite their evidence and predecessor; supersession/narrowing
changes only affected claims. Experiment lifecycle/archive changes, warning
resolution and final resolution require user authority.

## Check and close

After the batch, run `experiment doc lint "$EXP_ID"` with explicit
`--project-root` (it also checks every member `result.csv`) and inspect the
affected rendering, not every document again.
Fix newly introduced structural errors. Preserve and report pre-existing
unsupported content; a lint diagnostic never licenses deleting it.

Submit direct managed-file changes once with `journal submit --files ...` per
the shared protocol (`run result set` and `schema upgrade` record themselves);
do not duplicate CLI-generated receipts or touch Journal files. Return changed
files/IDs, the substantive change, lint/render outcome, submission id/outcome,
and remaining conflicts or gaps. Do not silently change `schema_version` or
`experiment_schema_version`, or resolve the Experiment.
