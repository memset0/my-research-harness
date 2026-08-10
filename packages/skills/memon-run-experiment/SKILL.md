---
name: memon-run-experiment
description: Launch or resume an existing memon experiment script, monitor it through a terminal state, and own the individual Run README and artifacts. Use only when the parent Experiment and predeclared Variant are known; update the Variant's selected runs or attempts through memon-write-experiment-doc without automatically completing its Investigation or Conclusion.
---

# memon-run-experiment

Drive one launcher execution from preflight to a finalized Run README. This
skill owns Run-local truth; `memon-write-experiment-doc` owns the parent
Experiment's Results.

## Preconditions

1. Run `memon --project-root . --format json fs-version check`; continue only
   for `match` and otherwise follow `../PREFLIGHT.md`.
2. Read `AGENTS.md`, `CLAUDE.md`, or the project's equivalent instructions.
3. Require a parent `$EXP_ID` and `$VARIANT_ID`. If either is unknown, return to
   `memon-drive`/`memon-write-experiment-doc`; do not launch an orphan.
4. Read and validate Results:

   ```sh
   memon --project-root . --format json experiment doc show "$EXP_ID" results
   memon --project-root . --format json experiment doc validate "$EXP_ID"
   ```

5. Verify the Variant already exists, is launchable, and its parameters and
   provenance match the proposed entry, recipe, command, and env.

The Variant may have zero Runs and normally starts `PLANNED`. Never create it
retroactively after launching.

## Run-list contract

- `runs` contains selected executions used as evidence and metrics. Add a newly
  launched execution here by default.
- `attempts` contains failed, interrupted, invalid, or superseded executions.
  Move an unusable Run from `runs` to `attempts`; never leave it in both.
- A same-condition retry creates a fresh timestamped Run under the same Variant.
- If any comparison condition changes, stop and create/revise a Variant before
  retrying.
- Preserve every attempt's directory and README; list movement is not deletion.

All Results edits go through `memon-write-experiment-doc`.

## 1. Pre-launch checks

Before consuming cluster resources:

- verify the script with `bash -n` and inspect its actual entry/recipe/env;
- check the intended Python environment and imports;
- check GPU/accelerator health, free capacity, scheduler allocation, data and
  checkpoint paths;
- authenticate W&B if the entry uses it;
- capture current git HEAD and a filtered uncommitted code diff to temporary
  files for later placement in the Run directory;
- confirm no secrets will be copied into README, command, env, or diff.

If the script needs a fix, invoke `memon-write-script`. If code capability is
missing, return to the coordinating Implementation item.

## 2. Launch and discover the Run directory

Use synchronous execution for short jobs and a durable project-approved
session/scheduler for long jobs. Capture stdout. A conforming launcher emits:

```text
[memon] PROJECT_ROOT=...
[memon] RUN_NAME=...
[memon] RUN_DIR=...
```

Extract `RUN_DIR` from that output, use its basename as `$RUN_ID`, and verify:

- its basename matches `^.+-[0-9]{6}-[0-9]{6}$`;
- it is inside the configured project logs area;
- `run.log` exists and begins growing;
- this is a fresh directory unless the user explicitly requested a supported
  resume.

Do not guess the newest directory with `ls -t` when the launcher output is
ambiguous; stop and inspect the script or ask the user.

## 3. Establish Run-local truth immediately

Once the Run directory and proof of life exist, write a minimal Run README and
bind it to the Experiment. Use mtime/hash optimistic concurrency for every
subsequent write.

Canonical Run body sections remain:

```markdown
## Motivation

<optional Run-specific reason>

## Setup

<environment, hardware, inputs, parameters, command, recovery changes>

## Result

Pending while the Run is active.

## Artifacts

- `./run.log` — stdout/stderr
- `./code.diff` — uncommitted code at launch
- `./code.head` — git HEAD at launch
```

Frontmatter must capture the Run ID/name, `RUNNING` status, timestamps, parent
Experiment, host/PID/GPU where available, project-relative entry, reproducible
command, and W&B URL or null.

Run READMEs do not use Experiment sections such as `Design`, `Implementation`,
`Investigation`, `Results`, `Findings`, `Limitations`, `Conclusion`, or
`Warnings`. Per-Run method belongs in `Setup`; per-Run observed outcome belongs
in `Result`.

Bind through the canonical Experiment-link CLI, then invoke
`memon-write-experiment-doc` to append `$RUN_ID` to this Variant's `runs`, set
the Variant to `RUNNING`, and update actual launch provenance if needed.

Place the captured code snapshots into the Run directory only after it exists.
On resume, use timestamped snapshot names so prior state remains intact.

## 4. Expand Setup after stable running

After a short stability interval, replace the Setup placeholder with enough
detail to reproduce the exact execution:

- environment and hardware;
- entry, recipe, CLI flags, injected env, and resolved parameter values;
- data/checkpoint inputs and code commit/diff;
- scheduler/session identifiers;
- W&B identity;
- every mechanical recovery change under `Got it running by`.

If the process exits during this interval, follow the failure path instead.

## 5. Monitor without blocking the user

For long Runs, check at a reasonable cadence (about hourly):

- process/scheduler state;
- log growth and recent errors;
- key metrics, W&B state, and expected artifacts;
- disk/checkpoint health and obvious stalls.

Use recurring wakeups/polling, never filesystem watchers. Avoid long blocking
sleeps. Do not rewrite the README on every poll; update only durable information.

## 6. Success path

When the process genuinely finishes:

1. Read final logs, metrics, W&B state, and artifacts.
2. Write a factual Run `Result`; do not claim cross-Variant findings here.
3. Set Run status/timestamps to `FINISHED` with optimistic locking.
4. Invoke `memon-write-experiment-doc` to:
   - keep `$RUN_ID` in the Variant's `runs`;
   - write selected metrics and actual provenance;
   - set Variant status to `COMPLETED` when its intended evidence is complete,
     or keep it `RUNNING` when more selected Runs (for example seeds) remain.
5. Render Results and show the user the updated Variant row with derived W&B
   and memon links.

Return the evidence to `memon-drive`. Do not automatically mark the linked
Investigation `ANSWERED`, edit Conclusion, or resolve the Experiment. The
coordinator evaluates `success_criteria` and updates Findings separately through
the writer. When this skill is invoked standalone and the user explicitly asks
for synthesis, it may also invoke the writer for a narrowly evidenced Finding
or Limitation that cites the relevant `INV...`/`V...` IDs; terminal status alone
is never enough to justify that write.

## 7. Failure and recovery

When a Run fails or becomes unusable:

1. Preserve the log and extract a precise one-line failure reason.
2. Finalize its README as `FAILED` (or the canonical interruption status), with
   attempted Setup and factual Result.
3. Invoke the writer to remove `$RUN_ID` from `runs`, append it once to
   `attempts`, and update Variant status:
   - `RUNNING` when another same-condition Run is already active;
   - `PLANNED` when an immediate retry is intended but not launched;
   - `FAILED` when no selected Run remains and the Variant is abandoned due to
     execution failure;
   - `INCONCLUSIVE` when executions completed but cannot support a result.
4. Diagnose obvious problems. Ask before material environment changes.
5. If retrying with identical comparison conditions, launch a fresh Run under
   the same Variant. If parameters/recipe semantics change, stop and define a
   new or revised Variant first.

Never archive failed attempts automatically. They are part of the evidence
trail.

If a launcher crashes before it creates or reports a directory, create a
conforming failed Run directory only when enough execution identity exists to
document the attempt accurately. Otherwise stop and report the pre-launch
failure without fabricating a Run.

## 8. Warnings and reporting

If an anomaly needs human attention, invoke `memon-write-experiment-doc` to add
or update the Experiment's Warnings content. Do not call the deprecated warning
CLI.

In the final conversational report, cover:

- Variant and Run IDs;
- terminal state and key metrics;
- selected `runs` versus discarded `attempts`;
- W&B, memon Run document, entry, recipe, and commit links;
- fixes/retries and any warning or limitation requiring attention;
- what remains for the coordinating Investigation.

## Guardrails

- Never launch before the Variant exists.
- Never put one Run in both `runs` and `attempts`.
- Never rewrite the parent Experiment directly; use the writer skill.
- Never infer an Investigation answer from Run count or terminal status.
- Never write a cross-Variant Conclusion into a Run README.
- Never truncate `run.log` during resume.
- Never lose failed attempts or overwrite prior code snapshots.
