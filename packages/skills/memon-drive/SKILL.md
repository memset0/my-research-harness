---
name: memon-drive
description: Coordinate one memon Experiment from design through implementation, investigations, Variants, Runs, findings, review, and user-approved resolution. Use when a user wants to start, resume, or iteratively steer an Experiment and multiple specialized skills must share one coherent Experiment document bundle.
---

# memon-drive

Act as the session-level coordinator for one Experiment. Own the conversation,
research decisions, and handoffs; delegate every Experiment bundle write to
`memon-write-experiment-doc`, launcher work to `memon-write-script`, Run
lifecycle work to `memon-run-experiment`, and review docs to
`memon-write-code-review`.

Do not treat conversation memory as durable state. Important decisions must land
in the Experiment bundle through the writer skill.

## Preflight

Run `memon --project-root . --format json fs-version check` first. Continue only
for `match`; otherwise stop according to `../PREFLIGHT.md`.

## Start or resume

### New Experiment

1. Discuss the motivation, core question, stable design, and what evidence would
   answer it.
2. Create the Experiment with the canonical CLI.
3. Invoke `memon-write-experiment-doc` to initialize and populate the bundle.
4. Separate engineering work into `Implementation` and research work into
   `Investigation`; do not recreate a generic `Plan`.

### Existing Experiment

Read fresh state before suggesting work:

```sh
memon --project-root . --format json experiment show "$EXP_ID"
memon --project-root . --format human experiment doc render "$EXP_ID" implementation
memon --project-root . --format human experiment doc render "$EXP_ID" investigation
memon --project-root . --format human experiment doc render "$EXP_ID" results
memon --project-root . --format json experiment doc lint "$EXP_ID"
```

Also read `Motivation`, `Design`, `Findings`, `Limitations`, `Conclusion`,
`Warnings`, relevant Run READMEs, and project instructions (`AGENTS.md`,
`CLAUDE.md`, or equivalent). Unsupported README sections remain visible context;
never discard them because lint rejects their names.

If a managed section conflicts with its canonical one-line pointer, preserve and
surface the real content. Do not write through the conflict outside migration.

## Coordinate the work

### 1. Make the next intent concrete

Classify it before acting:

- Engineering capability, fix, or refactor → Implementation item.
- Research question, validation, or ablation → Investigation item.
- Concrete comparison condition to execute → Variant in Results.
- Fast one-off analysis of existing artifacts → Experiment-local utility; no
  automatic Implementation item or Run.

An item may have nested `children`; use `depends_on` separately for blockers.
When a task says “implement and verify,” split it into linked Implementation
and Investigation items.

Invoke `memon-write-experiment-doc` for every semantic bundle change. Do not
edit README/YAML ad hoc inside this coordinator.

### 2. Design Variants before launch

A Variant is a comparison condition, not an execution attempt. One Variant may
bind zero, one, or many Runs. It must exist in `results.yaml` before launching
the first Run.

For a proposed batch, show a Markdown table with the declared dynamic columns:

```markdown
| Variant | Precision | Batch size | Seed | Entry | Recipe |
|---|---:|---:|---:|---|---|
| V0004 BF16 baseline | bf16 | 8 | 1 | `scripts/train.sh` | `recipes/bf16.yaml` |
| V0005 FP32 control | fp32 | 8 | 1 | `scripts/train.sh` | `recipes/fp32.yaml` |
```

Decide from the user's tone whether to wait for confirmation:

- Collaborative/design language → present the table and wait for correction or
  approval before writing/launching.
- Explicit autonomy (“decide and run it yourself”) → define the Variants and
  continue without a separate approval turn.

In both modes, write Variants first. Changing a comparison parameter requires a
new or explicitly revised Variant before launch. An identical retry stays on the
same Variant and does not need a new design confirmation.

`columns` defines display and validation. Enum columns declare all allowed
`options`, although not every option needs a row.

### 3. Implement only what is necessary

If new code is required:

1. Create or select a meaningful Implementation item through the writer.
2. Implement and verify the code.
3. Use `memon-write-script` for a launcher. A launcher alone does not justify a
   new Implementation item.
4. Update the existing item with acceptance evidence, files, commits, outcome,
   and optional code-review reference through the writer.

Offer one Experiment-scoped `memon-write-code-review` per reviewable unit, not
per commit. If accepted, link the resulting review doc to the appropriate
Implementation item through the writer.

### 4. Run each Variant

Invoke `memon-run-experiment` with the Experiment ID and Variant ID. That skill
owns each Run README and updates Results through the writer.

- New execution enters the Variant's `runs` list by default.
- Failed, interrupted, invalid, or superseded execution moves to `attempts`.
- Same-condition recovery creates a fresh Run under the same Variant.
- A parameter change requires a different/revised Variant first.

Never allow a Run to exist in both lists.

### 5. Interpret evidence separately

After Runs reach useful states:

1. Render Results and show the updated comparison table, including selected
   Runs, Attempts, derived W&B links, and memon Run-document links.
2. Evaluate the associated Investigation's explicit `success_criteria`.
3. Update factual cross-Variant interpretation in `Findings`, citing `INV...`
   and `V...` IDs.
4. Update `Limitations` for confounds or scope restrictions.
5. Update Investigation status/outcome only when the evidence warrants it.

There is no minimum-Run-count heuristic. One decisive Run may be enough; many
Runs may still be inconclusive. A terminal Run never automatically marks an
Investigation `ANSWERED`.

### 6. Replan continuously

When evidence changes the direction, update the structured trees rather than a
free-form Plan:

- add or reorder nested items;
- mark abandoned work `DROPPED` with an outcome/reason;
- add dependencies instead of simulating order with prose;
- reuse baseline Variants across Investigation links where appropriate;
- preserve completed and failed history.

Ask a focused question when a change materially alters research intent. Routine
status and evidence updates do not require extra confirmation.

## Resolve the Experiment

Consider resolution when:

- relevant Implementation work is `DONE` or deliberately `DROPPED`;
- relevant Investigations are `ANSWERED`, `INCONCLUSIVE`, or `DROPPED`;
- Variants and Runs needed for the answer are terminal;
- Findings and Limitations reflect the evidence;
- a concise final Conclusion is ready.

Show the proposed Conclusion and ask the user explicitly whether to resolve the
Experiment. Only after approval may the writer update Conclusion and the
coordinator invoke the status transition to `RESOLVED`.

## Routing summary

| Content | Destination |
|---|---|
| Why and core question | `Motivation` |
| Stable protocol and controls | `Design` |
| Code work and evidence | `implementation.yaml` |
| Research work and criteria | `investigation.yaml` |
| Variant facts, parameters, Runs, metrics | `results.yaml` |
| Interpretation of evidence | `Findings` |
| Validity boundaries | `Limitations` |
| Final user-approved answer | `Conclusion` |
| Actionable anomaly | `Warnings` through the writer |
| Cross-project note/request | `memon-append-journal` |

## Guardrails

- Never write a legacy `Method`, `Plan`, or `Caveats` section into a current
  Experiment.
- Never copy the rendered managed sections back into README.
- Never hide unknown/legacy content merely because it is unsupported.
- Never launch before the Variant exists.
- Never auto-resolve an Experiment or infer a conclusion from a hard-coded Run
  count.
- Never call the deprecated warning CLI.
