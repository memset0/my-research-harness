---
name: memon-propose
description: Rank useful next Experiments or Variant sets using Experiment documents, the generated Variant-level Results table and project knowledge only. Stay read-only; report document gaps instead of reading Runs, result files or logs, then hand the user's selection to memon-drive.
---

# memon-propose

Read-only research collaboration. Follow `../PREFLIGHT.md`. Create no files,
allocate no IDs, change no status and launch nothing.

## Read only the higher layer

Use the Experiment README, its YAML documents and `experiment.json`, the
Variant-level Results table, hypotheses, relevant wiki knowledge and reports.
Start from the question and follow relevant references, not an exhaustive
project sweep. Useful CLI reads:

```sh
memon --project-root . --format json experiment ls
memon --project-root . --format human experiment show <id>
memon --project-root . experiment results summary <id> --output json
memon --project-root . experiment results table <id> --output json
```

Filter Variants/columns when appropriate. Read measurements only from the
`results table` output: it is generated from the Variants' evidence Runs
(finished, not deprecated), so deprecated values are already excluded; frozen,
mixed or plan-differing cells are labelled and must be reported as such.
`experiment.json` describes columns and Variants but holds no measurements.
If the table fails with `RESULT_SCHEMA_MISMATCH` or `RESULT_DUPLICATE_ROW`,
report the listed files (and the upgrade command) as a document gap; never
work around it.

**Never read Run records, Run `result.csv` files, the generated summaries under
`.memon/index/`, logs, artifacts, W&B run pages or Journal history.** Do not
bypass this boundary with `scan`, general Run search or Run-hydrating commands.
A Variant's Run paths are references, not an invitation to inspect them.
Missing rationale, provenance or interpretation is an Experiment-document gap:
name it, identify the owning section and hand recovery to `memon-drive`. Do not
fill it from lower layers.

## Recommend, without padding

Check whether an existing Investigation or Variant already covers the question,
whether prior findings rejected it, and what limitation or changed condition
makes new work useful. Reuse baselines; prefer finishing existing work when that
has more value than creating an Experiment.

Rank genuinely distinct options by information gain, cost and feasibility. For
each, state the question, why now, discriminating evidence, candidate axes and
baseline, engineering prerequisite, and principal risk/gap. Include an
orthogonal alternative when useful, not a fixed quota of candidates. A Run
count or completed execution never proves a research answer; never invent
missing lineage or replacement metrics.

Ask which option to pursue, list consequential document gaps, and hand the
selection to `memon-drive`. Proposals remain unwritten until selected.
