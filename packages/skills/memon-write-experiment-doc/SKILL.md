---
name: memon-write-experiment-doc
description: "Maintain a memon Experiment document bundle: the canonical README sections plus implementation.yaml, investigation.yaml, and results.yaml. Use whenever an agent or another memon skill needs to create or change Experiment-level motivation, design, implementation work, investigations, variants/results, findings, limitations, conclusions, or warnings while preserving unsupported content."
---

# memon-write-experiment-doc

Maintain one complete Experiment document bundle. This is the shared writer
workflow for all official memon skills; callers provide semantic intent, and
this skill routes it to the correct README section or YAML file.

Before editing, read [references/experiment-bundle.md](references/experiment-bundle.md)
in full. It is the canonical schema and routing reference. Do not recreate a
second schema in a caller skill.

## Preflight

Run this first:

```sh
memon --project-root . --format json fs-version check
```

Proceed only when `status == "match"`. For every other status, stop and follow
`../PREFLIGHT.md`. Migration staging is the sole exception; in that case the
`memon-migrate-fs` skill owns the destination and version rules.

## Memon CLI issue handoff

For every `memon` command used by this skill, follow the CLI issue handoff in
`../PREFLIGHT.md`. After safely finishing the requested task, report any CLI
crash, valid-input rejection, malformed/inconsistent output, or required CLI
workaround; if it blocks completion, report it in the blocked handoff. Do not
mislabel an expected validation or domain-state rejection as a CLI bug.

## Responsibilities

- Create or update canonical README prose: `Motivation`, `Design`, `Findings`,
  `Limitations`, `Conclusion`, and `Warnings`.
- Keep the three managed sections as their exact one-line pointers.
- Directly edit `implementation.yaml`, `investigation.yaml`, and
  `results.yaml` by default. The focused Results annotation CLI is an optional
  convenience for one column/value description, never a required write gate.
- Preserve unknown headings, duplicate headings, comments, field order, and
  unknown YAML fields unless the user explicitly asks to change them.
- Validate and lint the whole bundle after every write.
- Return a concise handoff naming changed files and stable IDs.

This skill does not decide research direction, launch jobs, write Run READMEs,
or mark an Experiment resolved without the user's confirmation. Those decisions
belong to the caller, normally `memon-drive`.

## Workflow

### 1. Resolve and read fresh state

Resolve the Experiment ID and directory. Read `README.md` and all three YAML
files completely from disk immediately before planning the edit. Also inspect:

```sh
memon --project-root . --format json experiment doc validate "$EXP_ID"
memon --project-root . --format json experiment doc lint "$EXP_ID"
```

Do not rely on a caller's stale copy. Record a content hash for every file that
may be touched so a concurrent writer cannot be overwritten silently.

### 2. Refuse destructive normalization

Lint is strict; reading is tolerant.

- Unknown H2 sections are lint errors but remain user-owned content. Preserve
  and render them; never delete, rename, or hide them as incidental cleanup.
- If a managed section does not contain its exact pointer, treat it as a
  managed-section conflict. Preserve its real body, surface the lint error, and
  do not replace it automatically.
- If a managed section is duplicated, preserve every occurrence and stop the
  affected write.
- If a YAML file is missing, invalid, or newer than the supported schema, do
  not invent a lossy repair. Report the diagnostic or hand off to migration.

Only `memon-migrate-fs`, working on an isolated candidate and with user
approval, may relocate unsupported or conflicting legacy content.

### 3. Route the semantic change

Use the routing table in the reference. In particular:

- Engineering work and its code evidence go to `implementation.yaml`.
- Research questions, progress, criteria, and local outcomes go to
  `investigation.yaml`.
- Variant definitions, selected Runs, discarded attempts, parameters, metrics,
  and launch provenance go to `results.yaml`.
- Supplemental Markdown explanations for a Results column or selected values
  go to the optional `column_annotations` block in `results.yaml`. Keep them
  sparse; they document meaning and never redefine enum validation.
- For a Run lifecycle update, the caller supplies the Experiment ID, Variant
  ID, Run ID, event (`launched`, `succeeded`, `failed`, `interrupted`, or
  `superseded`), whether launch conditions are unchanged, and any verified
  metrics or provenance. Reread the Run README before moving an ID between
  `runs` and `attempts`; never infer retry equivalence from the Variant ID.
- Factual cross-Variant interpretation goes to `Findings` and cites stable
  `INV...` or `V...` IDs.
- The final answer goes to `Conclusion`; do not use it as a run log or matrix.
- Known evidence boundaries go to `Limitations`; actionable anomalies go to
  `Warnings`. Keep the canonical Warnings GFM table, stable row IDs, categories,
  human resolution state, and notes; never replace it with free-form prose.

Keep hierarchy (`children`) distinct from ordering/blocking (`depends_on`).
Dependencies never replace tree structure.

### 4. Edit the source files directly or use the focused annotation helper

Make the smallest coherent edit. Agents are expected to edit YAML directly;
the CLI is not a write gate. For an isolated column/value explanation, an
agent MAY use either of these idempotent upserts instead of rewriting YAML by
hand:

```sh
memon --project-root . experiment results annotation set "$EXP_ID" <column> \
  --description '<Markdown>'
memon --project-root . experiment results annotation set "$EXP_ID" <column> \
  --value <value> --description '<Markdown>'
```

An existing description at the same target is replaced. The helper does not
require every option to be described and does not require a described value to
already occur in `options`. Direct `results.yaml` editing remains fully
supported and is preferable when one coherent change also updates columns,
Variants, comments, or human ordering.

Before writing, compare the current hashes with the snapshots from step 1. On
a mismatch, reread and reapply once. If the same file changes again, stop and
surface the conflict rather than looping.

Preserve:

- YAML comments and human ordering where the editor permits it;
- list order, which is presentation order;
- unknown keys for forward compatibility;
- all README bytes outside the intended canonical section;
- the exact managed pointers.

Never copy Markdown produced by `doc render` back into README. It is a read-only
projection of YAML.

### 5. Validate, lint, and inspect the render

Run all of the following after writing:

```sh
memon --project-root . --format json experiment doc validate "$EXP_ID"
memon --project-root . --format json experiment doc lint "$EXP_ID"
memon --project-root . --format human experiment doc render "$EXP_ID" implementation
memon --project-root . --format human experiment doc render "$EXP_ID" investigation
memon --project-root . --format human experiment doc render "$EXP_ID" results
```

`validate` must pass. Do not claim completion while a newly introduced lint
error remains. Pre-existing unsupported-section diagnostics may remain only
when their content was preserved and the caller explicitly reports them.

Inspect rendered Markdown for broken hierarchy, missing values, invalid links,
or a misleading Results table.

### 6. Return a structured handoff

Report:

```json
{
  "experiment": "E0007-example",
  "changed_files": ["docs/experiments/E0007-example/results.yaml"],
  "changed_ids": ["V0003"],
  "summary": "Added the planned BF16 variant before launch",
  "diagnostics": []
}
```

Use actual values; this object is an interaction contract, not a required CLI
serialization.

## Guardrails

- Do not create a Variant after its Run has already launched. Define it first.
- Do not move a failed or superseded Run into `attempts` without preserving its
  Run README and identity.
- Do not infer that a completed Run makes an Investigation `ANSWERED`; evaluate
  its `success_criteria` separately.
- Do not mark `Conclusion` final or change the Experiment to `RESOLVED` without
  explicit user confirmation.
- Do not use the deprecated warning CLI. Maintain `Warnings` through this
  bundle writer.
- Do not silently upgrade `schema_version`; schema upgrades belong to the FS
  migration guide and its deterministic conversion script.
