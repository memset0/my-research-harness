---
name: memon-write-experiment-doc
description: Apply targeted, concurrency-safe updates to an Experiment README and its implementation, investigation and results YAML. Preserve unsupported content, batch related changes, lint once and record direct maintenance without mandatory subagents or Run prose.
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
| Variants, parameters, Run/attempt associations, metrics/provenance | `results.yaml` |
| Interpretation / scope limits / final answer | Findings / Limitations / Conclusion |
| Actionable anomaly | Canonical Warnings table, preserving stable row IDs |

`children` is hierarchy; `depends_on` is blocking. An annotation explains a
column/value, not its validation schema. Predeclare Variants before launch;
never retrospectively relabel an execution, put a Run in both lists, or infer
`ANSWERED` from execution status.

## Edit one coherent batch

Preserve comments, unknown keys/sections, duplicate occurrences, ordering and
all bytes outside the intended change. Keep managed pointers exact; never paste
rendered projections into README. Conflicting pointers, invalid/newer schemas
or duplicate managed sections are gaps to report, not permission to overwrite
content. Migration alone relocates unsupported material under user approval.

Recheck hashes before writing. On conflict, reread/reapply once, then surface an
unresolved conflict; never force over another writer. Direct YAML editing is
normal. Use the optional annotation helper only when useful and
`memon-components` only for a component block.

Keep original measurements, Run identities and provenance. Deprecation produces
read-time validity, not a document mirror or an automatic metric rewrite.
Preserve Variant membership when a Run is deprecated, regardless of whether its
old metrics were published; do not move it into `attempts` just to exclude it.
For reruns, distinguish historical membership from the actual source Runs of
new measurements in supported provenance and the handoff, preserving old
evidence. The current projection cannot yet express separate current-metric
lineage; report this limitation rather than inventing fields, erasing history
or promising that a writeback automatically restores `valid`.
New claims must cite their evidence and predecessor; supersession/narrowing
changes only affected claims. Experiment lifecycle/archive changes, warning
resolution and final resolution require user authority.

## Check and close

After the batch, run `experiment doc lint "$EXP_ID"` with explicit
`--project-root` and inspect the affected rendering, not every document again.
Fix newly introduced structural errors. Preserve and report pre-existing
unsupported content; a lint diagnostic never licenses deleting it.

Submit direct managed-file changes once with `journal submit --files ...` per
the shared protocol; do not duplicate CLI-generated receipts or touch Journal
files. Return changed files/IDs, the substantive change, lint/render outcome,
submission id/outcome, and remaining conflicts or gaps. Do not silently upgrade
`schema_version` or resolve the Experiment.
