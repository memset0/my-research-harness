---
name: memon-research
description: "Conduct and maintain experiments with memon: define variants, run or resume work, extract useful results, and explain research conclusions. Use for research tasks and experiment maintenance; use memon-wiki for durable project-level explanations."
---

# Research with memon

Read `../PREFLIGHT.md` once for the project. Work normally: inspect code and
existing evidence, write the code or analysis, execute within the user's
resource authorization, and explain what changed in our understanding.
Use memon to record identities and execution facts, not to dictate the research.

## Small default workflow

Use `memon --project-root .` with the following command families; consult
`--help` for options rather than reproducing a long command checklist.

- `project init` initializes a new project. Existing projects keep their format
  until an explicitly scoped migration.
- `experiment create <slug>` creates a free-form README and `experiment.json`.
- `experiment variant create <experiment>` prepares a new Variant and its first
  READY Run. Continue using the returned Run path; do not create it twice.
- `run create --experiment <experiment> --variant V0001` creates a directory
  and `run.json`, also creating the Variant directory if needed. It does not
  launch a job. Use `--variant smoke` for checks and `--params <json>` for a plan.
- `run update <path> --status READY|QUEUED|RUNNING|FINISHED|INTERRUPTED|FAILED|RESUME_READY|UNKNOWN`
  records observed execution state; options also record job ID, W&B and times.
  The website displays JSON Run metadata read-only; lifecycle writes belong on
  the source CLI so exports and registration stay together.
- `run result set <path> metrics.loss=0.2` records
  a useful result. Native logs and configs remain valid sources; extract more
  only when needed.
- CLI creation, status/activity changes and result writes refresh `run.json →
  result.csv → results.csv`. Use `experiment results rebuild <experiment>` after
  direct edits or native result extraction. Commit the CSVs and metadata for
  browsing; a failed publication needs repair before trusting the displayed table.

Create drafts before costly work when a plan is useful. Do not require a new
approval when the user's task already authorizes execution. Resume an existing
Run in place; a new attempt receives its own directory. A Run belongs to one
Experiment and one Variant through `logs/E0001/V0001/<runid>/`. Smoke directories
use `logs/E0001/smoke/<runid>/`; their execution state matters but their outputs
are excluded from formal aggregation. Never create a Run README for FS11.

## Variant intent and evidence

`experiment.json` contains `format: "lightweight"`, optional `groups`/`columns`,
and per-Variant settings only when needed (for example custom aggregation).
It has no Run bindings, required names or drafts. Directory paths determine
ownership. A prepared Run can be as small as:

```json
{
  "id": "trial-a",
  "status": "READY",
  "active": true,
  "created_at": "2026-10-20T12:00:00+08:00",
  "params": { "learning_rate": 0.0001 }
}
```

Let the CLI generate identity and current local-offset times. READY is prepared
but unsubmitted; QUEUED is submitted; RESUME_READY is prepared continuation but
not resubmitted. Legacy PENDING is ambiguous: do not guess which it means.
Partial parameters are enough to review a plan. READY parameters are planned;
READY outputs never become measured evidence. Preserve actual conditions beside
existing measurements when preparing resume.

`active` controls current Variant participation independently of process state.
The first Run is active by default; new attempts do not replace it unless
`--activate` is given. `run update <path> --active false` keeps history without
using its values. Optional `--name`, `--description`, or `--assessment
INVALID|LIMITED|SUPERSEDED|OTHER --reason <text>` record useful context only.
Inactivity alone does not mean invalid measurement. Do not maintain imported
`legacy_sections` on new Runs: they are a compatibility container for old prose.

The default aggregator accepts zero or one active Run per ordinary Variant.
Multiple active Runs require `variants.V0001.aggregate: "aggregate_variant.py"`
in experiment.json; use `--active true` to add a selected input intentionally.
Read [aggregation.md](aggregation.md) only for custom aggregation. Explicit
`run.*` columns project chosen metadata, such as status or a scheduler job ID.
Saved `results.csv` has only `variant,path,stat,value`, with no cache fields.

## Maintain the explanation, not a diary

Keep the Experiment README short: the question, current judgment, useful
comparisons, qualifications and links. Revise the existing analysis when the
evidence changes; do not append one bullet per Run. Put independent technical
setup or secondary analyses in `details/` only when they need their own file.
Keep cross-Run evidence and conclusions together. Do not create implementation
or investigation documents unless explicitly requested; use
`memon-structured-work` for that optional workflow.

Retirement means leaving the research direction, not invalid measurement.
Distinguish wrong measurements, limited precision and superseded methods in
Run assessments and the conclusion. Preserve reusable evidence and old links.
For a fundamentally invalidated experiment, create a new E number and retire
the old one; FS11 has no experiment epoch or research-version ledger.

Change lifecycle only as authorized by the owner: ACTIVE, PAUSED, ARCHIVED
(phase set aside, still relevant) or RETIRED (direction exited). RUNNING and
COMPLETED are derived display states. A finished Run does not complete research.
Update Wiki when understanding, direction or an important explanation changes.

After direct Run/config/result edits, rebuild the affected experiment results,
then run `memon index rebuild` once for the batch. CLI
writers publish the inventory themselves; report incomplete registration and
repair it explicitly. Never hand-edit the cache. Use native artifacts and
scripts freely; neither a template nor a dashboard should limit the analysis.
