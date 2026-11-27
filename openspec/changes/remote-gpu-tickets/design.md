# Design

## Context

- Ticket state lives only in central's `memon-gpu-pool.sqlite3`. The broker in `lib/server/gpu-pool/` plans grants and reclaims tasks through central's own herdr client (`herdr.ts`, `runHc`), which reaches each node's memon herdr core through per-node via scripts.
- The CLI (`packages/cli/src/commands/ticket.ts`) calls `/api/gpu-pool/tickets` with Basic credentials for request/list/show/release, but runs `exec`/`run`/`ps`/`logs`/`attach` itself through a local `hc` binary using a launch template from central. That only works on central.
- Identity is resolved in the Node-runtime middleware (`middleware.ts` → `lib/server/auth/identity.ts`) and in the custom server's WebSocket upgrade path. Accounts live in `memon-accounts.sqlite3` (`lib/server/account-store.ts`). Admin reach today comes from `ownerProjectRefs`, the Projects granted to the admin.
- Central is reachable from other devices only through its existing public HTTPS URL (reverse proxy to loopback).
- Nodes reach Git remotes themselves. Cluster checkouts are only touched through the node's herdr machine.

## Goals / Non-Goals

**Goals:**
- One authenticated HTTPS surface for every ticket operation, from any device.
- A holder's commands run only inside their ticket's environment and step.
- Sync is automatic, but a failure is handed to the holder instead of being resolved by guessing.

**Non-Goals:**
- No raw herdr protocol forwarding, port forwarding or SSH access for remote devices.
- No per-Project scoping of tokens (the owner decided tokens carry the account's reach).
- No automatic conflict resolution: memon only ever stages Run directories and never edits other files.
- No Ray integration and no relay-specific transport work; nodes without a memon herdr machine stay ungrantable as today.

## Decisions

1. **Tokens are random bearer secrets stored as SHA-256 hashes in the account store.**
   - A new `api_tokens` table holds `id, account_id, name, hash, prefix, created_at, expires_at, last_used_at`. Lookup is by hash. Values have 32+ characters from `crypto.randomBytes`, so a fast hash is sufficient.
   - Alternatives: bcrypt/argon2 (needless with high-entropy secrets, and slow on every request) or signed JWTs (not revocable without a store anyway).
   - `prefix` (the first 8 characters) lets the UI and audit identify a token without its value.

2. **Bearer resolves in `identity.ts` before cookies and Basic, and never falls back.**
   - An `Authorization: Bearer` header switches resolution to the token path. It yields the same `ResolvedIdentity` a session for that account would, so every existing gate applies unchanged.
   - A bad token answers `401` rather than trying a cookie, so a stale token is never silently replaced by browser state.
   - The WebSocket upgrade path uses the same function.

3. **Admins become owner-reach on every Project by changing the admin branch of identity resolution, not the level table.**
   - `isOwnerLevel` stays super-admin-only for instance-level gates.
   - The admin path is changed so that `ownerProjectRefs` covers every configured Project. The account store drops the `project_admins` table on open, and `/api/admin/project-admins` and its UI are removed.
   - This keeps `configure_instance`/`manage_accounts` checks untouched.

4. **The broker owns execution, and the CLI becomes a thin HTTP client.**
   - New routes call broker methods that wrap the existing `launchTemplate` with `runHc`.
   - `exec` streams stdout/stderr as a chunked `application/x-ndjson` response (`{stream, data(base64)}` lines, then `{exit}`). Stdin is the request body, which is bounded by the 600 s timeout and a size cap.
   - `attach` is a WebSocket at `/api/gpu-pool/tickets/<id>/attach?task=…` that pipes central's `hc attach` PTY. Resize messages are JSON frames.
   - Alternative: hand remote CLIs a scoped herdr connection. Rejected because a herdr connection reaches every terminal on the node, and the protocol is not ticket-aware.

5. **Ownership is a column, and `force` is explicit.**
   - `tickets.owner_account_id` (null for old rows) plus `forced_by` on forced actions.
   - Non-owners get `404`, as for nonexistent ids, so ids are not confirmed.
   - The super admin gets `409 OWNER_MISMATCH` without `force`, which makes accidental cross-ticket actions (the earlier incident) fail loudly.

6. **Cluster checkouts are central `config.yml` deployment facts.**
   - `gpu_clusters` sits beside the existing `execution`/`access` keys in the Project entry schema in core, which keeps cluster names and paths out of research repositories.
   - The planner filters candidate nodes by `node.cluster ∈ keys(project.gpu_clusters)`.

7. **Sync runs as broker steps outside the ticket's GPU environment.**
   - On grant the broker sets `sync_state = PULLING` and runs `git -C <root> pull --no-rebase` with `hc exec` on the granted node, without `CUDA_VISIBLE_DEVICES` and outside the task step. It stores `READY` with the resulting commit, or `PULL_FAILED` with the truncated output.
   - Only on `READY` does it start the stored start command as task `main`, and it records `run_started_at` so the command starts at most once.
   - `ticket sync` repeats the same step, and `wait` returns early on `PULL_FAILED`.
   - Alternative: fail the ticket on pull failure. Rejected by the owner because the holder should repair the checkout and keep the GPUs.

8. **Push selects Run directories by `run.json`, never by `git status`.**
   - After reclaim, the broker runs one shell script through `hc exec` on the node that does the following:
     - finds `run.json` files under the Project's Run roots (`run_dirs` from the checkout's `.memon/project.yml`, default `logs/`);
     - keeps those whose `resources` list an entry with this ticket;
     - reports changed Run directories without any `resources` as unrecorded;
     - runs `git add -- <kept dirs>` (which applies `.gitignore`);
     - commits with `chore(runs): record <ticket id>` if anything is staged;
     - pushes, retrying `pull --no-rebase` and push up to three times.
   - The script prints a JSON result that the broker stores (`push_state`, commit, unrecorded dirs, output).
   - Selecting by `git status` was rejected because it would commit Runs of other tickets sharing the checkout.
   - The Run merge driver from the central-hosted Project layout handles concurrent `run.json` edits.

8a. **Run resources are an additive `run.json` field, not a convention change.**
   - `resources: [{ticket, cluster, node, gpus?}]` is optional, and `RunMetadataSchema` already passes unknown keys through, so older CLIs and central read such Runs unchanged. This ships as a CLI/skills MINOR without an FS bump.
   - A list (rather than one `scheduler` value) covers both a ticket that serves several Runs and a Run resumed under later tickets.
   - Whole-node grants omit `gpus` so the record does not depend on the node's GPU count.
   - The ticket environment gains `MEMON_CLUSTER`, `MEMON_NODE` (node id from the registry) and, for whole-node tickets, `MEMON_WHOLE_NODE=1`, next to `MEMON_TICKET`/`CUDA_VISIBLE_DEVICES`, so the CLI can fill the entry without asking central.

8b. **Missing cluster checkouts are cloned from the Project's `origin`.** The URL is read from the Project's own checkout (`git remote get-url origin`) at grant time and the clone runs on the node like the pull. A clone failure is reported as `PULL_FAILED`, with the same hold and `ticket sync` path.

9. **Central's own checkout is fast-forwarded only for `host: central` Projects, with `git pull --ff-only`.** A failure is recorded on the ticket and never forced, because central's checkout may hold an agent's work in progress.

10. **The CLI resolves credentials in a fixed order with one module.** `lib/central-client.ts` replaces the ad-hoc `credentials()` and is shared by `ticket` and `login`. The legacy Basic path stays so existing central-local scripts keep working.

## Risks / Trade-offs

- [A leaked token grants its account's full reach] → tokens are shown once, can be revoked and expired, and show last use. The admin card surfaces stale tokens.
- [Admins can now write every Project] → accepted by the owner. `read_only`/`allowed_edits` still bound writes, and instance gates are unchanged.
- [A long `exec` stream through the public reverse proxy may be cut by proxy timeouts] → `exec` is capped at 600 s as today. Longer work uses `run` + `logs --follow`, which reconnects.
- [The pull runs as the cluster user and may prompt for credentials] → it runs with `GIT_TERMINAL_PROMPT=0` and `ssh -o BatchMode=yes`, so failures surface as `PULL_FAILED` instead of hanging.
- [Push at expiry happens after tasks are killed, so a Run may be recorded mid-write] → reclaim waits for task exit before staging. `run.json` writes are atomic replacements.
- [Owner-less legacy tickets] → all are `RELEASED`, so nothing operational is lost.

## Migration Plan

1. Deploy central. On open, the account store creates `api_tokens` and drops admin Project grants, and the ticket store adds the `owner_account_id`, sync and push columns.
2. Add `gpu_clusters` to the central `config.yml` entries of Projects that use the pool (a machine-local edit). Until then, requests for those Projects are refused with a message naming the missing key.
3. Release the CLI as a MINOR version. Agents create a token in the admin area and run `memon login <url>`. Central-local scripts keep working through the legacy Basic credentials.
4. Rollback: redeploy the previous release. The extra columns and table are ignored by older code. The dropped admin grants are not restored, which only narrows admins back to no Projects until grants are re-added.
