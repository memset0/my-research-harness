---
name: memon-read-results
description: "Read experiment results from results.yaml as a structured, filterable table. Use when an agent needs to compare variants, extract specific metrics or parameters, or feed results into downstream analysis. For writing or editing results, use memon-write-experiment-doc instead."
---

# memon-read-results

Read one Experiment's Results structure or values. Start with the structure
summary when cell values are unnecessary; use the flat table for actual
comparison. These are read-only projections. Annotation writes remain an
optional operation owned by `memon-write-experiment-doc`.

## Memon CLI issue handoff

For every `memon` command used by this skill, follow the CLI issue handoff in
`../PREFLIGHT.md`. After safely finishing the requested task, report any CLI
crash, valid-input rejection, malformed/inconsistent output, or required CLI
workaround. Do not mislabel an expected validation or domain-state rejection as
a CLI bug.

## Preflight

Run this first:

```sh
memon --project-root . --format json fs-version check
```

Proceed only when `status == "match"`. For every other status, stop and follow
`../PREFLIGHT.md`.

## When to use this skill

- Comparing metrics across Variants (`V0001`, `V0002`, ...)
- Extracting a specific parameter or metric column for analysis
- Feeding results into `jq`, `csvkit`, pandas, or other tabular tools
- Getting a human-readable overview of an Experiment's results
- Discovering declared columns and Variant rows without loading cell values
- Reading optional Markdown column/value explanations

**Do NOT use this skill** when you need to:
- Create or update Variants, parameters, metrics, or run assignments → use
  `memon-write-experiment-doc`
- Edit results.yaml comments or field ordering → edit the YAML file directly
  via `memon-write-experiment-doc`

## Command

Structure-only summary (no parameter/metric cell values, Runs, Attempts, or
provenance):

```sh
memon --project-root . experiment results summary <id-or-slug> --output json
```

Read all annotations or one exact description:

```sh
memon --project-root . --format json experiment results annotation get <id-or-slug>
memon --project-root . --format json experiment results annotation get <id-or-slug> \
  --column <key> [--value <value>]
```

Read actual table values only when needed:

```
memon --project-root . experiment results table <id-or-slug> [options]
```

### Options

| Flag | Purpose | Default |
|------|---------|---------|
| `--variant <ids>` | Comma-separated Variant IDs to include | all |
| `--status <statuses>` | Comma-separated statuses to include (`PLANNED`, `RUNNING`, `COMPLETED`, `FAILED`, `INCONCLUSIVE`, `DROPPED`) | all |
| `--column <keys>` | Comma-separated column keys to include | all |
| `--group <group>` | Column group filter: `parameter`, `metric`, or `all` | `all` |
| `--output <fmt>` | Output format: `json` (default), `human`, `csv`, `markdown`, `yaml` | `json` |

### Output formats

**`json`** (default) — structured object with `columns`, `rows`, and `meta`.
Best for programmatic processing with `jq` or direct parsing.

**`human`** — aligned terminal table with `─` separators. Best for quick
terminal inspection.

**`csv`** — RFC 4180 CSV with header row. `runs_count` and `attempts_count`
are integer counts; pipe to `csvkit` or `pandas.read_csv()`.

**`markdown`** — GFM table with bold Variant IDs. Best for embedding in
reports or Markdown documents.

**`yaml`** — structured YAML mirroring the JSON structure. Best when the
consumer prefers YAML.

## Workflow

### 1. Inspect structure without cell values

```sh
memon --project-root . experiment results summary E0001-foo --output json
```

The summary returns column schemas plus optional `description` and
`valueDescriptions`, and row identities (`id`, `name`, `status`). It does not
return parameter/metric values or execution details.

### 2. Read all result values

Quick overview of every Variant:

```sh
memon --project-root . experiment results table E0001-foo --output json | jq '.rows[] | {id: .variantId, name: .variantName, status, metrics: .values}'
```

### 3. Filter to specific Variants

Compare two specific Variants:

```sh
memon --project-root . experiment results table E0001-foo \
  --variant V0001,V0002 \
  --output json | jq '.rows[] | {id: .variantId, status, values}'
```

### 4. Filter to specific columns

Extract only metric columns (exclude parameters):

```sh
memon --project-root . experiment results table E0001-foo \
  --group metric \
  --output csv
```

Extract specific columns:

```sh
memon --project-root . experiment results table E0001-foo \
  --column precision,accuracy \
  --output markdown
```

### 5. Filter by status

Show only completed experiments:

```sh
memon --project-root . experiment results table E0001-foo \
  --status COMPLETED \
  --output human
```

Combine status and column filters:

```sh
memon --project-root . experiment results table E0001-foo \
  --status COMPLETED,FAILED \
  --group metric \
  --output csv
```

### 6. Pipe to downstream tools

JSON → `jq`:

```sh
memon --project-root . experiment results table E0001-foo --output json \
  | jq '[.rows[] | {id: .variantId, loss: .values.loss}] | sort_by(.loss)'
```

CSV → `csvkit`:

```sh
memon --project-root . experiment results table E0001-foo --output csv \
  | csvstat
```

CSV → `pandas` (Python):

```python
import pandas as pd, json, subprocess
result = subprocess.run(
    ['memon', '--project-root', '.', 'experiment', 'results', 'table', 'E0001-foo', '--output', 'csv'],
    capture_output=True, text=True, check=True
)
df = pd.read_csv(pd.io.common.StringIO(result.stdout))
print(df[['variant_id', 'accuracy', 'loss']])
```

## Output structure (JSON)

```jsonc
{
  "experimentId": "E0001-foo",
  "resultsSchemaVersion": 1,
  "columns": [
    // Schema column definitions (filtered by --column / --group)
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
      "runs": ["run-a"],       // accepted evidence runs
      "attempts": [],           // failed / superseded attempts
      "values": {               // one entry per selected column
        "accuracy": 0.95
      }
    }
  ],
  "meta": {
    "totalVariants": 3,         // total in results.yaml
    "filteredVariants": 1,      // after applying --variant / --status
    "filters": {
      "columnGroup": "metric",
      "variants": ["V0001"],
      "columns": ["accuracy"]
    }
  }
}
```

## Notes

- `null` values (unset metrics) render as `—` in human/markdown, empty string in
  CSV, and `null` in JSON/YAML.
- The `runs` and `attempts` arrays contain raw Run directory basenames. Use
  `memon experiment link` or the experiment detail API to resolve them to full
  Run documents.
- Filtering is AND-composed: `--variant V0001 --status COMPLETED` returns only
  Variants that match both criteria.
- Empty filter results are not errors — the command returns zero rows with
  `meta.filteredVariants: 0`.
