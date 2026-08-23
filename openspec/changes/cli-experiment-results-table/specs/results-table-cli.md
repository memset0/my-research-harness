# Experiment Results Table CLI — Spec

## Contract

`memon experiment results table <id-or-slug>` is a read-only command that
projects `results.yaml` into a flat, filterable table.

### Input

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `<id-or-slug>` | string | yes | Experiment ID (`E<NNNN>-<slug>`) or slug |
| `--variant <ids>` | string | no | Comma-separated Variant IDs |
| `--status <statuses>` | string | no | Comma-separated status values |
| `--column <keys>` | string | no | Comma-separated column keys |
| `--group <group>` | string | no | `parameter`, `metric`, or `all` |
| `--output <fmt>` | string | no | `json`, `human`, `csv`, `markdown`, `yaml` |

### Output envelope

```jsonc
{
  "experimentId": "E0001-foo",
  "resultsSchemaVersion": 1,
  "columns": [...],
  "rows": [...],
  "meta": {
    "totalVariants": number,
    "filteredVariants": number,
    "filters": { "columnGroup": string, "variants"?: string[], "statuses"?: string[], "columns"?: string[] }
  }
}
```

### Row shape

```jsonc
{
  "variantId": "V0001",
  "variantName": "BF16",
  "status": "COMPLETED",
  "runs": ["run-a"],
  "attempts": [],
  "values": { "precision": "bf16", "accuracy": 0.95 }
}
```

### Error contract

| Condition | stderr envelope | exit code |
|-----------|-----------------|-----------|
| Experiment not found | `{"error":{"code":"NOT_FOUND","message":"..."}}` | 4 |
| results.yaml missing | `{"error":{"code":"NOT_FOUND","message":"..."}}` | 4 |
| results.yaml invalid | `{"error":{"code":"INVALID_RESULTS","message":"..."}}` | 1 |
| Malformed CLI usage | Commander default | 2 |

### Format definitions

- **json**: `JSON.stringify(value, null, 2)` via `emitJson`.
- **human**: `renderHumanTable()` — aligned table with `─` separators, bold IDs.
- **csv**: RFC 4180 with header row; `runs_count` / `attempts_count` columns.
- **markdown**: GFM table with `─`-style separators.
- **yaml**: JSON envelope emitted via `emitJson` (same structure, different consumer).

### Filter composition

All filters are ANDed. Column filters (`--column`, `--group`) apply after the
group filter; if `--column` is specified, `--group` further restricts the
intersection but does not expand it.

### Column ordering

Columns preserve their declaration order from `results.yaml`, filtered by
`--column` / `--group`. No reordering occurs.

### Null / missing values

- `null` in JSON/YAML `values` map → `—` in human/markdown, empty string in CSV.
- Missing key (column selected but variant has no value) → `null` in JSON/YAML,
  `—` in human/markdown, empty string in CSV.
