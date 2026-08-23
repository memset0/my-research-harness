## Context

The memon CLI already exposes experiment results through `memon experiment doc show <id> results`, which returns the raw parsed YAML document:

```json
{
  "schemaVersion": 1,
  "columns": [{"key": "precision", "label": "Precision", "group": "parameter", ...}],
  "variants": [
    {"id": "V0001", "name": "BF16", "status": "COMPLETED", "parameters": {"precision": "bf16"}, "metrics": {"loss": 0.125}, ...}
  ]
}
```

This is correct for YAML-level editing but forces every agent consumer to:
1. Flatten `parameters` and `metrics` into a single row per variant
2. Filter columns by key or group
3. Filter variants by ID or status
4. Re-pivot into a table format

The same pivot logic gets reimplemented ad-hoc in every agent session. The new `experiment results` command centralizes this into one tested, consistent implementation.

## Goals / Non-Goals

**Goals:**
- One command reads results.yaml, handles all error states, and returns a flat table.
- Row filters: `--variant` (by ID) and `--status` (by variant status), both repeatable as comma-separated lists.
- Column filters: `--column` (by key) and `--group` (parameter | metric | all).
- Five output formats: `json`, `human`, `csv`, `markdown`, `yaml`.
- Errors are surfaced through the existing `emitErrorAndExit` mechanism with appropriate exit codes.
- No core library changes — the command is a pure CLI-layer projection.

**Non-Goals:**
- Editing results.yaml (agents edit YAML directly per `memon-write-experiment-doc`).
- Automatic variant inference from runs.
- W&B link resolution (that belongs in the web layer's render context).
- Caching or polling (results are read fresh from disk each call).

## Decisions

### 1. Command shape: `memon experiment results <id-or-slug>`

Registered as a subcommand of `experiment`, parallel to `experiment show`, `experiment create`, etc.

```
memon experiment results <id-or-slug> [options]

Options:
  --variant <ids>       comma-separated variant IDs to include (default: all)
  --status <statuses>   comma-separated statuses to include (default: all)
  --column <keys>       comma-separated column keys to include (default: all)
  --group <group>       column group filter: parameter | metric | all (default: all)
  --output <fmt>        output format: json | human | csv | markdown | yaml (default: json)
```

The `--output` flag is command-local (not the global `--format json|human`) because this command needs five formats, not two. The global `--format` is still accepted but ignored by this command in favor of `--output`.

### 2. Output structure

All formats share the same semantic content:

- `experimentId`: the resolved experiment ID (`E<NNNN>-<slug>`).
- `resultsSchemaVersion`: integer schema version from results.yaml.
- `columns`: filtered array of `{ key, label, group, type, options? }`.
- `rows`: filtered array of `{ variantId, variantName, status, runs[], attempts[], values: { [key]: scalar } }`.
- `meta`: `{ totalVariants, filteredVariants, filters: { variants?, statuses?, columns?, columnGroup } }`.

### 3. JSON format (default)

```json
{
  "experimentId": "E0001-foo",
  "resultsSchemaVersion": 1,
  "columns": [
    {"key": "precision", "label": "Precision", "group": "parameter", "type": "enum", "options": ["fp32", "bf16"]}
  ],
  "rows": [
    {
      "variantId": "V0001",
      "variantName": "BF16",
      "status": "COMPLETED",
      "runs": ["run-260810-120000"],
      "attempts": [],
      "values": {"precision": "bf16"}
    }
  ],
  "meta": {
    "totalVariants": 3,
    "filteredVariants": 1,
    "filters": {"columnGroup": "all"}
  }
}
```

### 4. Human format

Aligned terminal table with `─` separators. Column widths auto-sized. `null` / missing values render as `—`. Variant ID is bolded (`**V0001**`).

```
experiment: E0001-foo

 Variant    Status      Precision    Loss    Runs    Attempts
 ─────────  ──────────  ───────────  ──────  ──────  ─────────
 **V0001**  COMPLETED   bf16         0.125   1       —
 **V0002**  FAILED      fp32         —       0       1
```

### 5. CSV format

Standard RFC 4180 CSV. Header row uses `snake_case` keys. Variant ID and name are separate columns. `runs` and `attempts` are pipe-joined counts.

```csv
variant_id,variant_name,status,precision,loss,runs_count,attempts_count
V0001,BF16,COMPLETED,bf16,0.125,1,0
V0002,BF16,FAILED,fp32,,0,1
```

### 6. Markdown format

GFM table. Same column order as human. Variant ID bolded.

```markdown
| Variant ID | Variant Name | Status | Precision | Loss | Runs | Attempts |
|------------|--------------|--------|-----------|------|------|----------|
| **V0001** | BF16 | `COMPLETED` | bf16 | 0.125 | 1 | — |
| **V0002** | BF16 | `FAILED` | fp32 | — | 0 | 1 |
```

### 7. YAML format

Structured YAML mirroring the JSON structure. Uses the project's `js-yaml` with `JSON_SCHEMA` for consistency.

### 8. Error handling

| Condition | Exit code | Error code |
|-----------|-----------|------------|
| Experiment not found | `EXIT.NOT_FOUND` (4) | `NOT_FOUND` |
| results.yaml missing | `EXIT.NOT_FOUND` (4) | `RESULTS_NOT_FOUND` |
| results.yaml parse error | `EXIT.BAD_STATE` (3) | `INVALID_RESULTS` |
| No variants match filters | normal output with empty rows | (not an error) |

### 9. Column ordering

Columns are always presented in the order declared in results.yaml, filtered by the `--column` / `--group` options. No reordering.

### 10. Value rendering

- `null` renders as `—` in human/markdown, empty string in CSV, `null` in JSON/YAML.
- `boolean` renders as `true` / `false` (lowercase).
- The `values` map in JSON/YAML contains the raw scalar values.

## Risks / Trade-offs

- CSV `runs_count` / `attempts_count` is a lossy projection (counts instead of IDs). Agents that need run IDs should use JSON/YAML.
- The `--output` flag duplicates part of the global `--format` concept. This is intentional: the global flag only supports `json|human`, and adding `csv|markdown|yaml` there would broaden the contract for all commands.
- No streaming for very large result sets — the entire table is built in memory. Current memon projects rarely exceed hundreds of variants, so this is acceptable.
