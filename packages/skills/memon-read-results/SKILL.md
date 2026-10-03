---
name: memon-read-results
description: "Read an Experiment's generated Results table (the Variant summary built from experiment.json and each member Run's result.csv) as a structured, filterable table. Use when an agent needs to compare Variants, extract specific metrics or parameters, or feed results into downstream analysis. For writing or editing results, use memon-write-experiment-doc instead."
---

# memon-read-results

Read one Experiment's Results structure or values. Start with the structure
summary when cell values are unnecessary; use the flat table for real
comparison. Both are read-only projections of the generated Results summary.

## Preflight

Follow `../PREFLIGHT.md` — FS-version check, deprecated Runs, Results files,
CLI issue handoff.

## Use it for

Comparing metrics across Variants, extracting a parameter or metric column,
feeding `jq`/`csvkit`/pandas, a human-readable overview, discovering declared
columns and Variant rows without cell values, and reading optional Markdown
column/value explanations.

Not for writing: Variants, columns, annotations and Variant `runs` live in
`experiment.json`, measured values in each Run's `result.csv`; both go through
`memon-write-experiment-doc` (`memon run result set` for values).

## Where the table comes from

The CLI builds the Variant table from three inputs: `experiment.json`, the
README of every member Run and those Runs' `result.csv` files. It stores the
result as a cache under `.memon/index/results/` and reuses it only while every
input fingerprint is unchanged. Never open, edit, delete or commit that cache,
and never open a Run's `result.csv` to read results: call the commands below.
Deleting the cache changes no answer.

## Commands

```sh
# structure only: columns, annotations, Variant identities — no cell values
memon --project-root . experiment results summary <id-or-slug> --output json

# actual values
memon --project-root . experiment results table <id-or-slug> [options]

# column/value explanations
memon --project-root . --format json experiment results annotation get <id-or-slug> \
  [--column <path>] [--value <value>]
```

### `results table` options

| Flag | Purpose | Default |
|------|---------|---------|
| `--variant <ids>` | Comma-separated Variant IDs | all |
| `--status <statuses>` | Effective statuses, case-insensitive: `PLANNED`, `BLOCKED`, `RUNNING`, `COMPLETED`, `FAILED`, `INCONCLUSIVE`, `DROPPED` | all |
| `--column <paths>` | Comma-separated column paths or group prefixes (`metrics.eval`) | all |
| `--group <group>` | Partition: `parameter`, `metric`, or `all` | `all` |
| `--output <fmt>` | `json`, `human`, `csv`, `markdown`, `yaml` | `json` |

Filters are AND-composed, and an empty result is not an error — it returns zero
rows with `meta.filteredVariants: 0`.

`json` suits programmatic use, `human` a terminal, `csv` downstream tools
(RFC 4180; a statistics column becomes one `path:stat` column per statistic,
plus integer `runs_count`/`attempts_count`), `markdown` embedding in a
document, `yaml` a YAML consumer.

## Reading the values

- `status` is the effective Variant status, derived from the Run records;
  `declaredStatus` is the plan or judgment state written in `experiment.json`
  (`PLANNED`, `BLOCKED`, `DROPPED`, `INCONCLUSIVE` or null).
- `runs` are the evidence Runs: listed, `FINISHED` and not deprecated. Only
  they contribute values. `attempts` are the Variant's other Runs (failed,
  interrupted, running, deprecated) with their status.
- A scalar value is the single evidence Run's value. Several evidence Runs of a
  numeric metric become statistics across Runs (`over: "run"`: `n`, `mean`,
  `std`, `min`, `max`, percentiles, …), shown by default as `mean ± std (n)`.
  Parameters and env values are never averaged: equal ones appear once,
  differing ones as `{"mixed": [...]}` with the per-Run values.
- A `stats` column's value is `{"across", "over", "stats": {...}}`; compare the
  statistic the question needs (for example `mean`, or `max.p99`) and respect
  the column's `direction` (`higher` or `lower` is better).
- `frozen` lists paths whose values are historical values without a Run
  directory; `differsFromPlan` gives the planned value of a path whose recorded
  value differs from the Variant's plan. Report both as such.
- `diagnostics` carries summary warnings such as `VARIANT_STATUS_STALE` and
  `VARIANT_PARAM_MISMATCH`; mention them when they affect a comparison.

A deprecated Run's values never reach the table, so do not compare old numbers
from memory or other documents, and never compute a substitute
(`../PREFLIGHT.md`). Deprecated Runs remain listed among `attempts` and can be
inspected by execution/recovery work, not by this comparison.

## Failures

| Exit | `error.code` | Meaning and what to do |
|------|--------------|------------------------|
| 4 | `NOT_FOUND` | Unknown Experiment or no `experiment.json`. When `details.legacyResultsYaml` is true the project is still on FS v8: report it and point the user to `memon-migrate-fs`; do not read `results.yaml`. |
| 1 | `INVALID_RESULTS` | `experiment.json` does not parse or validate; report `details.diagnostics` and hand the fix to `memon-write-experiment-doc`. |
| 1 | `RESULT_SCHEMA_MISMATCH` | A member `result.csv` records another or no `experiment_schema_version`. Report every `details.files` entry with its version and the exact `details.upgradeCommand`; never edit result files one by one. |
| 1 | `RESULT_DUPLICATE_ROW` | A member `result.csv` repeats a `(path, stat)` pair; report the file and line numbers. |

A failed table returns no rows at all — never a partial table. A
`RESULTS_CACHE_FAILED` warning only means the cache could not be stored; the
table is still correct.

## Examples

```sh
# every Variant, id/name/status/values
memon --project-root . experiment results table E0001-foo --output json \
  | jq '.rows[] | {id: .variantId, name: .variantName, status, values}'

# two Variants side by side
memon --project-root . experiment results table E0001-foo --variant V0001,V0002 --output human

# evaluation metrics of completed Variants, for csvkit or pandas
memon --project-root . experiment results table E0001-foo \
  --status COMPLETED --column metrics.eval --output csv | csvstat
```

## Output structure (JSON)

```jsonc
{
  "experimentId": "E0001-foo",
  "experimentSchemaVersion": 1,
  "columns": [
    { "path": "params.precision", "label": "Precision", "type": "enum", "group": "parameter",
      "declared": true, "hidden": false, "options": ["fp32", "bf16"],
      "description": "Controls **training precision**.",
      "valueDescriptions": { "bf16": "Uses **bfloat16** arithmetic." } },
    { "path": "metrics.eval.accuracy", "label": "Accuracy", "type": "number", "group": "metric",
      "declared": true, "hidden": false, "direction": "higher" },
    { "path": "metrics.eval.clip", "label": "CLIP", "type": "stats", "group": "metric",
      "declared": true, "hidden": false, "across": "sample", "stats": ["mean", "std", "n"] }
  ],
  "rows": [
    {
      "variantId": "V0002",
      "variantName": "FP32 seeds",
      "status": "COMPLETED",               // derived
      "declaredStatus": null,
      "runs": ["logs/b-260901-100000", "logs/c-260901-110000", "logs/d-260901-120000"],
      "attempts": [{ "run": "logs/e-260901-130000", "status": "FAILED", "deprecated": false, "stopReason": null }],
      "values": {
        "params.precision": "fp32",
        "metrics.eval.accuracy": { "across": null, "over": "run",
                                   "stats": { "n": 3, "mean": 11, "std": 1, "min": 10, "max": 12 } }
      },
      "frozen": [],
      "differsFromPlan": {}
    }
  ],
  "meta": {
    "totalVariants": 5,
    "filteredVariants": 1,
    "filters": { "columnGroup": "all", "variants": ["V0002"] }
  },
  "diagnostics": [],
  "warnings": []
}
```

## Notes

- Unset values render `—` in human/markdown, empty in CSV, and are absent from
  `values` (or `null` for an explicitly missing value) in JSON/YAML.
- `runs` and `attempts` hold project-relative Run paths. They are identities
  for citation; resolving one to its record is execution-level work that
  belongs to the caller's task, not to a comparison read.
- This skill is read-only and never touches a Journal file. The generated
  summary is the only source of Variant-level values it reads.
