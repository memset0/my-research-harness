---
name: memon-read-results
description: "Read experiment results from results.yaml as a structured, filterable table. Use when an agent needs to compare variants, extract specific metrics or parameters, or feed results into downstream analysis. For writing or editing results, use memon-write-experiment-doc instead."
---

# memon-read-results

Read one Experiment's Results structure or values. Start with the structure
summary when cell values are unnecessary; use the flat table for real
comparison. Both are read-only projections.

## Preflight

Follow `../PREFLIGHT.md` — FS-version check, deprecated Runs, CLI issue
handoff.

## Use it for

Comparing metrics across Variants, extracting a parameter or metric column,
feeding `jq`/`csvkit`/pandas, a human-readable overview, discovering declared
columns and Variant rows without cell values, and reading optional Markdown
column/value explanations.

Not for writing: Variants, parameters, metrics, run assignments, comments, and
field order all go through `memon-write-experiment-doc`.

## Commands

```sh
# structure only: columns, annotations, row identities — no cell values
memon --project-root . experiment results summary <id-or-slug> --output json

# actual values
memon --project-root . experiment results table <id-or-slug> [options]

# column/value explanations
memon --project-root . --format json experiment results annotation get <id-or-slug> \
  [--column <key>] [--value <value>]
```

### `results table` options

| Flag | Purpose | Default |
|------|---------|---------|
| `--variant <ids>` | Comma-separated Variant IDs | all |
| `--status <statuses>` | `PLANNED`, `RUNNING`, `COMPLETED`, `FAILED`, `INCONCLUSIVE`, `DROPPED` | all |
| `--column <keys>` | Comma-separated column keys | all |
| `--group <group>` | `parameter`, `metric`, or `all` | `all` |
| `--output <fmt>` | `json`, `human`, `csv`, `markdown`, `yaml` | `json` |

Filters are AND-composed, and an empty result is not an error — it returns zero
rows with `meta.filteredVariants: 0`.

`json` suits programmatic use, `human` a terminal, `csv` (RFC 4180, with
integer `runs_count`/`attempts_count`) downstream tools, `markdown` embedding in
a document, `yaml` a YAML consumer.

## Metrics validity

Every row carries `metricsValidity` (`valid`, `partial`, `unavailable`) and the
`deprecatedRuns` behind it; `json`/`yaml` add a top-level `variantEligibility`
array. It is computed at read time from the Run frontmatter `deprecated`
boolean, so `results.yaml` holds no eligibility state and its stored numbers are
never rewritten or masked.

A `partial` or `unavailable` row is not comparable. Report it as such — never
average it in, never carry the old number forward as if current, and never
compute a substitute (`../PREFLIGHT.md`).

Filtered result references are not the full Variant history. Deprecated Runs
remain associated and can be inspected by execution/recovery work for scripts,
setup and prior problems, not included in this skill's result comparison.
Current qualification checks all `Variant.runs`, not separate current-metric
lineage: after a rerun, a `partial` label may reflect retained history. Report
that limitation; neither treat new measurements as automatically qualified nor
remove old associations to clear it.

## Examples

```sh
# every Variant, id/name/status/values
memon --project-root . experiment results table E0001-foo --output json \
  | jq '.rows[] | {id: .variantId, name: .variantName, status, metricsValidity, values}'

# two Variants side by side
memon --project-root . experiment results table E0001-foo --variant V0001,V0002 --output human

# metric columns of completed Variants, for csvkit or pandas
memon --project-root . experiment results table E0001-foo \
  --status COMPLETED --group metric --output csv | csvstat
```

## Output structure (JSON)

```jsonc
{
  "experimentId": "E0001-foo",
  "resultsSchemaVersion": 1,
  "columns": [
    { "key": "accuracy", "label": "Accuracy", "group": "metric", "type": "number" }
  ],
  "columnAnnotations": {
    "precision": {
      "description": "Controls **training precision**.",
      "valueDescriptions": { "bf16": "Uses **bfloat16** arithmetic." }
    }
  },
  "rows": [
    {
      "variantId": "V0001",
      "variantName": "BF16",
      "status": "COMPLETED",
      "runs": ["run-a"],            // selected evidence
      "attempts": [],               // failed / superseded
      "deprecatedRuns": [],         // withdrawn from evidence
      "metricsValidity": "valid",
      "values": { "accuracy": 0.95 }
    }
  ],
  "variantEligibility": [
    {
      "variantId": "V0001",
      "runs": ["run-a"],
      "deprecatedRuns": [],
      "eligibleRuns": ["run-a"],
      "hasMetrics": true,
      "metricsValidity": "valid"
    }
  ],
  "meta": {
    "totalVariants": 3,
    "filteredVariants": 1,
    "filters": { "columnGroup": "metric", "variants": ["V0001"], "columns": ["accuracy"] }
  }
}
```

## Notes

- Unset values render `—` in human/markdown, empty in CSV, `null` in
  JSON/YAML.
- `runs`, `attempts`, and `deprecatedRuns` hold Run directory basenames. They
  are identities for citation; resolving one to its record is execution-level
  work that belongs to the caller's task, not to a comparison read.
- This skill is read-only and never touches a Journal file. `results.yaml` plus
  read-time eligibility is the only source of Variant facts.
