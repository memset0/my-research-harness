# Tasks

## 1. Broker core

- [x] 1.1 Implement `apps/web/lib/server/gpu-pool/store.ts` (tickets, dirty GPUs, sequential `T<NNNN>` ids, offset timestamps) and verify create/transition/dirty round trips on a temp database through `broker.test.ts`
- [x] 1.2 Implement the pure `planner.ts` (grantable GPUs, allocation modes, type match, expiry fit, unsatisfiable detection, greedy order) and verify `planner.test.ts` covers every grant scenario in the spec
- [x] 1.3 Implement `herdr.ts` (hc wrapper: machines, exec, run, list by label, kill, rm; hold-job and step-listing parsers; launch templates) and verify `herdr.test.ts` covers the template, hold parsing and strict step filtering
- [x] 1.4 Implement `broker.ts` (request validation, tick loop with backoff on a `globalThis` singleton, grant + start command, expiry/release reclaim, dirty recheck, unticketed-use report) and verify `broker.test.ts` with fake herdr/clock covers grant, start command, release reclaim, dirty marking and the never-bare-job-id guard

## 2. API and start-up

- [x] 2.1 Add `/api/gpu-pool/tickets` (GET list + pool status, POST request), `/api/gpu-pool/tickets/[id]` (GET) and `/api/gpu-pool/tickets/[id]/release` (POST) with the cluster guard, route classes and API manifest entries, and verify the route tests (gated denial, 404, 409, 201) plus `api-route-manifest.test.ts`
- [x] 2.2 Start the broker from `server.ts`, add the store to AGENTS.md's SQLite allow-list, and verify typecheck and the layering test

## 3. CLI

- [x] 3.1 Add `memon ticket request|list|show|release|exec|run|ps|logs|wait|kill|attach` with ledger classes, the central client (URL plus credentials from env/file) and structured errors, and verify `ticket.test.ts` (mocked central and hc) plus `command-surface.test.ts`

## 4. Verification

- [x] 4.1 Run root typecheck, Biome on changed files and the change test list, and record results
- [x] 4.2 On a real Slurm-held node with a connected memon herdr machine, verify grant → `run` with a `setsid` child → central herdr client restart (the task survives) → release (the step is cancelled, no process left, GPUs idle) without touching the hold job or the `herdr-core` step

## 5. Dashboard follow-up

- [x] 5.1 Implement the cluster-dashboard `listTasks()` source from the ticket store and herdr terminal names, filtered per viewer (super admin all; admin granted Projects in full, others anonymous), and verify `task-view.test.ts` and the clusters route test
- [x] 5.2 Draw granted tickets as GPU-lane bars with elapsed shading on a horizon with a lead-in before now, list tickets in the Tasks tab (ended in the last 24 h collapsed) with stock shadcn components, and verify `cluster-timeline.test.ts` plus a rendered preview check
- [x] 5.3 Create the store and its WAL/SHM files with mode 0600, and verify the store mode test in `broker.test.ts`
