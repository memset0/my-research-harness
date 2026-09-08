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

Read only the relevant managed YAML/projection next; use filtered Results
rather than rendering every document twice. Follow related Experiment,
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
| Comparison condition, parameters, provenance and selected outcomes | Variant in `results.yaml` |
| One-off analysis of existing artifacts | Experiment-local utility; no automatic item or Run |
| Cross-Variant interpretation or evidence limits | README Findings / Limitations |

`children` expresses hierarchy; `depends_on` expresses blocking. A launcher,
commit or routine verification does not automatically need a new research item
or code-review document.

1. **Predeclare Variants.** Agree on the comparison axes and reusable baselines,
   or proceed under explicit user-granted autonomy. Write Variants before
   launch. A retry is another Run, not another condition; a changed condition
   needs a new/revised Variant before execution.
2. **Implement and execute.** Use the launcher/execution workflows. Preserve
   attempts and code/artifact provenance. A launch contradicting its Variant
   requires immediate reconciliation; never retrofit declarations to disguise
   the mismatch.
3. **Batch writeback.** Apply the writer workflow at meaningful batch launch,
   outcome or interpretation boundaries. Combine Run references, Variant state,
   metrics and provenance. Do not require a writer invocation per Run, poll or
   lifecycle event. Preserve historical membership; deprecation alone does not
   move a Run between `runs` and `attempts`, and it never belongs in both.
4. **Interpret separately.** Compare eligible Variant results against the
   Investigation's criteria. Cite `INV...`/`V...` in Findings and state confounds
   in Limitations. Neither terminal status nor Run count implies `ANSWERED`.
   Exclude `partial`/`unavailable` metrics from comparison; preserve original
   measurements and request new evidence rather than inventing replacements.
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

Batch the new Run references, verified metrics and actual provenance back to
the Variant while preserving old evidence. Analyze only the new eligible
evidence, not historical deprecated measurements. New results should eventually
qualify independently of retained history; current projections cannot yet
separate their lineage, so disclose conservative `partial`/`unavailable` labels
instead of deleting history, restoring rejected Runs or claiming automatic
recovery.

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
rendered YAML projections back into README. The writer reference owns detailed
schema/status rules; do not duplicate them here.
