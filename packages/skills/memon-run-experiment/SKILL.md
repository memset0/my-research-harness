---
name: memon-run-experiment
description: Launch, resume or inspect a predeclared memon Variant, monitor execution to the requested boundary, maintain a minimal Run record and record the Run's measured values in its result.csv through memon run result set. Return execution evidence for batched Experiment updates; do not infer research conclusions.
---

# memon-run-experiment

Own execution, not a second research document. Follow `../PREFLIGHT.md` and the
project's instructions. Require an existing Experiment and a Variant declared
in its `experiment.json` before launch; read that Variant's planned `values`
and `provenance`, not every Run in the Experiment. Inspection alone never starts
a job.

For a rerun, explicitly inspect relevant deprecated Runs of this Variant when
useful: launcher, command, environment, paths and recovery history remain valid
reference material. Establish what failed and correct it before reuse; do not
reuse the rejected measurement as evidence. A request to redo the Variant
creates a fresh Run, not a resurrection of the deprecated record.

## Launch safely

- Read the launcher and its actual entry/recipe/env. Check shell syntax and the
  resources relevant to this execution: environment/imports, accelerator and
  scheduler allocation, capacity, data/checkpoints, and tracking authentication.
  Reuse still-valid batch checks; do not run irrelevant GPU checks for CPU work.
- Record actual code identity. Preserve relevant dirty changes using the
  project's diff allowlist; reuse an unchanged batch snapshot. Never capture
  secrets. Launcher changes follow `memon-write-script`; missing engineering
  capability returns to the coordinator.
- Use a project-approved durable session/scheduler for long jobs. Capture the
  launcher's `[memon] PROJECT_ROOT=`, `RUN_NAME=` and `RUN_DIR=` output. The Run
  id is that directory's basename, matching `^.+-[0-9]{6}-[0-9]{6}$` at a
  location the project's effective Run locations discover (by default directly
  under `logs/`, `outputs/` or `experiments/`; `project lint` prints them), never
  inside another Run directory — `run record` refuses a nested Run with exit 2
  (`RUN_NESTED`). Set `$RUN_PATH` to the observed directory relative to
  the project root (POSIX form, for example `logs/trial-260908-120000`).
  Use that path for commands, membership and result references; retain the
  basename only as a display ID. Confirm actual execution/log activity. Never guess the
  newest directory or fabricate a Run after a pre-launch failure.
- A new execution needs a fresh directory. Resume only when explicitly requested
  and supported; append to `run.log`, retain checkpoints and prior snapshots,
  and use distinct snapshot names. Ask before material environment changes.

## Record only execution facts

Once the actual directory exists, choose the observed `$STATUS` and record it:

```sh
memon --project-root . --format json run record "$RUN_PATH" --status "$STATUS"
memon --project-root . --format json experiment link "$EXP_ID" "$RUN_PATH"
```

`record` never launches or overwrites. Add known execution-specific options
(`--pid`, `--host`, `--gpus`, timestamps, entry/command or tracking URL) only when
useful; use `run record --help` for exact flags. `--body` reads optional notes
from stdin. Binding uses `experiment link`, which edits only the Experiment
README `runs` list; the Run path also belongs in the `runs` of its Variant in
`experiment.json` (the writer workflow adds it at the batch boundary). Never
write an `experiment` field into a Run README. Experiment declarations are the
sole membership authority; an unassigned Run is valid. Bare IDs are
compatibility selectors only when globally unique.

The record needs identity/state/time, not Motivation/Setup/Result/Artifacts.
Do not duplicate Variant parameters, provenance or Experiment interpretation.
Optional notes explain actual deviations or non-obvious artifact locations; when
one needs a component block, follow `memon-components`.
Existing rich records remain intact. Later metadata edits use mtime/hash locks;
use `run lint` after direct edits or for a structural concern, not every poll.
memon commands keep the derived index current; a direct README edit needs no
index step, and `.memon/index/` is never touched by hand (`../PREFLIGHT.md`).

## Record measured values

The Run's parameters, metrics and environment values describing the whole Run
go into its `result.csv`, written only through memon once the Run is linked:

```sh
memon --project-root . --format json run result set "$RUN_PATH" \
  params.seed=1 metrics.eval.fid=12.3 \
  metrics.eval.clip:mean=0.312 metrics.eval.clip:std=0.021 metrics.eval.clip:n=500
```

Use the paths the Experiment declares (`memon experiment results summary
"$EXP_ID"` lists them); a new path is allowed and shown as undeclared until the
writer declares it. Record a metric measured over samples as `stats` rows —
for example `mean`, `std` and `n` — never as `0.31 ± 0.02` or JSON text. Use
`--from <csv>` for many rows in `path,stat,value` form. Step histories,
checkpoints, W&B identities and logs stay in the Run directory and record, never
in `result.csv`. Invalid values exit 2 and write nothing; fix the value or ask
the writer to declare the column correctly. `BAD_STATE` means no single
Experiment declares the Run (link it first) or its `experiment.json` is
invalid; `RESULT_SCHEMA_MISMATCH` means the file records another
`experiment_schema_version`: report the listed file and upgrade command, do not
rewrite it by hand. On `RESULT_FILE_IGNORED` (the file is written but the
project's ignore rules exclude it), show the user the deciding rule and the
printed fix command and change the ignore file only after the user agrees.

## Monitor and finish

Remain responsible until terminal state or the user's explicit handoff boundary;
launch-only/detached behavior requires that request. Use recurring wakeups, not
filesystem watchers or long blocking sleeps. Check process/scheduler state, log
progress, relevant metrics/artifacts and obvious stalls. Do not rewrite a record
on each check. Report decisions or material changes, not routine polling prose.

Confirm outcomes from real exit/log/artifact evidence. Update Run status and
observed timestamps with a locked metadata edit; preserve failed/interrupted
executions and their artifacts. A same-condition retry gets a new Run on the
same Variant. Changed comparison conditions require a new/revised Variant
**before** another launch, never retroactive relabeling of an execution.

Return IDs, outcome, the values recorded in `result.csv`, provenance, useful
artifact references and remaining problems. Keep every Run listed in its
Variant's `runs`, including failed, interrupted and deprecated history; there is
no separate attempts list — evidence is derived from finished, non-deprecated
Runs, and a Variant's status follows its Run records. The coordinator batches
Variant `runs` and description changes at meaningful launch/outcome boundaries.
Do not invoke a writer per Run event. Standalone execution applies the writer
workflow once at its final/requested handoff so the parent is not left stale.

Run completion never answers an Investigation or resolves an Experiment.
Distinguish the new measurement's actual source Runs in the handoff. A
deprecated Run stays listed but contributes no value, so a verified replacement
Run of the same Variant becomes evidence on its own; never remove history or
restore rejected evidence to change a table.
Research synthesis follows the coordinator/writer only when requested.
Propose exclusion of invalid evidence to the user; deprecation is independent
of execution failure and never deletes or auto-archives an attempt.
