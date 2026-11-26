# Design

## Context

See proposal.md for motivation. Current state this builds on:

- **`node-access`** gives a central-local node registry (`~/.config/memon/nodes.yml`) and `memon ssh`. **`cluster-dashboard`** moves the parser to `@memon/core` and adds `allocation: node|gpus` and `allocatable_gpus`, plus a read-only `nvidia-smi` probe (`PROBE_LINE`, `parseProbeOutput`).
- Each managed GPU node runs a memon-owned herdr core, separate from any other herdr installation.
  - Central reaches each core through memon's own herdr client, installed apart from other clients (`$MEMON_HC`, default `~/.local/share/memon/herdr-core/bin/hc`). Its machines are added with per-node via scripts that serve only herdr's connect line.
  - On Slurm-held nodes the core is a Slurm step named `herdr-core`; each connection is a step named `herdr-connect`.
- Verified on a real node:
  - `hc kill` alone leaves a `setsid` grandchild alive;
  - cancelling the task's own `srun --overlap` step reaps it;
  - a terminal's task survives a restart of the central herdr client;
  - `hc exec` ends every process it started when it returns (good for short commands, useless for long ones).
- `user-accounts-admin` gates `/api/gpu-pool/*` with the `access_clusters` capability (admin and super admin; owner Basic auth resolves to the super admin).

## Goals / Non-Goals

**Goals:**
- One central broker owns GPU assignment.
- Grants are exact (node + GPU indices).
- Reclaim is complete on Slurm-held nodes.
- Agents keep full freedom inside a ticket.

**Non-Goals:**
- Priorities, preemption, backfill guarantees and fair share.
- Ray per ticket (next change).
- Hard device isolation: `CUDA_VISIBLE_DEVICES` is advisory; violations surface as unticketed use and dirty GPUs.
- Nodes without a connected memon herdr machine.

## Decisions

1. **Broker in memon-central, state in SQLite.**
   - `lib/server/gpu-pool/store.ts` holds `tickets` and `dirty_gpus` in `memon-gpu-pool.sqlite3` beside `config.yml`. This is central-side local state, like the existing embedded stores, and AGENTS.md's allow-list is extended.
   - The broker is a process-wide singleton on `globalThis`, because `server.ts` (tsx) and Next route bundles load separate module copies.
   - It ticks on a `setTimeout` loop (15 s base, doubling to 5 min on errors, reset on success). Request and release also trigger an immediate tick.
   - `server.ts` starts it at boot, so expiry is enforced without traffic. No watchers.

2. **Herdr machine and hold by convention, not new registry keys.**
   - A node's herdr machine is the machine with the node's id in memon's herdr client.
   - Its Slurm hold job is read from the node's `enter` prefix (`--jobid=<n>` or `--jobid <n>`).
   - This keeps the registry schema owned by `node-access`/`cluster-dashboard` unchanged, and a single file still describes a node. Nodes whose machine is absent or not `connected` are not grantable.

3. **Allocation: greedy in arrival order.**
   - The pure `planner.ts` takes the queue, the nodes, the live snapshots, held GPUs and dirty GPUs, and returns grants. Every queued ticket that fits now is granted, in `requested_at` order. A large ticket can therefore be overtaken by smaller ones; raising a later ticket's position is future work.
   - Nodes are tried in id order. Within a node, the lowest-index grantable GPUs are taken.
   - Whole-node requests, and every request on `allocation: node` nodes, need all allocatable GPUs.
   - "Idle" means no compute process and less than 1 GiB used.
   - Snapshots run `PROBE_LINE` through `hc exec` on the node's machine.

4. **Launch template from the broker; execution by the caller.**
   - The broker returns, per ticket, the machine name and two prefixes:
     - `exec`: `env CUDA_VISIBLE_DEVICES=… MEMON_TICKET=…`;
     - `run`: the same env, followed on Slurm nodes by the node's `enter` srun arguments with `-J memon-task-<id>` replacing any job name.
   - The CLI appends `bash -c <line>` and drives `hc` itself, so `attach` keeps a local TTY and long `logs`/`wait` calls hold no server request open. The broker uses the same template for a start command, as task `main`.
   - Terminal names are `<ticket>-<task>`, lower-case, ≤ 32 characters, labelled `ticket=<id>`.

5. **Reclaim order and safety.**
   - Steps are listed with `scontrol show step <hold>` (`squeue -s` omits overlap steps on some clusters). An id is cancelled only if it matches `^<hold>\.\d+$` and its name is exactly `memon-task-<id>`.
   - Then labelled terminals are killed and removed, and the GPUs are re-snapshotted. Busy GPUs become dirty and are re-checked every tick.
   - Failures during reclaim keep the ticket in place with an error and are retried on the next tick. The ticket never ends silently while its processes might still run.

6. **CLI ↔ central.**
   - The CLI uses `$MEMON_CENTRAL_URL` (default `http://localhost:3737`) and operator credentials from `$MEMON_CENTRAL_AUTH` (`user:password`) or the 0600 file `~/.config/memon/central-auth`.
   - All `memon ticket` paths are ledger class `host`.
   - `memon ticket exec` passes the remote exit status through like `memon ssh`. When the changes are archived, memon-cli's exit-code exception should list both commands.

7. **Statuses and times.** Ticket states are `QUEUED`, `GRANTED`, `RELEASED`, `EXPIRED` and `FAILED`. Dirty is per GPU, not a ticket state. All stored times use `formatIsoLocal`, and comparisons use epoch milliseconds.

8. **Dashboard feed.**
   - `lib/server/cluster/tasks.ts` implements the cluster-dashboard `listTasks()` source. It maps tickets to `ClusterTaskDto`, extended with status, Project, times and tasks; ticket tasks are read from herdr terminal names `t<NNNN>-<task>`, cached for 15 s.
   - Visibility is decided per request: the super admin and owner Basic auth see every ticket. An admin sees full details only for Projects granted to them (looked up in the account store). Others' granted tickets are reduced to anonymous `occupied` bars, and their other tickets are omitted.
   - While tickets run, the timeline horizon covers their ends, plus a lead-in before now so the elapsed part is visible; node expiries past it clamp to the edge. Under 2 days, ticks are hours.
   - The store pre-creates its database file with mode 0600, so SQLite gives `-wal`/`-shm` the same mode, and existing files are re-chmodded on open.

9. **Supersedes `run-scheduler`.** A queued ticket with a start command is the background task that change designed. Its per-project CLI daemon, command files and preemption are not adopted. The owner decides when to archive or abandon it.

## Risks / Trade-offs

- [Advisory isolation: a task may touch other GPUs] → It is detected as unticketed use or dirty GPUs and never granted while busy. `srun --gres` isolation was rejected because overlap placement ignores real GPU usage.
- [Greedy order can starve large requests] → Owner-confirmed for v1. An explicit priority or reservation is future work.
- [The central herdr client is a single path to every node] → Its tasks survive client restarts. Reclaim retries until the node answers. Expiry while a node is unreachable leaves the ticket in reclaim-pending, never `EXPIRED` with live processes.
- [The broker and the CLI disagree on the template after upgrades] → The template is always served by the broker; the CLI never builds it.

## Migration Plan

Additive. The new SQLite file is created on first use. Rollback: stop using `memon ticket`. The store can be deleted when no ticket is `GRANTED`.

## Owner-confirmed decisions

- Ticket durations are bounded to 1 minute – 30 days.
- Allocation is greedy: whatever fits now is granted first ("ticket按照能放下就先放来"), so a large request may be overtaken by smaller ones.
