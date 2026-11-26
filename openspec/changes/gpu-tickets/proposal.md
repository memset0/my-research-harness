# Proposal

## Why

Research agents now reach registered GPU nodes (`memon ssh`), but nothing decides who may use which GPU for how long. Agents pick cards by hand, can collide, and nothing reclaims a card when work overruns. memon should broker GPUs centrally: an agent requests GPUs, waits in a queue, receives a ticket naming the exact node and GPUs, uses them freely, and memon reclaims everything when the ticket ends.

## What Changes

- **Central ticket broker.** It runs inside the memon-central process and keeps state in a new central SQLite store (`memon-gpu-pool.sqlite3` beside `config.yml`).
  - A request names the project, an optional GPU type, a GPU count or a whole node, a duration, an optional label and an optional command to start when granted.
  - Requests queue in arrival order. A polling loop with backoff (no watchers) grants whatever fits now, choosing GPUs by a live `nvidia-smi` snapshot: allocatable per the node registry, idle, not held by another ticket, not marked dirty.
  - A ticket never outlives its node's `available_until`.
- **Ticket lifecycle**, with uppercase states `QUEUED` → `GRANTED` → `RELEASED` | `EXPIRED`, and `FAILED` for a request that can never be satisfied or a launch that failed. Timestamps carry the writer's local offset.
- **Free use after grant.**
  - Short commands (`memon ticket exec`).
  - Any number of long tasks (`memon ticket run`). Each runs in a terminal of the node's memon-owned herdr core, labelled with the ticket. On Slurm-held nodes it also runs in its own `srun --overlap` step named for the ticket, so it survives disconnects and can be reclaimed completely.
  - Listing, logs, waiting, killing and interactive attach.
  - Every command sees `CUDA_VISIBLE_DEVICES` set to the granted GPUs and `MEMON_TICKET`.
- **Reclaim.** On release or expiry, memon:
  - cancels only the ticket's task steps (strictly `<job>.<step>`; never the hold job);
  - ends and removes the ticket's terminals;
  - re-checks the GPUs. GPUs still in use are marked dirty and withheld until they are clean.
  - Compute processes on pool GPUs that no ticket holds are reported.
- **Dashboard.** The cluster overview lists tickets and draws granted ones on their GPU lanes, filtered to the Projects the viewer may see.
- **API and CLI.**
  - Owner/admin-gated `/api/gpu-pool/tickets…` routes, under the existing `access_clusters` path gate.
  - `memon ticket request|list|show|release|exec|run|ps|logs|wait|kill|attach`, which talk to central over loopback HTTP with operator credentials and to the node through memon's own herdr client.
- **Supersedes `run-scheduler`.** Its scheduling goals (queue, background tasks, reclaim) are covered by tickets: a request with a start command is a queued background task. `run-scheduler` stays unarchived until the owner decides.
- Not in this change:
  - a temporary Ray cluster per ticket (the next change);
  - priorities and preemption;
  - nodes without a connected memon herdr machine, including M2 until the relay shell service is deployed;

## Capabilities

### New Capabilities
- `gpu-tickets`: ticket requests, queueing and FIFO allocation, the lifecycle and expiry, task launch and containment on herdr terminals and Slurm steps, reclaim and dirty-GPU handling, the gated API and the `memon ticket` command family.

### Modified Capabilities

## Impact

- **Web (central):** a new `lib/server/gpu-pool/` (store, planner, herdr client, broker), `app/api/gpu-pool/tickets/**` routes, minimal entries in the route class and API manifest tables, and broker start-up from `server.ts`.
- **CLI:** the `memon ticket` command family and its ledger classes.
- **Docs:** AGENTS.md's SQLite allow-list gains `apps/web/lib/server/gpu-pool/store.ts`.
- **Deployment data:**
  - nodes stay in the untracked `~/.config/memon/nodes.yml`;
  - each node's herdr machine is named after the node id in memon's own herdr client (`$MEMON_HC`, default `~/.local/share/memon/herdr-core/bin/hc`);
  - a Slurm hold is read from the node's `enter` prefix (`--jobid`).
- **Release:** central + CLI (MINOR); sequenced by the operator together with the concurrent dashboard and accounts changes.
