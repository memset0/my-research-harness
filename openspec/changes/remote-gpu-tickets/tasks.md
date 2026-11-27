# Tasks

## 1. Admin reach on every Project

- [ ] 1.1 Make the admin branch of identity resolution grant owner reach on every configured Project, drop admin Project grants in the account store on open, retire `/api/admin/project-admins` and its UI, and list every Project in `/api/project-access` for admins; verify with updated `identity-accounts.test.ts`, `capabilities.test.ts`, `account-store.test.ts` and the project-access route test
- [ ] 1.2 Update the `user-accounts` behavior in admin copy and help text; verify the Access control page renders for an admin without the removed Project-admin card (rendered check)

## 2. API tokens

- [ ] 2.1 Add the `api_tokens` table (hashed values, prefix, expiry, last use) with create/list/revoke, revocation on level change, disable and delete; verify with `account-store.test.ts` cases
- [ ] 2.2 Resolve `Authorization: Bearer` in `identity.ts` (pages, API, WebSocket upgrade) with no fallback on failure, rate limiting and throttled last-use writes; verify with identity and middleware tests (valid, revoked, expired, disabled account, level change)
- [ ] 2.3 Add `/api/tokens` (own tokens for every signed-in non-guest account, any account's for the super admin) and an API token card on the Access control page using stock shadcn components; verify with route tests and a rendered check that the value is shown once
- [ ] 2.4 Add the CLI central client (credential order: env token, `central.json`, legacy Basic), `memon login`/`logout` with a 0600 file, and register them in the command surface and ledger classes; verify with CLI tests (stdin login, rejected token writes nothing, mode 0600, no credential in output) and `command-surface.test.ts`

## 3. Ticket ownership and central execution

- [ ] 3.1 Record `owner_account_id` on requests, enforce owner-only actions with super-admin `force` (`409 OWNER_MISMATCH` without it, `404` for others), show the owner in the ticket DTO and dashboard Tasks tab; verify with broker, route and task-view tests
- [ ] 3.2 Add broker execution methods and routes: streamed `exec` (ndjson, stdin body, 600 s cap), task start/list, logs (with follow), wait, kill, all limited to the ticket's terminals and refused unless `GRANTED`; verify with broker tests against the fake herdr and route tests
- [ ] 3.3 Add the `attach` WebSocket in the custom server's upgrade path, authenticated through the shared identity function and bound to one ticket terminal (resize frames); verify with an upgrade test (owner, other admin, released ticket)
- [ ] 3.4 Rewire every `memon ticket` subcommand to the central API (no local `hc`), add `--force` on release and execution commands, and keep exit codes; verify with `ticket.test.ts` using a mocked central
- [ ] 3.5 Live check from a machine without herdr/SSH tooling (or with them hidden from `PATH`): login with a token, request on a Slurm-held node, `exec nvidia-smi -L`, `run` + `logs`, `attach`, release; record the result in LOCAL.md

## 4. Project clusters and sync

- [ ] 4.1 Add `gpu_clusters` to the central Project entry schema in core with validation (absolute root, non-empty map, safe cluster names); verify with config schema tests
- [ ] 4.2 Refuse ticket requests for Projects without `gpu_clusters` and restrict planning to their clusters' nodes; verify with planner and broker tests (other-cluster node stays unused)
- [ ] 4.3 Pull on grant (cloning a missing checkout from the Project's `origin`) with `sync_state`/commit/output columns, hold the start command on `PULL_FAILED`, start it once on success, report it through `show`/`wait`/API/dashboard, and add `memon ticket sync [--no-start]`; verify with broker tests for success, failure-then-sync and no double start, plus CLI tests
- [ ] 4.4 Push on end: after reclaim, stage only Run dirs whose `resources` list the ticket, report changed Run dirs without `resources` as unrecorded, commit, push with up to three pull-retries, store `push_state`, and fast-forward central's checkout for `host: central` Projects; verify with a broker test that drives the script against a temporary bare remote plus two clones (other Run and source edits stay uncommitted)
- [ ] 4.5 Add the optional `resources` list to the Run schema, add `MEMON_CLUSTER`/`MEMON_NODE` to the ticket environment, and make `memon run create`/`update` append the current ticket's entry (no `gpus` for whole-node tickets) once; verify with core schema tests, launch-template tests and run CLI tests (per-GPU, whole-node, resumed under a second ticket)
- [ ] 4.6 Update the bundled skills' ticket section (remote login, sync states, `ticket sync`, the duty to record each Run's cluster, resources and ticket, raw outputs staying on the cluster) and the CLI help; verify with the skills build check
- [ ] 4.7 Live check on a Slurm-held node with the central-hosted Project configured: grant pulls, a Run created in the task is pushed on release and appears in central's checkout, an induced pull failure holds the start command until `ticket sync`; record the result in LOCAL.md

## Workflow follow-up

- Archive after `user-accounts-admin` and `gpu-tickets` are archived, because the `user-accounts` delta modifies requirements those changes introduce.
