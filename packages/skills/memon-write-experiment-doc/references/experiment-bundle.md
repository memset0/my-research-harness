# Experiment bundle contract

This file is the canonical skill-side reference for the current Experiment
document bundle. Callers should invoke `memon-write-experiment-doc` instead of
copying this contract into their own skill.

## Contents

- [Layout and README order](#layout-and-readme-order)
- [`implementation.yaml` schema v1](#implementationyaml-schema-v1)
- [`investigation.yaml` schema v1](#investigationyaml-schema-v1)
- [`experiment.json` — the Results description](#experimentjson--the-results-description)
- [`result.csv` — one Run's measurements](#resultcsv--one-runs-measurements)
- [Result schema versions and upgrades](#result-schema-versions-and-upgrades)
- [Warnings table](#warnings-table)
- [Hierarchy, dependency, and IDs](#hierarchy-dependency-and-ids)
- [Routing reference](#routing-reference)
- [Versioning and rendering](#versioning-and-rendering)

## Run reference authority

Store each member in README frontmatter `runs` as a POSIX directory path
relative to the project root, for example `logs/trial-260908-120000`. The
README `runs` is the membership authority; use exactly the same paths in the
Variant `runs` of `experiment.json`, which is the association authority (every
Variant Run must be a README member, and a Run belongs to at most one Variant).
Do not use bare IDs, absolute paths, traversal, or paths escaping through
symlinks. An existing path may belong to at most one Experiment. An unassigned
Run is valid. Resolve members directly; do not scan unrelated Run directories
or output trees. Never write or infer ownership from a Run README's retired
`experiment` field. Rename an Experiment without rewriting member Run READMEs;
rename a Run with `memon run rename`, which rewrites the README `runs` entry and
the Variant `runs` entry and moves the Run's `result.csv` with its directory.

## Layout and README order

```text
docs/experiments/E<NNNN>-<slug>/
├── README.md
├── implementation.yaml
├── investigation.yaml
├── experiment.json     # Results description: columns, groups, Variants
├── schema-upgrades/    # optional; <N>-to-<N+1>.json|.py result-schema transforms
└── code-review/        # optional; create only when a review exists

logs/<run>-<YYMMDD>-<HHMMSS>/
├── README.md           # the Run record
└── result.csv          # optional; the Run's measurements (path,stat,value)

.memon/index/results/E<NNNN>-<slug>.json   # generated Results summary — never read, write or commit
```

The Variant table is generated from `experiment.json`, the member Run READMEs
and their `result.csv` files into the Results summary under
`.memon/index/results/`. That cache is never a source: do not open, create,
edit, delete or commit it, and never decide what to write from it. Read the
table through `memon experiment results table` or `summary`.

Canonical README H2 order:

1. `Motivation` — why the work matters and the core question.
2. `Design` — stable controls, protocol, metrics, and comparison principles.
3. `Implementation` — managed projection of engineering work.
4. `Investigation` — managed projection of research work.
5. `Results` — managed projection of the generated Variant table.
6. `Findings` — evidence-backed interpretation, citing `INV...`/`V...` IDs.
7. `Limitations` — known validity boundaries and missing evidence.
8. `Conclusion` — concise final answer; may be empty while open.
9. `Warnings` — anomalies or risks that require human attention.

The three managed sections must contain exactly these single lines (ignoring
the normal trailing newline, but no extra body text). The FS v8 Results pointer
naming `results.yaml` is a `MANAGED_SECTION_NOT_STUB` lint error; only the
reviewed v8-to-v9 migration rewrites it.

```markdown
## Implementation

> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.

## Investigation

> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.

## Results

> Columns and Variants are managed in [experiment.json](./experiment.json); the Results table is generated from each member Run's result.csv.
```

A full README read returns these pointers. A section render/fetch returns the
managed source rendered as human-readable Markdown only when the stored pointer
is valid; for Results that is the generated summary, or its error. If the
pointer conflicts with real README content, render the real content with a
diagnostic; never hide it behind the projection.

Unknown or duplicated H2 sections are unsupported by the canonical order but
remain visible and byte-preserved. Strict validation must never become lossy
reading.

## `implementation.yaml` schema v1

```yaml
schema_version: 1
items:
  - id: IMP0001
    title: Add configurable precision
    status: IN_PROGRESS
    description: Optional Markdown text.
    depends_on: []
    acceptance_criteria:
      - BF16 reaches 100 steps without NaN
    files:
      - src/training/precision.py
    commits:
      - repo: .
        sha: <full-sha>
        url: <optional immutable permalink>
    code_reviews:
      - code-review/2026-08-10-precision.md
    outcome: Optional Markdown text.
    children: []
```

Required node fields: `id`, `title`, `status`. Optional: `description`,
`depends_on`, `acceptance_criteria`, `files`, `commits`, `code_reviews`,
`outcome`, recursive `children`. Statuses:
`TODO | IN_PROGRESS | BLOCKED | DONE | DROPPED`.

`TODO` records meaningful engineering work before it starts; `IN_PROGRESS` once
implementation actually began. A successful Run does not by itself make an item
`DONE` — check its acceptance criteria and engineering outcome. Do not create an
item merely because a launcher or analysis script exists; link a script to an
existing item, or leave it as Variant/Run provenance.

## `investigation.yaml` schema v1

```yaml
schema_version: 1
items:
  - id: INV0001
    title: Determine whether BF16 changes convergence
    status: IN_PROGRESS
    description: Optional Markdown text.
    depends_on: [IMP0001]
    question: Does BF16 materially degrade final loss?
    rationale: BF16 may improve throughput.
    success_criteria:
      - Difference from FP32 is below the agreed tolerance
    variant_ids: [V0001, V0002]
    outcome: Optional local answer.
    children: []
```

Required node fields: `id`, `title`, `status`. Optional: `description`,
`depends_on`, `question`, `rationale`, `success_criteria`, `variant_ids`,
`outcome`, recursive `children`. Statuses:
`PLANNED | IN_PROGRESS | BLOCKED | ANSWERED | INCONCLUSIVE | DROPPED`.

`PLANNED` before empirical work begins, `IN_PROGRESS` once evidence is being
collected or analyzed. Do not invent a question, criterion, or answer the record
and caller did not establish. `Investigation` and `Results` are independent
peers: nodes link Variants through `variant_ids` and never embed Variant
definitions, one Variant may serve several Investigations, and Run completion
never implies `ANSWERED`.

## `experiment.json` — the Results description

```json
{
  "experiment_schema_version": 1,
  "groups": {
    "params.optim": { "label": "Optimizer" }
  },
  "columns": [
    { "path": "params.precision", "label": "Precision", "type": "enum", "options": ["fp32", "bf16", "fp8"],
      "description": "Arithmetic format used during training. Supports **Markdown**.",
      "value_descriptions": { "bf16": "Uses **bfloat16** arithmetic." } },
    { "path": "params.optim.lr", "label": "LR", "type": "number" },
    { "path": "metrics.eval.final_loss", "label": "Final loss", "type": "number", "direction": "lower" },
    { "path": "metrics.eval.clip", "label": "CLIP", "type": "stats", "across": "sample",
      "direction": "higher", "display": "mean±std" },
    { "path": "metrics.serve.latency_ms", "label": "Latency", "type": "stats", "unit": "ms",
      "direction": "lower", "across": "request", "over": "gpu", "display": "max.p99" },
    { "path": "env.CUDA_VERSION", "label": "CUDA", "type": "string" }
  ],
  "variants": [
    { "id": "V0001", "name": "BF16 baseline", "status": "PLANNED",
      "description": "Optional Markdown text.",
      "values": { "params.precision": "bf16", "params.optim.lr": 0.0001, "env.PRECISION": "bf16" },
      "provenance": { "repo": ".", "commit": "<full-sha>", "entry": "scripts/train.sh",
                      "recipe": "recipes/bf16.yaml" },
      "runs": [] },
    { "id": "V0002", "name": "FP32 control", "values": { "params.precision": "fp32" }, "runs": [] }
  ]
}
```

`experiment.json` is the human-authored description of the Experiment's
results; agents edit it directly as JSON (two-space indentation, keys kept,
trailing newline) and validate with `experiment doc lint`. It never repeats a
README frontmatter key (`id`, `slug`, `title`, `status`, `archived`, `runs`,
`hypotheses`, `tags`, timestamps); a repeated key is `DESCRIPTION_DUPLICATES_README`.
Preserve unknown keys and their order.

**Paths.** Every value has a dotted path whose first segment is a partition:
`params` (parameters), `metrics` or `env` (environment values, hidden by
default). Further segments name groups, then the value: `params.optim.lr`,
`metrics.eval.fid`, `metrics.serve.latency_ms`, `env.CUDA_VERSION`. Segments
match `[A-Za-z_][A-Za-z0-9_-]*`; a path is never both a value and the group of
another path. Group related values under a shared prefix (`metrics.eval.*` for
evaluation metrics, `params.optim.*` for optimizer settings, `params.data.*`
for data settings) so the table can collapse and reorder them as one block.

**`groups`** optionally gives a group prefix a `label`, `description` or default
`hidden` flag. A group without an entry is still a group.

**`columns`** declares paths in their default display order: `path`, `label`
and `type` (`string`, `number`, `boolean`, `enum`, `list` or `stats`), plus
optional `unit`, `direction` (`higher` or `lower` is better), `options` (required
and non-empty for `enum`), `description` and partial `value_descriptions`
(Markdown annotations; they never restrict the domain), `decimals` (0–10),
`format` (`auto`, `fixed`, `scientific`, `percent`), `hidden`, and for `stats`
the dimension the statistics are taken `across`, an optional outer dimension
`over` (then every statistic is written `<inner>.<outer>`), the expected
`stats`, a default `display` and a default `sort_by` statistic. `display` is one
vocabulary statistic or one of the templates `mean±std`, `mean±sem`,
`mean (min–max)`, `mean [ci95]`, `p50 (p25–p75)`, `p50/p99`; a cell aggregated
across several Runs reads `mean ± std (n)` by default. Results are written
first and described later: a Run may record an undeclared path, which the table
shows with an inferred type after the declared columns of its group. Declare a
column to give it a label, type, unit, direction, options or display; lint
reports only conflicts. Edit annotations directly, or use
`memon experiment results annotation set` for one isolated upsert.

**`variants`** are declared before any Run is launched for them; a Variant may
list no Run. Fields: `id` (`V<NNNN>`, unique, never recycled), `name`, optional
`description`, optional declared `status`, `values`, `provenance`, `runs`, and
the read-only `frozen` block.

- Declared `status` is a plan or judgment state only: `PLANNED`, `BLOCKED`
  (cannot launch until a prerequisite named in `description` is met),
  `DROPPED` or `INCONCLUSIVE`. `RUNNING`, `COMPLETED` and `FAILED` derive from
  the Run records; declaring one is the lint error `DERIVED_STATUS_DECLARED`.
  Execution evidence overrides a declared `PLANNED`/`BLOCKED` and the summary
  warns `VARIANT_STATUS_STALE`; update or remove the declaration then.
- `values` holds planned parameter and env values keyed by `params.*`/`env.*`
  paths (a `metrics.*` key is `VARIANT_VALUE_PARTITION`). Env values are JSON
  strings. A Run that records a different value raises
  `VARIANT_PARAM_MISMATCH`; reconcile the plan instead of hiding the difference.
- `provenance` holds `repo`, `commit`, `entry`, `recipe` and extra keys. Omit an
  unknown field; do not write `null` for string fields.
- `runs` lists the Variant's Runs by project-relative path, every one also in
  the README `runs`. Launched, failed, interrupted, running and deprecated Runs
  all stay listed: evidence is derived (a listed Run that is `FINISHED` and not
  deprecated); every other listed Run is shown among the Variant's other Runs.
  There is no `attempts` list. A same-condition retry is another Run in the same
  Variant; a changed comparison condition needs a new or explicitly revised
  Variant before launch. Prove a same-condition retry from the recorded launch
  command, entry point, recipe, environment and comparison parameters; a shared
  Variant ID is not proof.
- `frozen` holds values recorded before FS v9 that no Run directory can carry,
  with their historical status, Runs and source. Only the migration and schema
  upgrades write it; never add to it by hand.

The effective status is derived in this order: declared `DROPPED` or
`INCONCLUSIVE`; else any listed `PENDING`, `RUNNING` or `INTERRUPTED` Run →
`RUNNING`; else any evidence Run → `COMPLETED`; else any `FAILED` Run →
`FAILED`; else listed Runs that are all `UNKNOWN` or deprecated →
`INCONCLUSIVE`; a Variant without listed Runs takes its frozen status, else
`BLOCKED` when declared, else `PLANNED`. An `INTERRUPTED` Run never makes a
Variant `FAILED`.

Deprecation is independent of list placement: a finished Run whose results
must not count is deprecated with the user's decision (`run deprecate`), not
removed from `runs`. Its values stop contributing, while execution work may
still inspect its scripts, configuration and recovery history. Verified
replacement Runs of the same Variant become evidence on their own.

W&B URLs and memon Run-document URLs are derived from Run metadata and IDs;
do not duplicate them in `experiment.json` or `result.csv`.

## `result.csv` — one Run's measurements

```csv
path,stat,value
$experiment_schema_version,,1
params.precision,,bf16
params.optim.lr,,0.0001
params.data.splits,,"[""train"",""val""]"
env.CUDA_VERSION,,12.4
metrics.eval.final_loss,,0.231
metrics.eval.clip,mean,0.312
metrics.eval.clip,std,0.021
metrics.eval.clip,n,500
metrics.serve.latency_ms,max.p99,140.2
```

A Run directory may hold one tracked `result.csv` describing the whole Run.
The header is `path,stat,value`; the reserved `$experiment_schema_version` row
comes next and carries the declaring Experiment's `experiment_schema_version`;
cells follow RFC 4180 quoting (`list` values are one-line JSON arrays). Every
`(path, stat)` pair occurs once (`RESULT_DUPLICATE_ROW` fails the whole
summary). Only `stats` values span several rows, one per statistic from the
fixed vocabulary `mean`, `std`, `var`, `sem`, `min`, `max`, `sum`, `n`, `p1`,
`p5`, `p10`, `p25`, `p50`, `p75`, `p90`, `p95`, `p99`, `p999`, `ci95_lo`,
`ci95_hi`; with an outer dimension a statistic is `<inner>.<outer>` (`max.p99`).
Every other row has an empty `stat` cell; an empty `value` is an explicitly
missing value. Paths starting with `$` are reserved for memon.

Record statistics as `stats` rows — a metric measured over 500 samples with
mean 0.31 and standard deviation 0.02 is three rows (`mean`, `std`, `n`), never
the string `0.31 ± 0.02` or JSON text. Seeds of one Variant are separate Runs;
the summary aggregates their values across Runs automatically.

Record values with the atomic writer:

```sh
memon --project-root . --format json run result set "$RUN_PATH"   metrics.eval.final_loss=0.231 metrics.eval.clip:mean=0.312 metrics.eval.clip:std=0.021 metrics.eval.clip:n=500
memon --project-root . --format json run result set "$RUN_PATH" --from metrics.csv   # path,stat,value rows
memon --project-root . --format json run result set "$RUN_PATH" --unset metrics.eval.debug
memon --project-root . --format json run result lint "$RUN_PATH"
```

It validates every value against the declared column type before writing
(`BAD_REQUEST`, exit 2, writes nothing), creates the file with the version row,
replaces only the targeted rows and refuses an orphan Run (`BAD_STATE`: link it
first), a stale file version (`RESULT_SCHEMA_MISMATCH`) or a stale
`--expected-hash` (`CONFLICT`, exit 9). A direct edit is allowed when it keeps
the version row, unique pairs and declared types; lint afterwards. Never write
step-indexed histories, checkpoints, W&B identities or other source facts into
`result.csv`; they belong to the Run record. memon never deletes a result file.

When `run result set` creates a file that the project's ignore rules exclude,
it still writes it and reports `RESULT_FILE_IGNORED` with the deciding rule
(`<ignore file>:<line>:<pattern>`) and a copyable command that appends the
allow rules. `run result lint` and `experiment doc lint` report the same
warning for an existing ignored file. Show the user the rule and the command;
change an ignore file only after the user agrees, and leave the commit to them.

## Result schema versions and upgrades

`experiment_schema_version` versions this Experiment's recorded values (it is
not the FS convention). `experiment.json`, every member `result.csv` and the
summary record the same number. Adding a column, an annotation, a label, a unit
or a display choice for values not yet recorded keeps the version. Renaming,
moving, re-typing, re-scaling or deleting values already recorded raises it by
exactly one and ships one transform in `schema-upgrades/`:

```json
{ "from": 1, "to": 2, "operations": [
  { "op": "rename", "from": "metrics.fid", "to": "metrics.eval.fid" },
  { "op": "move", "from": "params.lr_group", "to": "params.optim" },
  { "op": "scale", "path": "metrics.serve.latency", "factor": 1000, "offset": 0, "unit": "ms" },
  { "op": "delete", "path": "metrics.debug" },
  { "op": "default", "path": "params.precision", "value": "bf16" } ] }
```

Save it as `schema-upgrades/1-to-2.json` (preferred), or for a complex case as
one Python script `schema-upgrades/1-to-2.py` run as
`python3 <script> <input.csv> <output.csv>` that reads one result table and
writes the transformed table, touching no other file. Leave
`experiment.json` at the old version: the upgrade raises
`experiment_schema_version` in `experiment.json` and in every member
`result.csv`, and a declarative transform also rewrites the description's
column paths, groups, units, planned and frozen values. After a Python
transform, edit the column definitions by hand. Then:

```sh
memon --project-root . --format json experiment schema upgrade <id> --to 2          # dry run: per-file row diff
memon --project-root . --format json experiment schema upgrade <id> --to 2 --apply  # only after the user approves the diff
```

`--apply` refuses while a member Run is `RUNNING`, backs up every changed file
under `.memon/backups/schema-upgrade/`, rewrites each file atomically, verifies
and restores everything on failure. Review and commit the rewritten files like
any other edit.

When a Results read fails with `RESULT_SCHEMA_MISMATCH`, report the listed
files with their recorded versions and the printed upgrade command to the user;
never edit result files one by one to make the error disappear.

## Warnings table

`Warnings` remains a parser-compatible GFM table; the dedicated warning skill
is removed and its CLI deprecated:

```markdown
## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
|--------|---------|-----|----------|---------|----------|------|
| OPEN | 2026-08-10T12:00:00+00:00 | run-260810-120000 | result | Loss became NaN at step 400. | — | — | <!-- id:w_2026-08-10T12-00-00+00-00_a1b2 -->
```

- Status is `OPEN | RESOLVED`.
- Category is `methodology | result | config | data | repro | compare | infra |
  other`.
- Use `—` for absent Run, Resolved, or Note values.
- Every row keeps a stable unique trailing `<!-- id:w_... -->` comment.
- Escape Markdown table delimiters inside cells.
- Preserve existing row order, IDs, human resolution state, and notes. Do not
  replace this table with free-form prose.
- An empty `Warnings` body is valid. Create the canonical table when the first
  warning is added, then preserve it for subsequent updates.

## Hierarchy, dependency, and IDs

`children` expresses containment and presentation hierarchy. `depends_on`
expresses blocking/order across nodes and may cross Implementation and
Investigation. Neither replaces the other.

IDs are stable and unique across the Experiment bundle within their namespace.
Do not recycle an ID after deleting or dropping an item. YAML sequence order is
display order; there is no separate `order` field.

## Routing reference

| Information | Destination |
|---|---|
| Why investigate; user context; hypothesis motivation | `Motivation` |
| Stable evaluation protocol and controlled conditions | `Design` |
| Feature/fix/refactor, acceptance criteria, commits, code review | `implementation.yaml` |
| Research question, next/completed study, criteria, local outcome | `investigation.yaml` |
| Columns, groups, Variant declarations, planned values, Variant `runs`, entry/recipe/commit | `experiment.json` |
| A Run's measured parameters, metrics and env values | that Run's `result.csv` via `memon run result set` |
| Recorded values renamed, moved, re-typed, re-scaled or deleted | `schema-upgrades/` + `memon experiment schema upgrade` |
| What Results mean; supported trends and uncertainty | `Findings` |
| Generalization boundary, confound, missing coverage | `Limitations` |
| Final answer or decision after user-approved resolution | `Conclusion` |
| Actionable anomaly requiring attention | `Warnings` |
| Successor/predecessor relationship after an approved decision | `Findings` or `Conclusion` prose naming the other Experiment ID |
| Cross-project observation, request, or decision | the project wiki through `memon-wiki` |

`Results` shows what happened, `Findings` explains what it means, and
`Conclusion` records the final decision — never duplicate the Results matrix in
either. Nothing in the bundle derives from the Journal; the writer's only
contact with it is the one `journal submit` that closes a batch of direct edits
(`../../PREFLIGHT.md`).

## Versioning and rendering

`implementation.yaml` and `investigation.yaml` carry `schema_version`, governed
by the project FS convention in `.memon/version.json`; a change to them ships
with an FS migration guide and a deterministic conversion. The Results files are
versioned per Experiment by `experiment_schema_version` and upgraded with
`memon experiment schema upgrade`. Never upgrade on read.

Canonical CLI surfaces:

```sh
memon --project-root . --format json experiment doc show <id> <implementation|investigation|results>
memon --project-root . --format human experiment doc render <id> <section>
memon --project-root . --format json experiment doc lint <id>
memon --project-root . experiment results table <id> --output json
memon --project-root . experiment results summary <id> --output json
memon --project-root . --format json run result get|set|lint <run> ...
memon --project-root . --format json experiment schema upgrade <id> --to <N> [--apply]
```

`doc lint` includes schema validation of the YAML files and `experiment.json`
and checks every member `result.csv` (version agreement, duplicate pairs,
declared types, cross-file conflicts, `RESULT_FILE_IGNORED`);
`experiment doc validate` and `memon doctor` no longer exist. Run structure is
checked separately with `memon run lint <run>`.

The CLI, section fetch, and frontend share the same Markdown renderer. Rich
components consume the normalized model and the generated summary, never the
rendered Markdown.
