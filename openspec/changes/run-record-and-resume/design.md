## Context

See proposal.md (Why). This change applies after `run-results-v9` (FS v9). Current state:

- Run frontmatter (`packages/core/src/types.ts` `RunFrontMatter`, `schemas.ts` `RunFrontMatterRawSchema`): only `id` is required; `status`, timestamps, `host`, `pid`, `gpus`, `entry`, `command`, `wandb`, `archived`, `deprecated`. The schema is not strict and the serializer preserves unknown keys byte-for-byte, but nothing parses them and the derived-index `RunRowSchema` is `.strict()`.
- `setRunStatus` (`runs/mutations.ts`): `finished_at` on FINISHED/FAILED, cleared on RUNNING/PENDING; INTERRUPTED touches neither. INTERRUPTED is human-only by spec, terminal for central's 300 s window (`indexed-runs.ts`, `derived-index-mirror.ts`), and `create --from-run` mapped it to FAILED (fixed by `run-results-v9`'s derived Variant status).
- `memon run record` only writes a README for an existing directory; memon never starts a process. The `memon-write-script` launcher contract creates the Run directory, tees `run.log` and prints `[memon] RUN_DIR=`; resumption is "explicit request, reuse RUN_DIR, append run.log".
- Operator practice (anonymised): a dispatcher launches training with `setsid` (a dispatcher restart once killed two trainings), judges occupancy by the newest launch's missing exit code, resumes only through explicit continuation entries that create `resume-<step>/` folders with the segment's recipe, code and environment, reuse the W&B id through `WANDB_RUN_ID` + `WANDB_RESUME=must`, append `run.log`, and write an execution-state line (`RUNNING ts job= step= host=`). A separate reconciliation script later infers status from logs and checkpoints. Training stacks restore DCP checkpoints and RNG from `resume_from_checkpoint` (path or `latest`) and expose steps through recipes, `checkpoint-<N>/` directories, tracker `_step` and tqdm `N/M`; one project must keep W&B resume disabled.

## Goals / Non-Goals

**Goals:** one Run record that can describe many launches; every memon launch observable (log, heartbeat, exit) even without progress reporting; in-place resume with nothing overwritten; truthful `resumable`/`preemptible`; a stop-reason vocabulary the scheduler can act on.

**Non-Goals:** scheduling, queues, preemption decisions and node selection (`run-scheduler`); launching on another host (the wrapper supervises a local process group; remote placement is the scheduler backend's job); multi-host jobs as one launch; parsing logs or tqdm output for progress; GPU telemetry; automatic resume without a request; changing `result.csv` (owned by `run-results-v9`); an FS convention bump.

## Decisions

### 1. Run record contract (README frontmatter)

```yaml
---
id: train-a-261002-090000
name: train-a
status: INTERRUPTED
stop_reason: preempted
created_at: 2026-10-02T09:00:00+08:00
updated_at: 2026-10-02T15:03:12+08:00
finished_at: null
host: node-b                 # latest launch (compatibility mirror)
pid: 41822
gpus: [0, 1, 2, 3]
archived: false
entry: scripts/train.sh
command: bash scripts/train.sh --config configs/a.yaml
wandb: https://wandb.ai/acme/project-a/runs/ab12cd34
wandb_run_id: ab12cd34
target_steps: 20000
resources: { gpus: 4, nodes: 1 }
schedule:
  priority: 10
  preemptible: true
  preemptible_set: { at: 2026-10-02T08:59:00+08:00, via: cli, reason: "user: eval batch may be preempted" }
resumable: true
checkpoint: { dir: checkpoints, latest: checkpoints/checkpoint-12000, latest_step: 12000 }
progress: { step: 12345, target_steps: 20000, at: 2026-10-02T15:03:05+08:00 }
launches:
  - { seq: 1, started_at: 2026-10-02T09:00:04+08:00, host: node-a, pid: 39001, gpus: [0, 1, 2, 3],
      backend: local, handle: null, resume: false, start_step: 0,
      ended_at: 2026-10-02T12:00:10+08:00, end_step: 6000, exit_code: null, signal: SIGKILL,
      stop_reason: unknown, outcome: INTERRUPTED }
  - { seq: 2, started_at: 2026-10-02T12:10:00+08:00, host: node-b, pid: 41822, gpus: [0, 1, 2, 3],
      backend: local, handle: null, resume: true, start_step: 6000,
      ended_at: 2026-10-02T15:03:12+08:00, end_step: 12345, exit_code: 143, signal: null,
      stop_reason: preempted, outcome: INTERRUPTED }
---
```

| Field | Written by | Notes |
|---|---|---|
| `target_steps`, `resources`, `entry`, `command`, `checkpoint.dir`, `wandb_run_id`, `resumable`, `schedule.*` | `run create` / `run record` (human or skill), later explicit edits | intent and attributes; `preemptible` only with a reason |
| `status`, `stop_reason`, `finished_at`, `launches[]`, mirrors `host/pid/gpus`, `progress`, `checkpoint.latest*` | launch wrapper (and scheduler via the wrapper) | evidence-based; humans may still set status/stop_reason |
| `schedule.queued_at` etc. | `run-scheduler` | added by that change |

Flow-style launch entries keep the frontmatter readable; writers patch frontmatter keys and keep the body and unknown keys byte-for-byte (existing `reserializeReadme` path). `host/pid/gpus` stay top-level for old readers and the operator's scripts. The result stays in `result.csv`; checkpoint and W&B source facts live here, not in `result.csv`.

### 2. Machine state under `<runDir>/.memon/`

```
<runDir>/.memon/.gitignore      "*" (written first; the directory never reaches Git)
<runDir>/.memon/launch.lock     exclusive-create lock {seq, host, pid, started_at}
<runDir>/.memon/heartbeat.json  wrapper, every 30 s: {seq, host, wrapper_pid, child_pid, counter, at, log_bytes, progress}
<runDir>/.memon/progress.json   optional, written by the Run (atomic temp+rename)
<runDir>/.memon/stop.json       stop request {seq, reason, via, at, grace_s}
```

Rationale: these files change every few seconds or carry host-local process ids; tracking them would churn Git and leak machine state. A self-ignoring directory (the `.memon/index/` precedent) works whatever the project's ignore rules. Discovery never descends into Run directories and skips dot-directories, so nothing else changes. Alternatives rejected: progress in README (Git churn, lock contention with human edits), a central database (CLI nodes must work offline; no external DB).

Progress file (`progress_version: 1`):

```json
{ "progress_version": 1, "step": 12345, "target_steps": 20000,
  "checkpoint": { "path": "checkpoints/checkpoint-12000", "step": 12000 },
  "stop_reason": null, "message": "eval at 12000 done", "at": "2026-10-02T15:03:05+08:00" }
```

### 3. Logs and per-launch files

```
==== memon launch 2 | 2026-10-02T12:10:00+08:00 | host node-b | resume from step 6000 ====
<child output>
==== memon launch 2 ended | 2026-10-02T15:03:12+08:00 | exit 143 | INTERRUPTED (preempted) | step 12345 ====
```

`launch-<n>.json` (Run root, tracked or not as the project decides) holds the resolved argv, project-relative cwd, the `MEMON_*`/`WANDB_*`/`CUDA_VISIBLE_DEVICES` values memon set, `git rev-parse HEAD` and a SHA-256 of `git diff HEAD` (no diff body, no secrets), backend kind/handle/pool/node. Rationale (user decision): no attempt split; the operators' `resume-<step>/` folders become `launch-<n>.json` + appended log; the README history is the index of launches. Files the Run writes itself follow the skill contract (append, or name with `MEMON_LAUNCH_SEQ`).

### 4. State machine

```
            create / record
                  │
             ┌────▼────┐   launch (seq 1)    ┌─────────┐
             │ PENDING │ ──────────────────▶ │ RUNNING │◀───────────────────────────┐
             └─────────┘                     └────┬────┘                            │
                                                  │ child exit / stop / lost        │
                 ┌────────────────────┬───────────┴──────────┬──────────────┐      │
                 ▼                    ▼                      ▼              │      │
            ┌──────────┐        ┌────────┐         ┌──────────────────┐     │      │
            │ FINISHED │        │ FAILED │         │ INTERRUPTED      │     │      │
            │ terminal │        │        │         │ +stop_reason     │     │      │
            └──────────┘        └───┬────┘         └───┬──────────┬───┘     │      │
                                    │                  │          │         │      │
                    resume --allow-failed (resumable)  │ resume   │ launch --restart (seq+1, from 0)
                    launch --restart ──────────────────┴─(resumable, seq+1, MEMON_RESUME=1)─┘
```

| From | Event | To | Writer |
|---|---|---|---|
| PENDING | `run launch` | RUNNING (launch n opened) | wrapper |
| RUNNING | child exit 0 | FINISHED (+`finished_at`) | wrapper |
| RUNNING | child exit 0 + progress `stage_target_reached` | INTERRUPTED(stage_target_reached) | wrapper |
| RUNNING | stop request (any reason) then exit | INTERRUPTED(reason) | wrapper |
| RUNNING | wrapper got SIGTERM/SIGINT/SIGHUP it did not request | INTERRUPTED(node_reclaimed if backend says so, else unknown) | wrapper |
| RUNNING | child non-zero exit / unrequested signal | FAILED (+`finished_at`) | wrapper |
| RUNNING | heartbeat stale + process verifiably gone | INTERRUPTED(unknown), launch outcome `lost` | `run reconcile` (scheduler later) |
| INTERRUPTED | `run resume` (resumable) | RUNNING (seq+1) | wrapper |
| INTERRUPTED / FAILED | `run launch --restart` | RUNNING (seq+1, from step 0) | wrapper |
| FAILED | `run resume --allow-failed` (resumable) | RUNNING (seq+1) | wrapper |
| any | `run status set` | requested status (no launch entry change) | human |

### 5. Wrapper process model

```
launch(run, opts):
  rec = readRecord(run); checkPreconditions(rec, opts)           # archived, status, resumable, lock
  mkdir <runDir>/.memon (write .gitignore first); acquire launch.lock (wx; stale lock → refuse, suggest reconcile)
  seq = len(rec.launches)+1; startStep = opts.resume ? rec.checkpoint.latest_step ?? 0 : 0
  writeRecord(append launch seq {started_at, host, pid=self, gpus, backend, resume, start_step}, status=RUNNING,
              mirrors, stop_reason=null)                          # locked read-modify-write, retry on CONFLICT
  write launch-<seq>.json; ensure result.csv version row (member Runs)
  if opts.detach: double-fork + setsid; parent returns after the record shows RUNNING
  append separator to run.log; spawn `bash -c <command>` (cwd project root, env §6, own process group)
  pipe stdout+stderr → run.log (append, line-buffered)
  every 30 s: heartbeat(counter++, progress=read(progress.json)); if stop.json(seq) → requestStop(reason)
              if stage target reached in progress → requestStop(stage_target_reached)
  on SIGTERM/SIGINT/SIGHUP to wrapper: externalStop = true; requestStop(unknown)
  requestStop: kill(-childPgid, SIGTERM); after grace → kill(-childPgid, SIGKILL)
  on child exit(code, signal): classify (table in §4); writeRecord(close launch seq, status, stop_reason,
              finished_at, progress, checkpoint.latest); append end line; release lock; exit(code or 128+sig)
```

Record writes use the existing optimistic lock (`expectedMtime` + hash) with up to five re-read/re-apply attempts, because a human may edit the README body meanwhile; if all fail, the wrapper writes `launch-<n>.outcome.json` next to `launch-<n>.json` and exits non-zero so `run reconcile` can apply it — the outcome is never silently lost. A Node implementation (part of the CLI) keeps memon single-runtime; `setsid` is done with `detached: true` + `unref()`.

### 6. Environment contract

| Variable | Value |
|---|---|
| `MEMON_RUN_DIR`, `RUN_DIR` | absolute Run directory |
| `MEMON_RUN_PATH` | project-relative Run path |
| `MEMON_LAUNCH_SEQ` | 1-based launch number |
| `MEMON_RESUME` | `1` resume, `0` first launch or restart |
| `MEMON_PROGRESS_FILE` | `<runDir>/.memon/progress.json` |
| `MEMON_CHECKPOINT_DIR` | absolute declared checkpoint dir (when declared) |
| `MEMON_TARGET_STEPS`, `MEMON_STAGE_TARGET_STEPS` | when declared/requested |
| `WANDB_RUN_ID`, `WANDB_RESUME` | only when `wandb_run_id` is recorded: `allow` first, `must` on resume |
| `CUDA_VISIBLE_DEVICES` | set by a scheduler backend (not by the plain wrapper) |

`--wandb-id auto` generates an 8-character lowercase id at create time so the id is known before the first launch.

### 7. Truthful attributes

- `resumable`: the skill verifies the entry (e.g. it passes `resume_from_checkpoint latest` when `MEMON_RESUME=1`) and declares where checkpoints are found (`--checkpoint-dir` or `--progress-checkpoints`); without either the CLI refuses. The wrapper never flips the flag; it records `RESUME_DID_NOT_RESTORE` when a resume reports a start below the recorded checkpoint, which is evidence for a human to correct the flag.
- `preemptible`: default false; `--preemptible` requires `--preemptible-reason`; memon stores `{at, via, reason}`. "Who" is approximated by the surface (`cli`, `web`, `sched`) and the stated reason (memon does not record user names in project files). Skills must quote the user's instruction as the reason.

### 8. Reconcile and liveness

Stale = heartbeat counter unchanged for 3 intervals as observed by the reader. Lost = stale and (same host: wrapper pid absent or its start time differs from the lock) or (other host: `--assume-lost` after ≥ 10 min). Reconcile closes the open launch with `outcome: lost`, `ended_at` = last heartbeat time, sets `INTERRUPTED(unknown)` and removes the stale lock. The dashboard shows stale as an overlay only (existing rule: overlays never change status).

### 9. Index, central and Web

- `index_version: 3` adds `stop_reason`, `resumable`, `priority`, `preemptible`, `launch_count`, `last_launch {started_at, host, outcome}` to Run rows; v2 events are accepted and re-validated; central's terminal window covers FINISHED/FAILED only.
- New read resource `GET /api/runs/:id/live` (owner and exact-scope viewer like other Run reads; path-contained) returning progress + heartbeat state for `RUNNING` Runs, fingerprint-validated with a 5 s window and `ETag`; the Run panel polls it with the common heartbeat while visible.
- Run panel: launch table, stop-reason badge (wrapper around shadcn `Badge`, no fork), `Progress` bar, heartbeat age tooltip.

### 10. CLI nodes, skills and release

- Release 9.1.0 (`central,cli,skills`). CLI nodes get the wrapper through `memon update`; a node on 9.0.x keeps working (it ignores the new fields, preserves them on write because unknown keys are preserved, and writes v2 index events that 9.1 accepts).
- Skills: `memon-write-script` template becomes wrapper-aware (no `mkdir`/`tee` when `MEMON_LAUNCH_SEQ` is set; pass `MEMON_RESUME` to the entry; SIGTERM → checkpoint → exit); `memon-run-experiment` launches with `run create` + `run launch --detach`, monitors with `run progress`, resumes INTERRUPTED Runs in place, keeps "FAILED retry = new Run" unless the user asks otherwise, and carries the exact `preemptible`/`resumable` wording of the spec; the shared reference documents the progress file with a ten-line Python helper.
- In-flight Runs started by old launchers keep their records; to adopt one, record it and resume it through the wrapper when it is resumable. Existing `resume-<step>/` folders are user content and stay.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Wrapper dies with the node and leaves `RUNNING` | Heartbeat staleness + `run reconcile` (scheduler automates it); overlay in UI |
| README write conflicts between wrapper and a human edit | Optimistic lock with re-read/re-apply; outcome file fallback; never force |
| Long frontmatter after many launches | Flow-style entries; typical Runs have < 20 launches; lint caps nothing |
| Scripts that overwrite their own files on resume | Skill contract + `MEMON_LAUNCH_SEQ`; memon's own files never overwrite |
| SIGTERM semantics differ across schedulers (time limits, preemption) | External signals become `INTERRUPTED(unknown)`/`node_reclaimed`, which a human or scheduler can resume; true crashes stay `FAILED` |
| Clock skew between hosts | Staleness by observation, never by cross-host timestamps |
| `resumable` claimed wrongly | Requires checkpoint location; `RESUME_DID_NOT_RESTORE` diagnostic; skills must verify the entry |

## Migration Plan

No filesystem migration: every new field is optional and absent means unknown/default. Release 9.1.0, deploy central, `memon update` CLI nodes, reinstall skills in research projects. Rollback: install 9.0.x; READMEs written by 9.1 remain valid for 9.0 readers (unknown keys preserved).

## Open Questions

- Default heartbeat interval (30 s) and grace period (300 s) — tunable per Run; defaults can change without spec changes.
