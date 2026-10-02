## Context

See proposal.md (Why). This change applies after `run-results-v9` and `run-record-and-resume`. It relies on: the launch wrapper (`memon run launch|resume --detach`, own session, heartbeat file, `stop.json` requests honoured within one heartbeat, grace then `SIGKILL`, exit classification into `INTERRUPTED` + `stop_reason`, `run reconcile`), the Run record contract (`schedule.priority`/`preemptible` with audit, truthful `resumable`, `checkpoint.latest*`, append-only `launches` with `backend`/`handle`), and the derived Variant status (`INTERRUPTED` counts as in progress). Current state otherwise:

- memon executes nothing on its own. `slurm-status` is a read-only `squeue --me` widget; execution providers (`local`, `ssh`) serve Git, Slurm queries and components only; nothing calls `sbatch`, `srun` or `scancel`.
- The Journal is `docs/journal.md` (frozen legacy) plus one JSON receipt per invocation in `.memon/activity/<YYYYMMDD-HHMMSS>-<8hex>.json` (`version`, `id`, `startedAt`, `finishedAt`, `command`, `origin: cli|web`, `parameters`, `outcome`, `details[]` of kinds `target`, `file-change`, `legacy-event`); `memon journal read` filters by since/tag/experiment/run; `/api/journal/history` is owner-only; central publishes `journal-change` for its own receipts; browsers poll (no SSE except the log stream).
- Operator practice to productize (anonymised): a dispatcher re-reads a human-maintained allocation→node file every 60 s and uses only listed nodes; judges a node busy while the newest launch it started has no exit code; requires three consecutive idle samples (all GPUs ≤ 1000 MiB) before dispatch; dispatches whole nodes (4 GPUs); orders by priority, then training before evaluation, then newest; starts training with `setsid`; never resumes implicitly; reaches compute nodes only through `srun --jobid <alloc> --overlap` from a login node (no direct SSH); is forbidden to `scancel`/`scontrol update` allocations.

## Goals / Non-Goals

**Goals:** a correct, fully tested scheduling core (queue, ordering, admission, placement, preemption, requeue, liveness) driving real launches on the local machine; a control and observation surface (CLI, command files, snapshots, Journal, panel) that will not change when real backends arrive; a backend interface whose real implementations only add I/O.

**Non-Goals (this change):** implementing the `nodes`, `slurm` and `ray` backends or real GPU telemetry (deferred, see §15); multi-node launches; sharing pools between projects or cross-project fairness; quotas, fair-share or deadlines; acquiring, extending or releasing allocations; running the scheduler inside central; automatic tuning of priorities.

## Decisions

### 1. Process model

One `memon sched run --project-root <p>` per project, on a machine that can reach the compute resources (for the `local` backend: the machine itself). Central cannot be the scheduler: it may not reach compute nodes (only login nodes can `srun --overlap`), it must not die with them, and CLI nodes must keep working without central. Tick = 15 s (configurable). Lease `.memon/sched/lease.json` `{host, pid, started_at, renewed_at, release}` created with `wx`, rewritten (temp + rename) each tick by its holder only; a contender takes over only after observing the content unchanged for 120 s on its own clock (no cross-host clock comparison); a holder that finds a foreign lease stops dispatching and exits 1. Launches are detached sessions, so a scheduler crash or restart never kills training (the operator incident that motivated `setsid`).

### 2. Machine-local pool configuration

```yaml
# ~/.config/memon/sched.yml   (deployment data: never in a project, never tracked)
schema_version: 1
tick_seconds: 15
default_grace_seconds: 300
lost_requeue_limit: 3
pools:
  - name: local
    backend: local
    telemetry: simulated            # the only telemetry implemented now
    idle: { samples: 3, max_util_pct: 5, max_mem_mib: 1000 }
    nodes:
      - { name: sim-a, gpus: 4 }
      - { name: sim-b, gpus: 4 }
  - name: alloc-a                   # schema only (backend not implemented)
    backend: nodes
    gpus_per_node: 4
    launcher: srun-overlap
    allocations:
      - { job: "<allocation id>", nodes: [node-a, node-b] }
  - name: batch                     # schema only
    backend: slurm
    partition: <partition>
    account: <account>
    gres: "gpu:4"
    time_limit: "24:00:00"
    max_concurrent: 8
  - name: ray-a                     # schema only
    backend: ray
    address: "ray://<head>:10001"
```

Placement of this file follows the configuration split: deployment facts (node names, allocation ids, partitions, accounts, cluster addresses) live on the machine that uses them; `.memon/project.yml` stays layout-only and tracked; central `config.yml` describes central's own projects and is not available on CLI nodes. Central never needs the file — it reads the snapshots the scheduler publishes. The human edits the file to change what the scheduler may use (the productized allocation file); `hold`/`release`/`drain` are runtime commands within those bounds. The concrete file of the operator's machine is recorded only in `LOCAL.md`.

### 3. Files under `.memon/sched/` (self-ignored)

```
.memon/sched/.gitignore            "*"
.memon/sched/lease.json            §1
.memon/sched/state.json            sched_version 1, written when content changes
.memon/sched/nodes.json            sched_version 1, written when a sample changes
.memon/sched/commands/<ms13>-<rand8>.json      control commands (temp ".tmp-…" then rename)
.memon/sched/commands/done/<id>.json           outcomes, pruned after 7 days
```

`state.json` (abridged):

```json
{ "sched_version": 1, "seq": 812, "tick_at": "2026-10-02T12:00:15+08:00",
  "scheduler": { "host": "sched-host", "pid": 4242, "release": "9.2.0", "started_at": "2026-10-02T08:00:00+08:00", "tick_seconds": 15 },
  "pools": [ { "name": "local", "backend": "local", "implemented": true, "gpus": 8, "used": 6, "reserved": 2, "held_nodes": [] } ],
  "queue": [ { "run": "logs/b-261002-091500", "priority": 5, "preemptible": false, "resumable": true,
               "submitted_at": "2026-10-02T09:15:00+08:00", "state": "reserved", "reason": "waiting for logs/a-261002-090000 to stop",
               "resources": { "gpus": 4 }, "progress": null } ],
  "running": [ { "run": "logs/a-261002-090000", "pool": "local", "node": "sim-a", "gpus": [0, 1, 2, 3], "launch": 2,
                 "priority": 1, "preemptible": true, "resumable": true, "heartbeat": "ok",
                 "progress": { "step": 12345, "target_steps": 20000, "checkpoint_step": 12000 },
                 "stopping": { "reason": "preempted", "requested_at": "2026-10-02T12:00:00+08:00", "grace_until": "2026-10-02T12:05:00+08:00" } } ],
  "reservations": [ { "run": "logs/b-261002-091500", "node": "sim-a", "gpus": [0, 1, 2, 3], "victims": ["logs/a-261002-090000"] } ],
  "warnings": [] }
```

`nodes.json`: `{sched_version, sampled_at, telemetry, nodes:[{name, pool, state, gpus:[{index, util_pct, mem_used_mib, mem_total_mib, run, reserved_for, foreign, idle, idle_streak}]}]}`. Snapshots are rewritten only when their content (excluding timestamps) changes so unchanged files answer `304`; the lease carries the tick liveness.

### 4. Queue model and durability

The Run README is the durable source: `schedule.submitted_at` (FIFO key, kept across preemption), `queued_at` (null when not waiting), `after` (Run paths that must be `FINISHED`), `pool` (optional constraint), plus B's `priority`/`preemptible`. `state.json` caches order, placements, reservations and holds; it is rebuilt at start from itself, validated against each listed Run record, and — only when missing or unreadable — by one bounded walk of the effective Run locations collecting Runs with `queued_at` set or with an open launch whose `backend` is one of this scheduler's pools. The scheduler is the only writer of queue fields; it clears `queued_at` when it observes the dispatched launch open in the Run record (journal `started`), and on cancel or pause. Command files are durable until processed, so submissions made while no scheduler runs are not lost.

### 5. Per-Run scheduler state machine

```
 submit ──▶ waiting ──place──▶ dispatching ──wrapper RUNNING──▶ running ──child exit──▶ out (FINISHED/FAILED)
              ▲  │                  │ dispatch error (backoff, ≤3)            │ stop request (preempt/pause/cancel/drain)
              │  └─▶ reserved ──victims gone──▶ dispatching                   ▼
              │                                                          stopping ──exit──▶ INTERRUPTED
              │                                     requeue (preempted / node_reclaimed / lost ≤ limit) │
              └────────────────────────────────────────────────────────────────────────────────────────┘
 pause: running → stopping → paused (not queued) ── resume ──▶ waiting
 cancel: waiting/reserved → out; running → stopping → out (INTERRUPTED user_paused, queued_at cleared)
```

Run status transitions stay those of `run-record-and-resume`: PENDING → RUNNING (first dispatch), RUNNING → INTERRUPTED(`preempted`|`user_paused`|`node_reclaimed`|`unknown`) → RUNNING (resume, or restart from step 0 for non-resumable preemptible Runs) → FINISHED/FAILED. The scheduler never writes `FINISHED`/`FAILED` itself; the wrapper does from the exit.

### 6. Tick

```
tick(now):
  renewLease() or stopDispatchingAndExit()
  for cmd in sorted(commands/): outcome = apply(cmd); writeDone(cmd, outcome); unlink(cmd)   # §10
  cfg = reloadIfFingerprintChanged(config)
  tel = {pool: backend(pool).sample(now)}; updateIdleStreaks(tel)
  for p in placements:                                   # §9
     rec = readRunRecord(p.run)                          # fingerprint-validated
     if launchClosed(rec, p.launch): release(p); journal(finished|failed|interrupted); maybeRequeue(rec)
     elif heartbeatStale(p) and backend.isAlive(p.handle) == false: reconcileLost(p); release(p); maybeRequeue(rec)
     elif p.stopping and now > p.stopping.grace_until: backend.kill(p.handle)
  for R in eligibleQueue(order = priority desc, submitted_at asc, path asc):   # skips deps/paused/holds/backoff
     if R.reservation: if slotsFree(R.reservation): dispatch(R, R.reservation); continue
     if place := bestFit(R, freeSlots(excluding reservations)): dispatch(R, place); continue
     if plan := preemptionPlan(R): for v in plan.victims: stop(v, 'preempted'); reserve(R, plan); continue
     R.reason = 'insufficient resources'                 # later Runs may still use unreserved free slots (backfill)
  publish(state.json, nodes.json) if changed
```

Backfill (a later Run may take free capacity a waiting Run cannot use) is deliberate: strict head-of-line blocking would idle GPUs whenever the head needs a whole node. The risk — a large Run starving behind small non-preemptible ones — is listed in Risks.

### 7. Placement and idle gate

Free slot = no placement or reservation, node `up` (not held/draining/down), telemetry idle for `idle.samples` consecutive samples (utilization ≤ `max_util_pct`, memory ≤ `max_mem_mib`, no foreign process). A placement occupies its slots from dispatch until the Run record shows that launch closed (the productized "exit receipt") or it is reconciled lost. Best fit: among nodes with enough free slots, the one with the fewest free slots, then node order; GPU indices ascending. A request larger than every node of the allowed pools is rejected at admission (`UNSCHEDULABLE`); `resources.nodes > 1` is rejected the same way in this change.

### 8. Preemption

```
preemptionPlan(R):                      # R = first queued Run that cannot be placed, priority P
  best = null
  for node n in allowedPools(R).nodes where n.state == up:
     free = freeSlots(n)                                  # idle, unreserved
     cands = [v in running(n) if v.priority < P and v.preemptible and not v.stopping]
     sort cands by (not v.resumable, lostWork(v), v.priority, -v.started_at)
         # resumable first, then least work lost (steps or time since checkpoint; since launch start if not resumable),
         # then lower priority, then most recently started
     chosen = []
     for v in cands: if |free| + Σslots(chosen) >= R.gpus: break; chosen.append(v)
     if |free| + Σslots(chosen) < R.gpus: continue
     for v in reversed(chosen): if |free| + Σslots(chosen - v) >= R.gpus: chosen -= v   # minimality
     key = (count(not v.resumable for v in chosen), Σ lostWork(chosen), max priority(chosen), len(chosen), n.order)
     best = min(best, (key, n, chosen))
  return best
```

Victims receive `stop` with reason `preempted` and their grace (Run record override, else pool default 300 s) through `stop.json` (works across hosts) plus a backend signal; the wrapper forwards `SIGTERM`, the training script saves a checkpoint, the wrapper records `INTERRUPTED(preempted)`. The freed slots are reserved for R (no backfill onto them). After the grace the backend kills; if slots are still not free after 2 × grace the reservation is dropped and the victim is reconciled lost. A higher-priority arrival can take over a reservation; nothing else can. preemptible + resumable → resumed later (`MEMON_RESUME=1`); preemptible + not resumable → rerun from scratch in the same Run directory (`--restart`); not preemptible → never chosen; equal or higher priority → never chosen. There is no "may preempt others" flag.

### 9. Liveness and requeue

Heartbeat staleness is judged by observation (counter unchanged for 3 intervals of the wrapper, 90 s by default). Stale + backend `isAlive == false` → `run reconcile`-equivalent (`INTERRUPTED(unknown)`, launch outcome `lost`, lock cleanup), journal `heartbeat_lost`, requeue when resumable or preemptible while the consecutive-lost count < `lost_requeue_limit` (3), else leave out of the queue with a warning. Stale + alive/unknown → warning only. `node_reclaimed` (from the backend, e.g. a vanished allocation) is requeued like `preempted`. Dispatch errors back off (30 s, 2 min, 10 min) and give up after three with `dispatch_failed`.

### 10. Command protocol

```json
{ "command_version": 1, "id": "1759370400123-9f3a2c1b", "op": "priority",
  "run": "logs/a-261002-090000", "priority": -3, "via": "web", "issued_at": "2026-10-02T12:00:00+08:00" }
```

Ops: `submit` (+ priority, preemptible + reason, after, pool, restart, allow_failed), `cancel`, `pause`, `resume`, `priority`, `hold`, `release`, `drain` (node). Validation happens when applied (the scheduler sees current state); the CLI pre-validates arguments only. Outcomes `{id, op, outcome: applied|rejected, code, message, processed_at}`. Writers: the CLI (`memon sched …`, waits up to two ticks unless `--no-wait`) and central for owner panel actions (owner-only `mutate` route; path containment of the Run; refuses read-only projects; records its own receipt). Neither writes Run records or snapshots.

### 11. Backends

```ts
interface SchedBackend {
  readonly kind: 'local' | 'nodes' | 'slurm' | 'ray'
  readonly implemented: boolean
  inventory(pool: PoolConfig): NodeInventory[]                       // nodes × GPU slots
  sample(pool: PoolConfig, now: Date): Promise<NodeTelemetry[]>      // util/mem/foreign per slot
  launch(run: RunRef, placement: Placement, mode: 'first' | 'resume' | 'restart'): Promise<LaunchHandle>
  isAlive(handle: LaunchHandle): Promise<boolean | 'unknown'>
  signal(handle: LaunchHandle, sig: 'SIGTERM' | 'SIGKILL'): Promise<void>
}
```

- `local` (implemented): `launch` spawns `memon run launch|resume <run> --detach [--restart]` with `CUDA_VISIBLE_DEVICES=<slots>` and records `backend: local`, `handle: {host, wrapper_pid}`; `isAlive` checks the pid and its start time; telemetry `simulated`: an occupied slot reports 85–95 % utilization and the pool's busy memory derived from the Run's progress, a free slot reports 0/0; virtual nodes let one machine model several nodes for the panel and tests. Real `nvidia-smi` telemetry is deferred.
- Simulated backend + manual clock (tests only): in-memory launches whose progress, checkpoints, heartbeats and exits are scripted, so the whole tick logic is tested deterministically without processes.
- `nodes` (deferred): `srun --jobid <alloc> --overlap -w <node> --gres=gpu:<k> setsid memon run launch …` from the scheduler host; liveness from the heartbeat plus `squeue`/`sacct` of the allocation; telemetry via an overlap `nvidia-smi` probe; never `salloc`/`scancel`/`scontrol update` of the allocation.
- `slurm` (deferred): one `sbatch` per launch (partition, account, gres, time limit, `max_concurrent`), job id as handle; stop via `stop.json` and, after the grace, `scancel` of that own job only; `PREEMPTED`/`NODE_FAIL` → `node_reclaimed`.
- `ray` (deferred): submit to a Ray head running on held nodes; handle = Ray job id.
- Unimplemented kinds validate their schema; `memon sched run` refuses with `BACKEND_NOT_IMPLEMENTED` naming the pools (an explicit failure instead of a silently partial scheduler).

### 12. Journal recording

One receipt per event in `.memon/activity/`, record `version: 2` (adds origin `sched` and detail kind `sched-event`; older readers report it unreadable without failing):

```json
{ "version": 2, "id": "20261002-120000-3e05dd17", "startedAt": "2026-10-02T12:00:00+08:00", "finishedAt": "2026-10-02T12:00:00+08:00",
  "command": "sched preempted", "origin": "sched", "parameters": {}, "outcome": "success",
  "details": [ { "kind": "sched-event", "event": "preempted", "run": "logs/a-261002-090000", "pool": "local", "node": "sim-a",
                 "gpus": [0, 1, 2, 3], "priority": 1, "preemptible": true, "resumable": true, "launch": 2,
                 "reason": "for logs/b-261002-091500 (priority 5)", "at": "2026-10-02T12:00:00+08:00" } ] }
```

Events: `enqueued`, `dispatched`, `started`, `heartbeat_lost`, `preempted`, `resumed`, `restarted`, `requeued`, `finished`, `failed`, `interrupted`, `paused`, `cancelled`, `priority_changed`, `node_held`, `node_released`, `dispatch_failed`. Filters (CLI, history API, Journal page, panel): origin, event, Run, node, since/until; the time-ordered receipt names let readers skip files outside the window without opening them. Central publishes `journal-change` when its observation of `.memon/activity/` sees new receipts.

### 13. Scheduler panel

- Routes: `GET /api/scheduler/state`, `GET /api/scheduler/nodes` (owner + exact-scope viewer, `read` class, fingerprint window 5 s, `ETag`), `GET /api/journal/history?origin=sched&…` (owner-only, existing class), `POST /api/scheduler/commands` (owner-only `mutate`). All through the route table and path containment.
- Refresh: state and nodes every 10 s, history every 30 s, only while visible and focused (common resource lifecycle, `If-None-Match`). Worst-case display lag ≈ tick 15 s + window 5 s + poll 10 s ≈ 30 s. Stale scheduler banner when `lease.renewed_at` is older than three ticks.
- Layout: header (scheduler status, pools summary with `simulated` telemetry badge), Nodes & GPUs (one card per node, slot grid with utilization bar, memory, occupying Run link, `idle n/3`, reserved/foreign markers), Queue (waiting table in scheduler order; running table with node, GPUs, launch, heartbeat, progress bar, stopping countdown), History (filters: event `Select`, Run and node `Input`, time range; newest first), owner actions (row `DropdownMenu`: Pause / Resume / Cancel (confirm `Dialog`) / Change priority (integer `Input`), pending → applied/rejected badge).
- Viewers: same page without actions; history replaced by an owner-only note. Built from shadcn primitives; no fork of `components/ui/`; 390 px without page-level horizontal scroll; F1 verification on a 3742 preview.

### 14. Safety boundaries

No allocation is ever acquired, extended or released; backends cancel only jobs they submitted. Every Run path from a command is resolved with containment and must be a discovered Run. Receipts and snapshots hold project-relative paths, node names and GPU indices only (no environment, no absolute paths, no command lines). Read-only projects reject panel actions. Skills never edit `.memon/sched/` or the pool file and never run allocation commands.

### 15. Change lifecycle (decided with the user)

The change stays active after the shell ships: tasks section 8 ("Deferred: requires real nodes") stays unchecked until real nodes exist, and the change is not archived before it is done. Releases can ship in between (9.2.0 for the shell; a later MINOR for each real backend). Whether to instead archive the shell and move section 8 into a separate change (e.g. `run-scheduler-backends`) is left for the user to decide later; nothing in the specs depends on that choice.

### 16. CLI nodes, skills and release

Release 9.2.0 (`central,cli,skills`): `memon update` on the node that will run the scheduler; skills reinstalled so execution skills submit instead of launching when a scheduler is active. The operator keeps the hand-written dispatcher for real nodes until the deferred backends ship; only then is the operator project's `AGENTS.md` changed (rollout item in the proposal, not a task).

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Two schedulers on one project (lease race over NFS) | `wx` lease + observation-based takeover; a holder seeing a foreign lease stops dispatching and exits |
| Backfill starves a large Run behind small non-preemptible ones | Users mark long small jobs preemptible or lower priority; a reservation-after-wait policy is a later refinement |
| Preemption thrash (repeated stop/resume) | Victims keep their `submitted_at`; preemption only for strictly lower priority; minimal victim sets |
| Training ignores SIGTERM and loses work | Grace then kill; skills require checkpoint-on-SIGTERM; `RESUME_DID_NOT_RESTORE` diagnostics |
| Activity directory grows with scheduler receipts | Time-ordered names bound reads; a retention policy can be added without format change |
| Simulated telemetry hides foreign GPU use on a real workstation | `local` documents that declared slots must be exclusive until `nvidia-smi` telemetry ships |
| State snapshot lost | Rebuilt from Run records (one bounded walk) and command outcomes |
| Panel actions on a project whose scheduler is down | Pending state plus `SCHEDULER_NOT_RUNNING` warning; commands persist until processed |

## Migration Plan

No filesystem migration (`.memon/sched/` is new and self-ignored; new README `schedule` keys are optional). Release 9.2.0, deploy central, `memon update` the scheduler host, reinstall skills, write the machine-local pool file, start `memon sched run` (for now with a `local` pool). Rollback: stop `memon sched`; launched Runs continue and finish under their wrappers; delete `.memon/sched/` if desired; install 9.1.x.

## Open Questions

None blocking. The archive-or-split decision for the deferred backends is the user's to make later (§15).
