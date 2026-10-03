## Context

See proposal.md (Why). State this design builds on (release 8.2.0, which shipped the now-archived change `results-accept-blocked-variants`):

- `packages/core/src/experiments/documents.ts` owns the three schema-v1 YAML documents. Results v1 is `columns` (`key`, `label`, `group: parameter|metric`, `type: string|number|boolean|enum`), optional `column_annotations`, and `variants` (`id`, `name`, `status`, `parameters`/`metrics` as flat scalar maps, `runs`, `attempts`, `provenance{repo,commit,entry,recipe,env}` plus passthrough keys). Any zod failure makes the whole document `data: null`; membership, undeclared columns and type checks are lint (`lintExperimentDocument`, `validateVariant`). `results-eligibility.ts` projects deprecation at read time; `upsertResultColumnAnnotationYaml` is the only focused writer.
- `experiments/mutations.ts` (`create --from-run`) seeds `results.yaml` Variant `V0001` and maps Run status to a Variant status (`INTERRUPTED` → `FAILED`, listed in `attempts`). `run rename` rewrites Variant `runs`/`attempts` paths.
- The FS v8 derived index (`packages/core/src/derived-index/`) stores Run and Experiment entries (`RunEntrySchema`/`ExperimentEntrySchema`, both `.strict()`, `index_version: 1`) with persisted fingerprints `{ino,size,mtime_ms,ctime_ms}`; Experiment `bundle_fp` covers the three YAML files. Central (`packages/backend`) seeds its in-memory index from it and validates entries within 60 s / 300 s windows; detail documents are always read.
- Web: `apps/web/lib/experiment-results/columns.ts` maps each Results column to `schema:<key>`; `sota.ts` only ranks finite numbers; `components/results-table/cells.tsx` renders W&B URLs; Views (central SQLite) reference Variant ids and column ids; the column checkbox strip is horizontal.
- Measured operator state (no names): 30 tracked `results.yaml` files, 218 commits, 1,056 columns, 917 Variants, 928 `runs` entries and 243 `attempts`; 6,591 metric cells of which 3,916 numbers and 1,584 strings (616 `mean ± std`, 214 JSON strings, 348 W&B URLs). The largest file is 1.36 MB / 30,526 lines / 117 commits with 401 Variants (306 COMPLETED, 33 DROPPED, 31 INCONCLUSIVE, 15 PLANNED, 11 FAILED, 2 RUNNING, 3 BLOCKED), 73 columns (55 parameters, 18 metrics), 69 undeclared keys used 335 times and 29 type-mismatched cells. Per-Run JSON sidecars exist in two incompatible shapes (199 + 2 role-tagged Variant snapshots, 84 definition-plus-statistics records); the project's `.gitignore` admits only `README.md` and the sidecar name under `logs/`.

## Goals / Non-Goals

**Goals:** one tracked result file per Run that writers can update without touching shared files; one tracked human-authored description per Experiment; a Variant table that is always regenerable and cannot silently show half-migrated data; first-class statistics that sort, rank and export; a mechanical migration that loses nothing and needs only a few human decisions.

**Non-Goals:** step-indexed or time-series results (Future); a project-wide shared column dictionary (each Experiment describes its own paths); changing `implementation.yaml`, `investigation.yaml`, Run README frontmatter or membership; launching, resuming or scheduling Runs (`run-record-and-resume`, `run-scheduler`); deleting the legacy sidecars; a cross-Experiment results store; editing Variants through new CLI CRUD commands.

## Decisions

### 1. File layout and ownership

```
docs/experiments/E0001-foo/
  README.md               human: narrative, frontmatter (id, slug, title, status, runs, …)   tracked
  implementation.yaml     unchanged (schema_version 1)                                        tracked
  investigation.yaml      unchanged (schema_version 1)                                        tracked
  experiment.json         human: experiment_schema_version, groups, columns, variants         tracked
  schema-upgrades/        human: <N>-to-<N+1>.json | .<ext> transforms                        tracked
logs/a-260901-090000/
  README.md               Run record (unchanged by this change)                               tracked
  result.csv              measurements of the whole Run (path,stat,value)                     tracked
.memon/index/results/
  E0001-foo.json          generated Results summary (never tracked, never edited)             ignored by .memon/index/.gitignore
```

- `experiment.json` is the user-confirmed name: it describes the Experiment's results next to the README and must not duplicate README frontmatter (lint `DESCRIPTION_DUPLICATES_README`). One core constant (`EXPERIMENT_DESCRIPTION_FILE`) names it.
- The cache lives inside the derived index rather than in the bundle so it inherits the self-ignoring `.gitignore`, "rebuildable cache" semantics, the no-absolute-paths rule and `memon index` tooling, and no project ignore rule is needed. Alternative rejected: `results.yaml` kept in the bundle as a generated file — it would need a per-bundle ignore rule, invites hand edits, and keeps the old name meaning something different.
- `result.csv` (user decision) instead of YAML/JSON per Run: one row per value keeps diffs local, appending a value never reformats other values, and CSV is trivially written by training scripts in any language.

### 2. `result.csv` format (confirmed with the user)

```csv
path,stat,value
$experiment_schema_version,,2
params.optim.lr,,0.0001
params.data.splits,,"[""train"",""val""]"
env.CUDA_VERSION,,12.4
metrics.eval.fid,,12.3
metrics.eval.clip,mean,0.312
metrics.eval.clip,std,0.021
metrics.eval.clip,n,500
metrics.serve.latency_ms,max.p99,140.2
metrics.serve.latency_ms,mean.p99,120.1
metrics.notes,,
```

- RFC 4180, UTF-8, LF, header `path,stat,value` on the first line; reserved rows next; value rows in insertion order (an upsert of an existing pair rewrites that line in place, a new pair is appended). Sorting by path was considered for stable diffs but rejected: it would reorder unrelated lines on the first write by a new writer.
- Partitions (first segment): `params`, `metrics`, `env`. Segment grammar `[A-Za-z_][A-Za-z0-9_-]*` (keeps every existing v8 key; dots only separate segments). `$` prefix reserved; `$experiment_schema_version` is the only reserved path in this change. A Variant association row was considered and dropped: Variant `runs` in `experiment.json` is the single association authority.
- Encodings: `number` = JSON number syntax without exponent restrictions; `boolean` = `true`/`false`; `enum` = the option's string form; `list` = one-line JSON array; `string` = raw text (CSV-quoted as needed); empty value = explicit missing.
- `stats`: one-level `stat` ∈ the fixed vocabulary `mean`, `std`, `var`, `sem`, `min`, `max`, `sum`, `n`, `p1`, `p5`, `p10`, `p25`, `p50`, `p75`, `p90`, `p95`, `p99`, `p999`, `ci95_lo`, `ci95_hi` (one constant in core; adding a word is a memon release, never an `experiment_schema_version` change); two levels are spelled `<inner>.<outer>` (`max.p99` = the outer `p99` over the `over` dimension of each unit's inner `max` across the `across` dimension).
- `(path, stat)` unique; duplicates fail the summary (§4). Writers upsert (spec `run-results`); old values survive only in Git history.
- Tracked even where a project ignores Run directories (user decision). Only the reviewed migration edits a project's ignore files (§9): it is reviewed, committed and reverted as one unit, whereas a write path that silently edited `.gitignore` would slip an unrelated tracked change into the user's next commit. Every other memon command that creates a `result.csv` (`memon run result set` here; `run create`, `run record` and `run launch` in `run-record-and-resume`) checks it with `git check-ignore` inside a Git work tree and, when it is ignored, still writes it, keeps its exit code and adds the warning `RESULT_FILE_IGNORED`: the file, the deciding rule (`<ignore file>:<line>:<pattern>`), the allow rules the migration would compute for that Run location (§9) and a copyable command such as `printf '%s\n' '# memon: track per-Run result files (FS v9)' '!/logs/*/result.csv' >> .gitignore` for the user to run and commit. `memon run result lint` and `memon experiment doc lint` report the same warning for an existing ignored result file of a declared Run; skills relay it and change ignore files only with the user's consent. One core function computes the rules for the migration and for the warning, so both always suggest the same lines.

### 3. `experiment.json` shape (confirmed with the user)

```json
{
  "experiment_schema_version": 2,
  "groups": {
    "params.optim": { "label": "Optimizer" },
    "env": { "hidden": true }
  },
  "columns": [
    { "path": "params.optim.lr", "label": "LR", "type": "number" },
    { "path": "params.precision", "label": "Precision", "type": "enum", "options": ["fp32", "bf16"],
      "description": "Training precision.", "value_descriptions": { "bf16": "bfloat16 autocast" } },
    { "path": "metrics.eval.fid", "label": "FID", "type": "number", "direction": "lower" },
    { "path": "metrics.eval.clip", "label": "CLIP", "type": "stats", "across": "sample", "direction": "higher",
      "display": "mean±std" },
    { "path": "metrics.serve.latency_ms", "label": "Latency", "type": "stats", "unit": "ms", "direction": "lower",
      "across": "request", "over": "gpu", "display": "max.p99" },
    { "path": "env.CUDA_VERSION", "label": "CUDA", "type": "string" }
  ],
  "variants": [
    { "id": "V0001", "name": "baseline", "status": "PLANNED",
      "values": { "params.optim.lr": 0.0001, "params.precision": "bf16", "env.CUDA_VERSION": "12.4" },
      "provenance": { "repo": "project-a", "commit": "abc1234", "entry": "scripts/train.sh", "recipe": "configs/a.yaml" },
      "runs": ["logs/a-260901-090000", "logs/a-260902-100000"] },
    { "id": "V0009", "name": "historical", "runs": [],
      "frozen": { "status": "COMPLETED", "runs": ["logs/gone-260101-000000"], "source": "results.yaml@<blob sha>",
                  "values": [ { "path": "metrics.eval.fid", "stat": null, "value": 13.1 } ] } }
  ]
}
```

- Annotations sit on the column (`description`, `value_descriptions`); the spec keys them by path, which this satisfies.
- `display`: one vocabulary statistic (or two-level stat) or one of the templates `mean±std`, `mean±sem`, `mean (min–max)`, `mean [ci95]`, `p50 (p25–p75)`, `p50/p99`; a cell aggregated across Runs defaults to `mean ± std (n)`. `hidden` on a column or group is the default visibility; `env` is hidden by default. Writing first and describing later: a Run may record any path; a column entry only adds label/type/unit/direction/options/display for a recorded path; undeclared paths are shown with inferred types after the declared columns of their group, and lint reports only conflicts (type violations, scalar-vs-stats disagreement between Runs, unknown statistics).
- Optional column defaults (implementation refinement): `decimals` (0–10) and `format` (`auto`, `fixed`, `scientific`, `percent`) for numbers, `stats` (the statistics a `stats` column is expected to carry, offered by the display dropdown before any Run records them) and `sort_by` (the default statistic for sorting, filters and SOTA; else the statistic the display selects, else `mean`). A View's stats and decimal settings override them. `display`/`sort_by` apply to `stats` and `number` columns; a column with `over` takes `<inner>.<outer>` statistics only. Core publishes an editor JSON Schema (`packages/core/src/results/experiment.schema.json`, exported as `EXPERIMENT_DESCRIPTION_JSON_SCHEMA`) mirroring the zod schema.
- Variant `status` (declared) ∈ {PLANNED, BLOCKED, DROPPED, INCONCLUSIVE}; the schema accepts the seven effective statuses so that `RUNNING`/`COMPLETED`/`FAILED` are reported as the lint error `DERIVED_STATUS_DECLARED`, and rejects any other value naming the four declarable ones. `values` holds declared parameter/env values only (a `metrics.*` key is the lint error `VARIANT_VALUE_PARTITION`); `frozen` is written only by the migration and transformed by schema upgrades. Unknown keys are preserved (writers patch JSON by key path, never re-serialize unknown members away). Serialization: two-space indentation, stable key order for known keys, trailing newline.

### 4. Results summary (cache) and its generator

Draft cache shape (`summary_version: 1`, in `.memon/index/results/<experiment-id>.json`):

```json
{
  "summary_version": 1, "experiment": "E0001-foo", "experiment_schema_version": 2,
  "generated_at": "2026-10-02T12:00:00+08:00", "generator": { "release": "9.0.0", "role": "cli" },
  "inputs": { "docs/experiments/E0001-foo/experiment.json": { "ino": 1, "size": 2, "mtime_ms": 3, "ctime_ms": 4 },
              "logs/a-260901-090000/README.md": { "…": "…" }, "logs/a-260901-090000/result.csv": null },
  "newest_input_mtime": "2026-10-02T11:58:00+08:00",
  "outcome": "ok",
  "error": null,
  "columns": [ { "path": "metrics.eval.fid", "type": "number", "declared": true } ],
  "variants": [ { "id": "V0001", "status": "COMPLETED", "declared_status": "PLANNED",
                  "evidence": ["logs/a-260901-090000", "logs/a-260902-100000"],
                  "others": [ { "run": "logs/a-260903-110000", "status": "FAILED", "stop_reason": null } ],
                  "cells": { "metrics.eval.fid": { "kind": "stats", "over": "run",
                               "values": { "mean": 11, "std": 1.414, "min": 10, "max": 12, "n": 2 }, "source": "runs" } } } ],
  "diagnostics": [],
  "digest": "sha256:…"
}
```

Generation (pure function of the inputs, deterministic order):

```
generate(E):
  def = parse(experiment.json)              # failure → outcome=failed, INVALID_RESULTS
  members = README(E).runs (resolved paths)
  for r in members: rec[r] = parseRunReadme(r); csv[r] = parseResultCsv(r) or ABSENT
  bad = [r for r in members if csv[r] != ABSENT and csv[r].version != def.version]
      + [r for r in members if csv[r] != ABSENT and csv[r].version missing]
  if bad: fail(RESULT_SCHEMA_MISMATCH, files=bad, cmd="memon experiment schema upgrade E --to def.version")
  dups = [(r, lines) for r in members if csv[r].duplicates]
  if dups: fail(RESULT_DUPLICATE_ROW, files=dups)
  for v in def.variants:
     listed = [r for r in v.runs if r in members]               # non-members → lint only
     evidence = [r for r in listed if rec[r].status == FINISHED and not rec[r].deprecated]
     status = derive(v.status, [rec[r] for r in listed], v.frozen)   # spec order; INTERRUPTED → RUNNING
     for col in def.columns (+ undeclared paths seen):
        cell = aggregate([csv[r].value(col) for r in evidence]) or declared(v.values, col) or frozen(v, col)
  write atomically (tmp + rename), digest over canonical JSON without the digest field
```

Aggregation: one evidence Run → its value verbatim. Several → numbers of the `metrics` partition become one-level stats over `run` with `n`, `mean`, `min`, `max`, `sum`, every vocabulary percentile (linear interpolation) and, for n ≥ 2, `std`/`var` (sample, n−1), `sem` and Student-t `ci95_lo`/`ci95_hi`; default display `mean ± std (n)`; each statistic `s` of a one-level stats value becomes `s.<outer>` statistics over `run` (two levels); two-level values are not aggregated (cell kind `per_run`). Non-numeric values, and every `params`/`env` value (seeds share their configuration, so `0.0001 ± 0 (3)` would mislead): equal → shown once; otherwise `mixed` with per-Run values. A single non-empty value among several evidence Runs is shown verbatim. Planned `values` fill cells only for Variants without an evidence value and are compared with evidence values; a difference raises `VARIANT_PARAM_MISMATCH` and marks the cell (tooltip shows the planned value). When a column display names a one-level statistic and the cell was aggregated over Runs, the display shows that statistic's across-Run mean and the tooltip shows the rest; `mean±std` shows `mean.mean ± mean.std`.

Freshness: a stored summary is reused only when its digest matches, it was generated by the reader's memon release, and its input set and fingerprints equal the current ones. CLI readers stat every input each request (≈ 2 stats per member: README and `result.csv`); central decides member freshness from its seeded index entries within the member windows (no per-request member stat), reads `experiment.json` every request, and regenerates in the background validator for active Projects. A cold 448-member detail therefore costs one description read plus, only when stale, one regeneration (≈ 900 reads) — regeneration is the price of correctness after a change, not of every request.

### 5. Relation to the v8 derived index

- `index_version: 2`: Run entries add `result_fp` and `result_schema_version` (read from the reserved head of `result.csv`, which is why reserved rows come first); Experiment `bundle_fp` becomes `{implementation, investigation, description}`; snapshot layout adds `results/`. Events keep their shape; an event for a result write upserts the Run entry with its new `result_fp`.
- v9 readers ignore v1 files; the migration rebuilds the index; compaction may delete v1 events older than one hour (their changes are reached through fingerprints). The rebuild deletes summaries of unknown Experiments.
- Writers of inputs only publish their usual index event; they never regenerate summaries (freshness is fingerprint-based). This keeps a 400-Run Experiment from paying an O(N) regeneration per Run write.

### 6. Experiment schema version and upgrades

- `experiment_schema_version` lives in `experiment.json`, in every member `result.csv` (reserved row) and in the summary. It is not the FS convention version and no other format version is written into these files.
- Transform files, `schema-upgrades/1-to-2.json`:

```json
{ "from": 1, "to": 2, "operations": [
  { "op": "rename", "from": "metrics.fid", "to": "metrics.eval.fid" },
  { "op": "move", "from": "params.lr_group", "to": "params.optim" },
  { "op": "scale", "path": "metrics.serve.latency", "factor": 1000, "offset": 0, "unit": "ms" },
  { "op": "delete", "path": "metrics.debug" },
  { "op": "default", "path": "params.precision", "value": "bf16" } ] }
```

  `move` renames a group prefix (paths and `groups` keys); `delete` removes a path or group; `scale` takes a positive `factor` and an `offset` (`x → factor·x + offset`, optional new `unit`) and transforms each statistic by its kind — location statistics (`mean`, `min`, `max`, percentiles, `ci95_*`) like values, `std`/`sem` by the factor, `var` by its square, `n` unchanged, `sum` with an offset only when the value carries `n`, two-level statistics by composing both levels; `default` adds a row only where the pair is absent (result tables and frozen values, never planned values). A complex upgrade is one Python script `schema-upgrades/1-to-2.py`, run as `python3 <script> <input.csv> <output.csv>` (environment `MEMON_SCHEMA_FROM`/`MEMON_SCHEMA_TO`, a scratch working directory) once per member result file and, while the description file records the older version, once per Variant for its planned values and once for its frozen values, each presented as a result table; memon then records the new version, and the author edits the column definitions by hand. Declarative transforms also rewrite the description file's column paths, groups, units, planned and frozen values whenever it records the older version.
- `memon experiment schema upgrade E --to N [--apply]`:

```
plan:  chain = steps(fileVersion(f) .. N) for every member result.csv and experiment.json
       missing step → BAD_REQUEST; transform in memory; diff per file; print
apply: refuse BAD_STATE if any member status == RUNNING
       backup: .memon/backups/schema-upgrade/<E>-<from>-to-<N>-<YYMMDD-HHMMSS>/ (copy every file to change)
       for f in files: re-stat; if fingerprint != planned → abort+rollback
                       write tmp; rename over f
       verify: every file parses, records N, has no duplicate pair, summary(E) succeeds
       on failure: restore all from backup (rename), report, exit 1
       on success: print changed paths; the user reviews and commits them
```

  The backup directory follows the existing `.memon/backups/` convention (never deleted automatically); memon creates `.memon/backups/.gitignore` (`*`) when it creates the directory so backups never enter the tracked tree. A transform that would produce a duplicate pair is listed as a problem in the dry run; applying it fails verification and restores every file. Refusing only on `RUNNING` (not `PENDING`): a pending Run creates its file later with the then-current version.

### 7. Variant status and association

- Association authority: `variants[].runs` in `experiment.json` (subset of README `runs`). Membership authority stays the README. Unlink edits only the README (the Variant entry then lints as `VARIANT_RUN_NOT_EXPERIMENT_MEMBER`, as in v8); rename rewrites both.
- `attempts` disappears; evidence = FINISHED ∧ ¬deprecated. A finished Run that should not count is deprecated (existing mechanism, reversible). This is the only semantic change that needs human decisions in the migration (§9).
- Declared statuses are plan/judgment states; derived ones come from Run records, so a launcher or scheduler changing a Run status needs no Experiment write. `INTERRUPTED` → `RUNNING` fixes the v8 import mapping and stays correct once `run-record-and-resume` makes `INTERRUPTED` non-terminal.

### 8. CLI

| Command | Notes |
|---|---|
| `memon run result get <run> [--path p]` | parsed rows + diagnostics; read-only |
| `memon run result set <run> path[:stat]=value… [--from file.csv\|-] [--unset path[:stat]…] [--expected-hash h]` | validates types against the owner's columns; atomic upsert; receipt + index event; `RESULT_FILE_IGNORED` warning when it creates an ignored file (§2) |
| `memon run result lint <run>` | `run-results` diagnostics (incl. `RESULT_FILE_IGNORED`) |
| `memon experiment results table\|summary` | from the summary; error envelope with `details.files` and `details.upgradeCommand` |
| `memon experiment results rebuild [<id>\|--all]` | writes only `.memon/index/results/` |
| `memon experiment results annotation get\|set` | edits `experiment.json` |
| `memon experiment schema upgrade <id> --to N [--apply]` | §6 |

CSV export flattens a stats column into `path:stat` columns (CLI only — the Web table never does). Exit codes follow the existing table (mismatch and duplicates → 1; invalid input → 2; conflict → 9).

### 9. Migration v8 → v9

Planner (read-only, per Experiment with `results.yaml`, lenient YAML read):

| v8 source | v9 destination |
|---|---|
| `columns[].key/label/type/options`, `group` | `columns[]` with path `params.<key>` / `metrics.<key>`; type widened to `stats` when any cell converts to stats, to a group when JSON scalar mappings expand |
| `column_annotations` | column `description` / `value_descriptions` |
| undeclared keys (lint errors in v8) | left undeclared: written as recorded values, shown with inferred types (report counts them) |
| Variant `id/name/description` | same |
| Variant `status` PLANNED/BLOCKED/DROPPED/INCONCLUSIVE | declared `status` |
| Variant `status` RUNNING/COMPLETED/FAILED | dropped (derived); plan reports `VARIANT_STATUS_CHANGED` when the derived value differs |
| `parameters` | Variant `values` (`params.*`) |
| `provenance.env` | Variant `values` (`env.*`, strings) + hidden `env` columns |
| other `provenance` keys | Variant `provenance` (extra keys preserved) |
| `runs` ∪ `attempts` | Variant `runs` (runs first), except `FINISHED`, non-deprecated attempts, which by default go to `frozen.attempts` (below) |
| `metrics` of a Variant whose v8 `runs` lists exactly one Run, when that directory exists and the Run will be evidence (`FINISHED`, not deprecated, after resolutions) | that Run's `result.csv` |
| `metrics` not attributable to an existing directory, or Variant-level values not reproduced by per-Run data | Variant `frozen` (also created, without values, to keep a derived v8 status of a Variant left without listed member Runs) |
| unknown top-level/Variant keys | preserved in `experiment.json` |

Value conversions (per cell): `^\s*([-+0-9.eE]+)\s*(±|\+/-)\s*([-+0-9.eE]+)\s*$` → `mean`,`std`; JSON object whose keys map onto the vocabulary (`sample_std`/`stdev`→`std`, `count`/`eligible_seeds`→`n`, `median`→`p50`) → stats rows (other numeric keys become sibling leaves `<path>_<key>`); JSON object of scalars → group expansion (`<path>.<key>`); JSON array → `list`; anything else stays a string (`RESULT_JSON_STRING` for JSON text). A metric column takes the majority convertible shape of its non-empty cells (stats = statistics cells plus, when there is at least one, the plain numbers, which become `mean` rows with `MIGRATED_NUMBER_AS_MEAN`; ties prefer stats, then list); a group expansion needs every non-empty cell to be a group (a leaf cannot share a group's path); a column with no convertible cell keeps its v8 type. Empty cells stay missing. A cell that does not fit the column's shape (e.g. `0.65 ± —`, `n/a`) stays verbatim on its own (`RESULT_CELL_NOT_CONVERTED`, one notice per cell) and the migrated lint lists it as a type mismatch the plan predicts; the rest of the column still converts. (Revised after the first real-project plan, where one unparseable cell per column kept 606 `±` columns as strings; user decision 2026-10-03.) Parameter values are copied verbatim. W&B URLs stay strings. Type mismatches stay verbatim (lint errors, as in v8). Keys whose segments do not fit the path grammar are sanitized (`RESULT_PATH_SANITIZED`).

Sidecars: the operator passes the sidecar file name (`--sidecar-name <name>`, recorded in `LOCAL.md`); only listed Run directories are inspected (no walk). Shape A (role-tagged Variant snapshot: `variant_id`, `role`, `baseline{parameters,metrics,provenance}`) and shape B (definition-plus-statistics: `variant`, `definition{parameters}`, `metrics`, `statistics{m:{mean,sample_std,min,max,eligible_seeds,…}}`) become `result.csv` rows; parameters equal to the Variant's declared values are not duplicated; a sidecar naming another Variant than the one listing the Run is a blocker. Sidecars stay in place.

Blockers (apply refuses until a `--resolutions <json>` entry exists): `RUN_IN_TWO_VARIANTS` (choose), `VARIANT_RUN_NOT_MEMBER` (link | drop), `RESULT_FILE_EXISTS` (keep | replace; only for an existing file that is already a version-1 result table), `RESULTS_YAML_UNREADABLE` (fix by hand), `SIDECAR_VARIANT_CONFLICT` (choose), `RUN_PATH_OUTSIDE_PROJECT` (fix by hand: a declared Run path resolves through a symbolic link outside the project root), `RUN_PATH_ALIASED` (fix by hand: two declared Run paths with planned writes resolve to the same directory), `RUN_README_IGNORED` (adopt instead, or the user tracks the README: a `deprecate` resolution would edit a Run README that Git ignores, so the scoped commit could not include it — found at plan time rather than at `git add`). An ignored `result.csv` is not a blocker (user decision): the plan adds allow rules for it (below). Apply writes resolutions (`deprecated: true` in chosen Run READMEs, Experiment README `runs` additions for `link`) inside the migration commit.

Defaults that are not blockers (user decision 2026-10-03, after the first real-project plan reported 123 finished attempts and 19 foreign result files). Each is counted separately in the plan (`finishedAttemptsKept`, `legacyResultFilesRenamed`, next to `PLUS_MINUS_TO_STATS`/`MIGRATED_NUMBER_AS_MEAN`/`RESULT_CELL_NOT_CONVERTED`) and can still be overridden in the resolutions file under the former blocker id:
- Finished attempt (`FINISHED_ATTEMPT:<experiment>:<run>`): a `FINISHED`, non-deprecated Run in a v8 `attempts` list (and not in `runs`) is kept as the Variant's history — listed in `frozen.attempts` of `experiment.json`, not in the Variant `runs`, so it is never evidence; the Variant's v8 values follow the attribution rule above (frozen when no single member Run carries them). Warning `FINISHED_ATTEMPT_KEPT_AS_HISTORY`. Overrides: `deprecate` (writes `deprecated: true` into the Run README) or `adopt` (member and evidence).
- Foreign result file (`RESULT_FILE_EXISTS:<experiment>:<run>`): an existing `result.csv` of a listed Run that is not a version-1 result table is renamed to `result.legacy.csv` (first free `result.legacy.<N>.csv`, N ≥ 2, when taken) and the migrated table, if any, is written as `result.csv` (else `result.csv` is deleted). `plan.legacyRenames` lists every rename; the legacy file is a planned `create` (backed up, verified, restored by rollback) and is committed with `git add --force` because Run-directory ignore rules usually cover it. A deleted `result.csv` that Git never tracked is left out of the commit; after `git revert`, rollback restores from the backup any touched file whose previous bytes Git did not track. Overrides: `keep` (summary fails until fixed, `RESULT_FILE_KEPT_INVALID`) or `replace`.

Ignored result files (git mode). Operator projects often ignore everything in Run directories except `README.md`. Instead of stopping, the planner computes the smallest allow rules from the rules that actually ignore the files and shows them before anything is written:

```
probes = <runDir>/result.csv, <runDir>/ and each directory between it and its Run location root,
         for every Run directory an Experiment declares (whether or not a file is planned for it)
decide = git check-ignore --no-index --verbose --stdin over the probes  → <ignore file>:<line>:<pattern>
for each (deciding ignore file F, effective Run location L) with an ignored result probe:
  target = F when F is a .gitignore inside the project root, else <projectRoot>/.gitignore
           (rules from .git/info/exclude, core.excludesFile or a .gitignore above the root lose to it)
  no directory on the way excluded → append !/<L>/result.csv
  directory D on the way excluded  → Git cannot re-include a file below an excluded directory, so append
                                     the re-inclusion ladder from D down to the Run directories
  paths are anchored and relative to target's directory; one comment line heads each appended block
```

Example: a `.gitignore` that excludes the directory `logs/` (Run location `logs/*`) gets

```
# memon: track per-Run result files (FS v9)
!/logs/
/logs/*
!/logs/*/
/logs/*/*
!/logs/*/result.csv
```

which re-includes only `logs/`, its Run directories and their `result.csv`; everything else under `logs/` stays ignored. A project that ignores the files inside Run directories (no directory excluded) gets the single line `!/logs/*/result.csv`. Rules are written per Run location, not per file, so later Runs at the same location are covered. The plan lists, per target file, the lines to append, the deciding rules they override and the Run directories they cover. Apply only appends; existing lines are never edited or reordered. The edited ignore files are touched paths: backed up, verified, committed with the migration and restored by `rollback` (before the commit from the backup or `HEAD`, after it by `git revert`). Non-git projects need no rules.

Symlinked Run paths (found on the first real-project plan: declared Runs under `logs/` that are symlinks to real directories elsewhere in the project). `git check-ignore` and `git add` abort on any path beyond a symbolic link, so every place that probes or writes a declared Run's `result.csv` — `planResultAllowRules`, the planner's file list, apply's ignore verification, `verify`, the core writer behind `memon run result set`, and Verification step 8 of the guide — first resolves the Run directory with `realpath` (one core helper, `resolveRunRealPath`). A target inside the project root is planned, probed, written and committed at its project-relative real path (the allow rules follow the real path's Run location; the summary still reads members by their declared path, which reaches the same file). A target outside the project root is never probed or written: the planner reports `RUN_PATH_OUTSIDE_PROJECT`, verification reports a problem, and the writer refuses with `RUN_PATH_OUTSIDE_PROJECT` (`BAD_STATE`).

Apply → verify → commit: backup into an operator-supplied directory outside the project (every touched file's previous bytes, the marker and `.memon/index/`; git: clean tree required); write `experiment.json`, `result.csv` files, pointer line, resolution edits, allow rules; delete `results.yaml`; rebuild index v2 and all summaries; verify (1) every bundle lints with no error beyond those the plan predicted for the planned bundle (the v8 problems carried over, such as type mismatches), (2) every v8 cell is shown by the regenerated summary unchanged (modulo listed conversions) — as a recorded, planned or frozen value — unless the plan reported that difference, (3) `git check-ignore` reports no `result.csv` of a declared Run as ignored and every summary as ignored, (4) `git ls-files --others --exclude-standard` lists no path that it did not list before apply other than planned files (the allow rules exposed nothing else); a failed check restores every touched file (ignore files included) and the index from the backup, leaves marker 8 and commits nothing; then marker 9; commit exactly the touched paths, edited ignore files included, with `chore(memon): migrate FS convention v8 -> v9`. The plan stores the planned file contents (operator plan file, mode 0600, outside the project); apply refuses a plan whose source files changed. Core API: `planResultsMigration`, `applyResultsMigration`, `verifyResultsMigration`, `rollbackResultsMigration` in `packages/core/src/migrations/v8-to-v9.ts`. Operator entry `scripts/migrate-v8-to-v9.{mjs,md}` (plan/apply/verify/rollback), modelled on the v7→v8 entry.

### 10. Web

- Results card reads the summary (detail response embeds it with `newest_input_mtime`; Refresh hits the snapshot route which re-takes fingerprints). Error card for mismatch/duplicates (code, files, copyable upgrade command).
- Column panel: a vertical, collapsible tree replacing the horizontal checkbox strip (partitions `params`, `metrics`, `env`; undeclared columns included); tri-state checkboxes; distinct-value counts on leaves; metric styling by partition. Ordering by vertical drag in the tree (dnd constrained to the node's parent; group = block); header drag optional and follows the same rule. Displayed unpinned columns of a group are contiguous by construction (the table order is a depth-first walk of the tree).
- Pinning per column; pinned columns render after the always-first Variant name column with a breadcrumb header (`Optimizer › LR`) and are listed in a "Pinned" section at the top of the tree where vertical drag orders them; unpinning restores the previous in-group position.
- Header: two stacked rows — the first-level group label spanning its contiguous columns, then the column label with deeper group labels merged (`adam › beta1`); groups collapse to a one-column placeholder (label + visible count), independent of hiding; collapsed state lives in the View.
- Stats: always one column per stats path, header dropdown (vocabulary statistics the column carries + templates), sort/filter/SOTA on the selected statistic with the column direction; frozen / mixed / per-run / differs-from-plan markers.
- shadcn only (Tree built from existing primitives — `Checkbox`, `Collapsible`, `DropdownMenu`, `Badge`, `Tooltip`; no forked primitive); F1 verification on a 3742 preview.
- View defaults (confirmed): checked state stored on the changed node and inherited downward, so a later column follows its group; a new column is appended at the end of its group; personal checks, order, collapse and pins live in saved Views, while `experiment.json` supplies only the declaration order and default visibility (`env` hidden); one left pinned zone after the Variant name column (a stored right pin renders at the end of the left zone).
- Views: new fields `nodeVisibility`, `treeOrder`, `collapsedGroups`, `pinned` (ordered), `statsDisplay{columnId: selection}`, `statsSort{columnId: stat}`; validation accepts only vocabulary-built selections; legacy `schema:<key>` ids resolve at render to the unique `params.<key>`/`metrics.<key>` and are persisted on the owner's next save.

### 11. Skills

`memon-write-experiment-doc` (+ `references/experiment-bundle.md`): `experiment.json` replaces `results.yaml` in the routing table; Variant `runs` editing rules; stats rows; schema upgrade procedure. `memon-run-experiment`: record results with `memon run result set`; no `attempts`; deprecate instead of moving to attempts. `memon-write-script`: launcher may print values but must not write `result.csv` itself unless through `memon run result set` later. `memon-read-results`, `memon-propose`, `memon-drive`: read via `memon experiment results table|summary`, handle `RESULT_SCHEMA_MISMATCH` by reporting. `memon-migrate-fs`: v8→v9 step, presenting the planned allow rules with the rest of the plan. A skill that receives `RESULT_FILE_IGNORED` shows the user the deciding rule and the fix command and changes ignore files only with the user's consent. Preflight unchanged.

### 12. CLI nodes, central and release

Release 9.0.0 (`MEMON_CHANGED_SURFACES=central,cli,skills,filesystem`). Order: deploy central 9.0.0; `memon update` every CLI node; then migrate each project (v8 skills stop on a v9 marker with `MEMON_TOO_OLD`; a v9 CLI on an unmigrated project fails Results reads with `NOT_FOUND experiment.json` and reports `LEGACY_RESULTS_YAML`, so migrate promptly). Central reads both states without crashing: an unmigrated bundle shows the `NOT_FOUND` state on its Results card.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Hundreds of small `result.csv` files are slower to read cold on NFS than one YAML | Summary cache + fingerprints; central decides freshness from the index windows; regeneration only on change |
| Strict version gate blocks a whole table for one stale file | That is the requested behavior; the error lists every file and the exact command; other Experiments and sections are unaffected |
| Operators' ignore rules exclude Run directory files, so `result.csv` would be silently untracked | The migration appends minimal computed allow rules (shown in the plan, verified fail-closed with `git check-ignore`, committed with the migration, removed by rollback); afterwards writers warn `RESULT_FILE_IGNORED` with the fix command instead of editing ignore files |
| Re-including directories below an excluded one makes Git read each Run directory | Only the directories leading to `result.csv` are re-included and everything else inside them stays ignored, so Git lists each Run directory once and descends no further |
| Dropping `attempts` changes what counts as evidence | Derived rule is explicit; finished attempts are kept as Variant history (`frozen.attempts`, never evidence) by default and can be deprecated or adopted through resolutions |
| Undeclared paths with typos create stray columns | Lint lists inferred columns with their recording Runs; declaring or renaming them is one upgrade transform |
| Views reference flat keys | Read-time alias, persisted on next owner save; no SQLite rewrite during the FS migration |
| Concurrent upserts to one `result.csv` (rare: a Run is one writer) | Atomic replace + optional expected-hash lock; conflicts exit 9 |
| JSON is less forgiving to hand-edit than YAML | Lint pinpoints syntax errors; writers preserve unknown keys and formatting; agents validate after edits |
| Summary schema/aggregation bugs | Deterministic generator with golden tests on the mock project and on an anonymised copy of the largest Experiment; migration verification compares every v8 cell |

## Migration Plan

1. Implement and release 9.0.0 (central + CLI + skills) with the guide and operator script.
2. Deploy central; `memon update` on every CLI node (skills refreshed).
3. Per operator project: `plan` (read-only) → review blockers, warnings and the planned allow rules → write resolutions → `apply` (clean tree; appends the allow rules) → `verify` → migration commit (ignore-file edits included); record project-specific facts (sidecar name, backup path) only in `LOCAL.md`.
4. Rollback: `git revert` of the migration commit (marker 8, `results.yaml` back, allow rules removed), or the non-git tarball; deleting `.memon/index/` is always safe. Central 9.0.0 keeps serving an unmigrated project read-only for Results (NOT_FOUND state) until the revert is deployed with 8.x tooling.

## Future

- Step-indexed results (evaluation curves, best-checkpoint selection) — handled per Experiment for now; a later change may add a separate per-Run time-series file.
- A focused writer for Variant declarations if direct JSON editing proves error-prone.
