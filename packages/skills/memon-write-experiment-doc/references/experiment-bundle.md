# Experiment bundle contract

This file is the canonical skill-side reference for the current Experiment
document bundle. Callers should invoke `memon-write-experiment-doc` instead of
copying this contract into their own skill.

## Contents

- [Layout and README order](#layout-and-readme-order)
- [`implementation.yaml` schema v1](#implementationyaml-schema-v1)
- [`investigation.yaml` schema v1](#investigationyaml-schema-v1)
- [`results.yaml` schema v1](#resultsyaml-schema-v1)
- [Warnings table](#warnings-table)
- [Hierarchy, dependency, and IDs](#hierarchy-dependency-and-ids)
- [Routing reference](#routing-reference)
- [Versioning and rendering](#versioning-and-rendering)

## Run reference authority

Store each member in README frontmatter `runs` as a POSIX directory path
relative to the project root, for example `logs/trial-260908-120000`.
Use exactly the same paths in `results.yaml` Variant `runs` and `attempts`.
Do not use bare IDs, absolute paths, traversal, or paths escaping through
symlinks. An existing path may belong to at most one Experiment. An unassigned
Run is valid. Resolve members directly; do not scan unrelated Run directories
or output trees. Never write or infer ownership from a Run README's retired
`experiment` field. Rename an Experiment without rewriting member Run READMEs;
rename a Run by updating its declared path and dependent result references.

## Layout and README order

```text
docs/experiments/E<NNNN>-<slug>/
├── README.md
├── implementation.yaml
├── investigation.yaml
├── results.yaml
└── code-review/        # optional; create only when a review exists
```

Canonical README H2 order:

1. `Motivation` — why the work matters and the core question.
2. `Design` — stable controls, protocol, metrics, and comparison principles.
3. `Implementation` — managed projection of engineering work.
4. `Investigation` — managed projection of research work.
5. `Results` — managed projection of Variants and Runs.
6. `Findings` — evidence-backed interpretation, citing `INV...`/`V...` IDs.
7. `Limitations` — known validity boundaries and missing evidence.
8. `Conclusion` — concise final answer; may be empty while open.
9. `Warnings` — anomalies or risks that require human attention.

The three managed sections must contain exactly these single lines (ignoring
the normal trailing newline, but no extra body text):

```markdown
## Implementation

> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.

## Investigation

> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.

## Results

> Managed in [results.yaml](./results.yaml); read and update that file directly.
```

A full README read returns these pointers. A section render/fetch returns YAML
rendered as human-readable Markdown only when the stored pointer is valid. If
the pointer conflicts with real README content, render the real content with a
diagnostic; never hide it behind the YAML projection.

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

## `results.yaml` schema v1

```yaml
schema_version: 1
column_annotations:
  precision:
    description: |
      Controls the arithmetic format used during training. Supports **Markdown**.
    value_descriptions:
      fp32: Standard single-precision baseline.
      bf16: Uses **bfloat16** arithmetic.
columns:
  - key: precision
    label: Precision
    group: parameter
    type: enum
    options: [fp32, bf16, fp8]
  - key: final_loss
    label: Final loss
    group: metric
    type: number
variants:
  - id: V0001
    name: BF16 baseline
    status: PLANNED
    description: Optional Markdown text.
    parameters:
      precision: bf16
    metrics:
      final_loss: null
    runs: []
    attempts: []
    provenance:
      repo: .
      commit: <full-sha>
      entry: scripts/train.sh
      recipe: recipes/bf16.yaml
      env:
        PRECISION: bf16
  - id: V0002
    name: FP32 control
    status: PLANNED
    parameters:
      precision: fp32
    metrics:
      final_loss: null
    runs: []
    attempts: []
```

Column fields are `key`, `label`, `group`, `type`, and optionally `options`.

- `group`: `parameter | metric`
- `type`: `string | number | boolean | enum`
- `options` is required for `enum`; a value must belong to the declared
  options. Not every option needs to appear in a Variant.

`column_annotations` is optional supplemental documentation keyed by declared
column key; each entry may carry a Markdown `description`, a partial
`value_descriptions` map, or both, and the block, a column, or a value may be
omitted. `value_descriptions` is not an allowed-values declaration: it need not
cover `options` and may explain a value added later. Quote ambiguous YAML keys.
Agents edit the block directly, or use
`memon experiment results annotation set` for an isolated upsert.

Variant required fields: `id`, `name`, `status`, `parameters`, `metrics`,
`runs`, `attempts`. Optional: `description`, `provenance`. Statuses:
`PLANNED | RUNNING | COMPLETED | FAILED | INCONCLUSIVE | DROPPED`.

Run-list semantics:

- `runs`: associated executions, including newly launched Runs and retained
  deprecated history. Membership alone does not establish current evidence:
  use non-deprecated, appropriate executions when analyzing results.
- `attempts`: the existing category for executions not selected as evidence;
  these also retain their Variant association. Deprecation is not a reason to
  move an existing Run between lists. Keep historical metric dependencies.
- A Run may occur in exactly one of these lists for a Variant.
- A Variant may exist with zero Runs; it must exist before any Run starts.
- Same-condition retries remain on the same Variant. A changed comparison
  condition requires a new or explicitly revised Variant before launch. Prove a
  same-condition retry from the recorded launch command, entry point, recipe,
  environment, and comparison parameters; a shared Variant ID is not proof.
- Deprecation is independent of list placement: keep the existing association
  and mark the Run deprecated. Its results do not participate in current
  analysis, but execution work may inspect its scripts, configuration and
  recovery history. Do not infer that a deprecated Run is unreadable.
- Historical membership and current metric evidence are distinct concepts.
  Verified replacement results should become valid without deleting or
  restoring old deprecated Runs. Current projections still check all `runs`;
  they do not yet model that distinction. Do not invent a YAML field, silently
  upgrade the schema, or remove history to bypass the conservative result.
  Preserve old measurements and identify the actual source of new ones using
  supported provenance and the execution handoff.

Mark a Variant `COMPLETED` only when its intended evidence set is complete.
Use `RUNNING` for active execution and `PLANNED` for a retry not yet launched;
neither status determines whether the Investigation is answered.

W&B URLs and memon Run-document URLs are derived from Run metadata and IDs;
do not duplicate them in `results.yaml`.

Omit an unknown optional provenance field. Do not serialize YAML null for
string-only provenance fields such as `commit`.

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
| Variant parameters, metrics, Runs/attempts, entry/recipe/env/commit | `results.yaml` |
| What Results mean; supported trends and uncertainty | `Findings` |
| Generalization boundary, confound, missing coverage | `Limitations` |
| Final answer or decision after user-approved resolution | `Conclusion` |
| Actionable anomaly requiring attention | `Warnings` |
| Successor/predecessor relationship after an approved decision | `Findings` or `Conclusion` prose naming the other Experiment ID |
| Cross-project observation, request, or decision | the project wiki through `memon-wiki` |

`Results` records what happened, `Findings` explains what it means, and
`Conclusion` records the final decision — never duplicate the Results matrix in
either. Nothing in the bundle derives from the Journal; the writer's only
contact with it is the one `journal submit` that closes a batch of direct edits
(`../../PREFLIGHT.md`).

## Versioning and rendering

Each YAML file carries `schema_version`, but its version is governed by the
project FS convention in `.memon/version.json`. A schema change must ship with
an FS migration guide and deterministic YAML conversion script. Never upgrade
on read.

Canonical CLI surfaces:

```sh
memon --project-root . --format json experiment doc show <id> <implementation|investigation|results>
memon --project-root . --format human experiment doc render <id> <section>
memon --project-root . --format json experiment doc lint <id>
```

`doc lint` includes schema validation; `experiment doc validate` and
`memon doctor` no longer exist. Run structure is checked separately with
`memon run lint <run>`.

The CLI, section fetch, and first-version frontend share the same Markdown
renderer. Future rich components should consume the normalized tree/model, not
parse the rendered Markdown.
