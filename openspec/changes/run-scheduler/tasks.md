## 0. Preconditions

- [ ] 0.1 Confirm `run-results-v9` and `run-record-and-resume` are archived (FS v9 Results, launch wrapper with detach/stop/reconcile, `INTERRUPTED` + `stop_reason`, `schedule` attributes and index v3 exist in the canonical specs); verify `openspec validate run-scheduler --type change --strict` and `openspec validate --all --strict` pass and every MODIFIED block still carries all canonical scenarios.

## 1. Core: scheduling model (pure, clock-injected)

- [ ] 1.1 Add `packages/core/src/sched/` types and the machine-local configuration schema (`schema_version: 1`, pools of kinds `local`, `nodes`, `slurm`, `ray` with their settings, idle thresholds, grace, requeue limit) with loader and `check-config` report; verify with schema tests for valid/invalid files, unknown kinds and the implemented flags.
- [ ] 1.2 Implement queue ordering (priority desc, `submitted_at`, path), admission rules (status, archived, live launch, resumable/preemptible/restart/allow-failed, `UNSCHEDULABLE`, dependencies, pool constraint), greedy best-fit placement with the idle gate (no capacity held for a waiting Run; reservations only from executed preemption plans); verify with table tests for every ordering, admission and placement scenario of `run-scheduler` (including FIFO ties, preempted Runs keeping their place, foreign-use slots, and a waiting large Run that holds no capacity while a later smaller Run is dispatched).
- [ ] 1.3 Implement the preemption planner (strictly lower priority, `preemptible` only, victim order resumable → least lost work → lower priority → most recent, minimal set, best node) and the tick reducer (commands, observations, liveness, requeue limit, dispatch backoff, reservations and timeouts) returning actions and events; verify with deterministic simulations on a manual clock covering pause-and-resume, rerun-from-scratch, equal priority never preempted, non-preemptible never stopped, lost launches and reservation timeouts.

## 2. Core: files and durability

- [ ] 2.1 Implement the lease (`wx`, renewal, observation-based takeover, self-exit on loss) and `.memon/sched/.gitignore`; verify with two-process tests that exactly one scheduler dispatches and a stalled holder exits after takeover.
- [ ] 2.2 Implement the command protocol (atomic create, name-ordered processing, outcomes in `done/`, pruning after 7 days, CLI wait) and write-on-change snapshots `state.json`/`nodes.json`; verify with tests for every op's applied/rejected outcome, pending commands without a scheduler, and unchanged snapshots keeping their bytes.
- [ ] 2.3 Implement README `schedule` queue-field writes (`submitted_at`, `queued_at`, `after`, `pool`, priority, preemptible with audit) through the Run mutation primitives with lock retry, and state recovery (validate `state.json` against Run records; bounded walk when it is missing); verify with tests that a deleted `state.json` is rebuilt with the same queue and placements.

## 3. Backends

- [ ] 3.1 Define the backend interface and the simulated backend with scripted launches (progress, checkpoints, heartbeats, exits) for tests; verify the reducer tests of 1.3 run against it unchanged.
- [ ] 3.2 Implement the `local` backend (virtual nodes and GPU slots, detached `memon run launch|resume` with `CUDA_VISIBLE_DEVICES`, pid + start-time liveness, signal/kill, simulated telemetry from occupancy) and the not-implemented stubs for `nodes`, `slurm` and `ray` (`BACKEND_NOT_IMPLEMENTED` at start, reported by `check-config`); verify with unit tests and with the start refusal scenario.
- [ ] 3.3 End-to-end test on a temporary project with fake training scripts (write progress, save a checkpoint on SIGTERM, honour `MEMON_RESUME`): submit → dispatch → heartbeat → higher-priority submit → preemption with checkpoint → requeue → resume from the checkpoint → finish, plus a killed wrapper (lost → requeue) and a scheduler restart that keeps both Runs alive; verify Run records, launch histories, `state.json`, `nodes.json` and Journal receipts at each step.

## 4. Journal

- [ ] 4.1 Add receipt version 2 (origin `sched`, detail kind `sched-event`, event vocabulary) with a writer used by the scheduler (no ambient invocation, bounded content), make CLI and backend readers parse v2 and report unsupported versions as unreadable, and add the origin/event/node/until filters with time-window file skipping; verify with journal tests (filters, paging stability, files outside the window not opened) and an activity test that a receipt contains no absolute path or environment value.
- [ ] 4.2 Make central publish `journal-change` when its observation of `.memon/activity/` finds new receipts; verify with a backend test that a receipt written by another process triggers one event.

## 5. CLI

- [ ] 5.1 Register `memon sched run|status|check-config|submit|cancel|pause|resume|priority|hold|release|drain` and the `memon journal read` filters, and update the top-level help; verify with CLI tests for every `memon-cli` scenario (exit codes 0/1/2/9, `SCHEDULER_NOT_RUNNING`, invalid priority, `--preemptible` without reason) and that `status`/`check-config` write nothing.

## 6. Backend and central routes

- [ ] 6.1 Add `GET /api/scheduler/state`, `GET /api/scheduler/nodes` (owner-only, classified explicitly as owner-only in `route-classes.ts` — `mutating` for viewer purposes — and in the Backend route table; fingerprint window 5 s, `ETag`), the history filters on `/api/journal/history` (owner-only), `POST /api/scheduler/commands` (owner-only, Run path containment, integer priority, no `preemptible` change, read-only projects refused, receipt recorded, one command file written) and the owner-only rule for the page `/p/<project>/scheduler`, all declared in the route table; verify with route tests that owners pass while exact-scope viewers, other-project viewers and anonymous requests get `401` from every scheduler API and the `302` to `/login` from the page, that no viewer-readable Journal response contains an origin-`sched` receipt, and for a read-only project.

## 7. Web

- [ ] 7.1 Add the `Scheduler` AppBar tab (shown to owners only, when `.memon/sched/` exists; viewer sessions never request scheduler data) and the owner-only panel: header and stale banner, Nodes & GPUs grid, queue tables with progress, history with event/Run/node/time filters, empty state, owner actions (Pause, Resume, Cancel with confirmation, Change priority) with pending/applied/rejected states, no viewer mode; polling every 10 s (state/nodes) and 30 s (history) through query keys from `lib/query-keys.ts`; verify with component tests (including a viewer session rendering no `Scheduler` tab) and the query-key snapshot test, and a grep that `components/ui/` is unchanged.
- [ ] 7.2 Add the same origin/event/Run/node/time filters to the Journal page; verify with component tests that the page lists exactly what the history API returns for each filter.
- [ ] 7.3 F1 verification on a release-build preview: start a loopback preview on port 3742 with a temporary standalone config and a scratch copy of `mock/project-a` (never the live host or its `.next`, AGENTS.md F5); on that copy run `memon sched run` with a temporary pool file declaring a `local` pool of virtual nodes `sim-a`/`sim-b` and fake training scripts, submit Runs of different priorities so that one preemption happens; run AGENTS.md §4.3 steps 1–5 (typecheck; `/` 200 with credentials; grep the Scheduler page markup for the nodes grid, queue table, history list and action menu markers; grep the referenced stylesheets for the five oklch tokens; desktop and 390 px screenshots with headless Chromium showing GPU slots, a reserved slot, a stopping Run and a filtered history); confirm a viewer session sees no `Scheduler` tab, is redirected to `/login` from the page and gets `401` from the scheduler APIs; stop the scheduler and the preview by process group and delete the scratch copy and temporary pool file.

## 8. Skills

- [ ] 8.1 Update `memon-run-experiment` and the shared reference per the `memon-skills` delta (submit when a scheduler is active, exact user-given priority, `--preemptible` only on explicit request with the reason, no allocation commands, no edits under `.memon/sched/`, a long-waiting Run reported with its waiting reason and its priority changed only on the user's instruction); verify the skills build and tests and a grep that no bundled skill mentions `salloc`, `scancel` or `scontrol update` outside an explicit prohibition.

## 9. Documentation and verification

- [ ] 9.1 Update `AGENTS.md` §2.1 (`.memon/sched/`, machine-local scheduler configuration, `memon sched`) and the README; verify no operator-specific names appear (grep against `LOCAL.md` names).
- [ ] 9.2 Run the change-relevant test list (core sched model/reducer/lease/commands/snapshots/backends/e2e, journal readers, CLI sched and journal, backend scheduler routes, web panel and Journal page, skills) and `pnpm typecheck`; verify all pass and report the list and results.

## 10. Deferred: requires real nodes

These tasks stay unchecked until real compute nodes are available; the change is not archived before they are done (design §15).

- [ ] 10.1 Implement the `nodes` backend: launches through `srun --jobid <allocation> --overlap -w <node>` with `setsid` from the scheduler host, allocation liveness through `squeue`/`sacct`, occupancy until the launch's exit receipt, never `salloc`/`scancel`/`scontrol update` of an allocation; verify on a held allocation. Deferred because it needs a real allocation on compute nodes.
- [ ] 10.2 Implement real GPU telemetry (`nvidia-smi` locally and through an overlap probe; three consecutive idle samples within thresholds; foreign-process detection) for the `local` and `nodes` backends; verify against real GPUs with and without foreign load. Deferred because it needs real GPUs.
- [ ] 10.3 Implement the `slurm` backend: one `sbatch` per launch with partition, account, gres, time limit and `max_concurrent`; job-state polling; stop through `stop.json` then `scancel` of the own job after the grace; `PREEMPTED`/`NODE_FAIL` mapped to `node_reclaimed`; verify on a real partition. Deferred because it needs a SLURM cluster.
- [ ] 10.4 Implement the `ray` backend on a Ray head running on held nodes; verify dispatch, liveness and stop. Deferred because it needs a Ray cluster on real nodes.
- [ ] 10.5 Validate end to end on real nodes: preemption of a real training job with checkpoint and resume, scheduler restart safety with overlap launches, heartbeat staleness over the shared filesystem, and the panel with real telemetry; record measurements in `LOCAL.md` and an anonymised summary in design.md. Deferred because it needs real nodes.
