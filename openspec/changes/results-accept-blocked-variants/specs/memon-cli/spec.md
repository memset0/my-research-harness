## MODIFIED Requirements

### Requirement: `memon experiment results table` reads results as a selectable flat table

`memon experiment results table <id-or-slug> [--variant <ids>] [--status <statuses>] [--column <keys>] [--group <group>] [--output <fmt>]` SHALL read `results.yaml` for the named experiment, project it as a flat table with one row per Variant, and emit the result in the requested format.

**Filters:**

| Flag | Purpose |
|------|---------|
| `--variant <ids>` | Comma-separated Variant IDs to include (default: all) |
| `--status <statuses>` | Comma-separated status values (`PLANNED`/`BLOCKED`/`RUNNING`/`COMPLETED`/`FAILED`/`INCONCLUSIVE`/`DROPPED`), matched case-insensitively |
| `--column <keys>` | Comma-separated column keys to include (default: all) |
| `--group <group>` | Column group filter: `parameter`, `metric`, or `all` (default: `all`) |

Filters are AND-composed. Column ordering preserves the declaration order from `results.yaml`.

**Output formats (`--output`):**

| Format | Behavior |
|--------|----------|
| `json` (default) | Structured object with `experimentId`, `resultsSchemaVersion`, `columns`, `rows`, `meta` |
| `human` | Aligned terminal table with `─` separators |
| `csv` | RFC 4180 CSV; `runs_count` / `attempts_count` as integer columns |
| `markdown` | GFM table with bold Variant IDs |
| `yaml` | Structured YAML mirroring the JSON envelope |

**Row shape (JSON/YAML):**

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

**Meta shape:**

```jsonc
{
  "totalVariants": 3,
  "filteredVariants": 1,
  "filters": { "columnGroup": "metric", "variants": ["V0001"], "columns": ["accuracy"] }
}
```

**Error contract:**

| Condition | exit code | stderr `error.code` |
|-----------|-----------|---------------------|
| Experiment not found | 4 (`NOT_FOUND`) | `NOT_FOUND` |
| `results.yaml` missing | 4 (`NOT_FOUND`) | `NOT_FOUND` |
| `results.yaml` parse error | 1 (`GENERIC`) | `INVALID_RESULTS` |

Empty filter results are not errors — the command returns zero rows with `meta.filteredVariants: 0`.

#### Scenario: Default JSON output returns all variants
- **WHEN** the user runs `memon experiment results table E0001-foo --output json`
- **THEN** stdout is valid JSON with `rows.length` equal to the number of variants in `results.yaml`
- **AND** each row contains `variantId`, `variantName`, `status`, `runs`, `attempts`, and `values`

#### Scenario: --variant filters to specific Variants
- **WHEN** the user runs `memon experiment results table E0001-foo --variant V0001,V0003 --output json`
- **THEN** only rows whose `variantId` is `V0001` or `V0003` appear in `rows`
- **AND** `meta.filters.variants` is `["V0001", "V0003"]`

#### Scenario: --status selects blocked Variants
- **GIVEN** a `results.yaml` with one `BLOCKED` Variant and one `COMPLETED` Variant
- **WHEN** the user runs `memon experiment results table E0001-foo --status blocked --output json`
- **THEN** `rows` contains only the `BLOCKED` Variant with `status: "BLOCKED"`
- **AND** `meta.filters.statuses` is `["blocked"]`

#### Scenario: --group metric excludes parameter columns
- **WHEN** the user runs `memon experiment results table E0001-foo --group metric --output json`
- **THEN** every column in `columns` has `group: "metric"`
- **AND** `meta.filters.columnGroup` is `"metric"`

#### Scenario: --output csv produces RFC 4180 output
- **WHEN** the user runs `memon experiment results table E0001-foo --output csv`
- **THEN** the first line is a comma-separated header: `variant_id,variant_name,status,<column keys...>,runs_count,attempts_count`
- **AND** each subsequent line is a data row with values in the same column order

#### Scenario: Missing results.yaml exits NOT_FOUND
- **GIVEN** an experiment with no `results.yaml`
- **WHEN** `memon experiment results table <id>` runs
- **THEN** stderr contains `{"error":{"code":"NOT_FOUND","message":"results.yaml not found for experiment \"<id>\""}}`
- **AND** exit code is 4
