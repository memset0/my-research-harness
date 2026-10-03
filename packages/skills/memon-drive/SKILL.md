---
name: memon-drive
description: Coordinate one memon Experiment across design, engineering, investigations, Variants and execution. Batch durable updates, interpret evidence separately from Run status, and require user approval for resolution.
---

# memon-drive

Own the conversation and coordination. Follow `../PREFLIGHT.md`; apply the
writer, launcher, execution and review skills as workflows, inline when useful.
Do not spawn a subagent merely to edit a document. Durable decisions belong in
the Experiment bundle, not conversation memory.

## Establish the question

For a new Experiment, agree on motivation, question, stable design and the
evidence needed, then create its bundle through `experiment create` and the
writer workflow. For an existing one, start with:

```sh
memon --project-root . --format human experiment show "$EXP_ID"
```

Read only the relevant managed document or projection next; use filtered
Results (`memon experiment results table <id>` with `--variant`/`--column`)
rather than rendering every document twice. The Results table is generated;
never open `.memon/index/results/`. Follow related Experiment,
hypothesis or wiki references when needed for the decision, not as a startup
sweep. Do not routinely open Run records; descend only for a specific execution
question. Never use Journal history as research context.

Reuse documented baselines and rejected/inconclusive work. Before repeating a
condition, state what changed or which different claim it tests. Missing
information is a gap, not proof that work was never done. Wiki writes belong to
`memon-wiki`; if that surface is unavailable, name the blocked knowledge task
rather than inventing a roadmap file or misplacing it in another Experiment.

## Coordinate the smallest useful unit

| Intent | Destination |
|---|---|
| Engineering capability, fix or refactor | `implementation.yaml` |
| Empirical question and success criteria | `investigation.yaml` |
| Comparison condition, planned parameters, provenance, columns | Variant and columns in `experiment.json` |
| Measured parameters, metrics and env values of one Run | that Run's `result.csv` via `memon run result set` |
| Change to already recorded values (rename, re-scale, …) | `memon experiment schema upgrade` with a reviewed transform |
| One-off analysis of existing artifacts | Experiment-local utility; no automatic item or Run |
| Cross-Variant interpretation or evidence limits | README Findings / Limitations |

`children` expresses hierarchy; `depends_on` expresses blocking. A launcher,
commit or routine verification does not automatically need a new research item
or code-review document.

1. **Predeclare Variants.** Agree on the comparison axes, result paths and
   reusable baselines, or proceed under explicit user-granted autonomy. Write
   Variants (and the columns you expect) into `experiment.json` before launch.
   A retry is another Run, not another condition; a changed condition needs a
   new/revised Variant before execution.
2. **Implement and execute.** Use the launcher/execution workflows. Every Run
   stays in its Variant's `runs`; each Run's measurements go into its
   `result.csv` through `memon run result set`, with statistics as `stats`
   rows. A launch contradicting its Variant requires immediate reconciliation;
   never retrofit declarations to disguise the mismatch.
3. **Batch writeback.** Apply the writer workflow at meaningful batch launch,
   outcome or interpretation boundaries. Combine Variant `runs`, declared plan
   states and provenance. Do not require a writer invocation per Run, poll or
   lifecycle event. `RUNNING`, `COMPLETED` and `FAILED` are derived from the Run
   records and never written; deprecation keeps a Run listed and only removes
   its values from the evidence.
4. **Interpret separately.** Compare Variant results from the generated table
   against the Investigation's criteria. Cite `INV...`/`V...` in Findings and
   state confounds in Limitations. Neither terminal status nor Run count
   implies `ANSWERED`. Report frozen, mixed and plan-differing cells as such;
   preserve original measurements and request new evidence rather than
   inventing replacements. On `RESULT_SCHEMA_MISMATCH`, report the listed files
   and the upgrade command to the user before anything else.
5. **Replan or resolve.** Preserve completed/failed history, record why work is
   dropped, and ask when research intent materially changes. Present the
   evidenced Conclusion and obtain explicit approval before resolution. Routine
   factual progress updates need no new approval.

## Redo existing Variants

A user-requested redo keeps the Variant definitions and old Run associations.
Within the agreed scope, mark old executions deprecated, not deleted or moved
away merely to exclude their results. Let the executor inspect their still-useful
scripts/configuration and diagnose the reason for rejection, then launch fresh
Runs for the same conditions. Predeclare genuinely changed conditions instead
of disguising them as a retry.

Batch the new Run references and actual provenance back to the Variant while
preserving old Runs in its `runs`; the new Runs' values are recorded in their
own `result.csv`. Deprecated Runs contribute no value, so the table already
shows only the new evidence; never delete history or restore rejected Runs to
change it.

## Propagate an approved decision

Trace affected claims through existing references. Use the writer for
Experiments and `memon-wiki` for wiki pages; seek approval before broadening the
artifact set. Narrow only the affected claims and dependents, preserving other
claims, measurements, Run identities and provenance. Supersession is explicit
prose naming the other Experiment, not a `DEPRECATED` Experiment status or a
new successor ledger.

Approval for factual writeback does not authorize lifecycle/archive changes,
warning resolution or human verification. Report each affected artifact as
updated, inspected-and-unchanged, or blocked, with files/IDs and relevant
submission receipts. Do not claim propagation while an affected artifact is
still inconsistent.

Use lint for structural concerns and after source edits, not to decide research
completion. Preserve unsupported sections and managed pointers; never copy
rendered projections back into README. When a command reports
`RESULT_FILE_IGNORED`, show the user the deciding rule and the fix command and
change an ignore file only after the user agrees. The writer reference owns
detailed schema/status rules; do not duplicate them here.
