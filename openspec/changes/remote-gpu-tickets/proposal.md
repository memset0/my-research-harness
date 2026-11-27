# Proposal

## Why

GPU tickets only work on the central node today. The CLI authenticates with the super admin's password, and `exec`/`run`/`logs`/`attach` drive central's own herdr client, so an agent on another machine cannot use the pool. The pool also has no notion of who holds a ticket, which let one agent release another's work. Experiments on clusters also need their checkout pulled before work starts and their Run records pushed afterwards, and agents currently do this by hand.

## What Changes

- **API tokens.** Each account can hold named API tokens. A token is bound to its account and carries exactly that account's reach. The CLI sends it as `Authorization: Bearer` to a central URL it was given with `memon login <url>`. Tokens are shown once, stored hashed, revocable and optionally expiring.
- **Admins reach every Project.** GPU nodes have no isolation between Projects, so per-Project admin grants protect nothing. `admin` accounts get owner reach on every configured Project. Super-admin-to-admin Project grants are retired. Admins still cannot see other accounts, and their Project read-grant management now covers every Project. **BREAKING** for the admin role's scope (it widens).
- **Ticket ownership.** A ticket records the account that requested it. Only that account can act on it; the super admin needs an explicit `force`.
- **Central-proxied ticket execution.** Central runs `exec` (streamed), `run`, `ps`, `logs`, `wait`, `kill` and `attach` (WebSocket) with its own herdr client, scoped to the ticket and its granted GPUs. A remote CLI needs HTTPS only, with no herdr client, SSH or relay. The CLI on central uses the same API. Remote callers never get raw herdr core access.
- **Project cluster checkouts.** A central `config.yml` Project entry may declare `gpu_clusters: {<cluster>: {root: <absolute checkout path>}}`. A ticket may be requested only for a configured Project that declares at least one cluster, and it is granted only on nodes of those clusters.
- **Sync on grant.** Before anything runs on a granted ticket, central runs `git pull --no-rebase` in the Project's checkout on that cluster. On failure the ticket stays `GRANTED`, its stored start command is held, and the failure (with Git's output) is reported to the holder through `show`/`wait`, the API and the dashboard. `memon ticket sync <id>` re-runs the pull and then starts the held command once; `--no-start` only pulls.
- **Push on end.** On release or expiry, after tasks are reclaimed, central commits and pushes only the Run directories whose `run.json` records this ticket (`scheduler.system: memon-ticket`, `job_id: <ticket id>`). Nothing else is ever committed. A rejected push is retried after a pull. The result is recorded on the ticket. Central's own checkout of a central-hosted Project is then fast-forwarded.
- **Run records name their ticket.** `memon run create`/`update` inside a ticket task (`MEMON_TICKET` set) record the ticket as the Run's scheduler identity unless `--job-id` is given.

## Capabilities

### New Capabilities
- `api-tokens`: per-account bearer tokens, their lifecycle, and CLI login/credential lookup.
- `ticket-gateway`: ticket ownership and central-proxied, ticket-scoped execution on granted GPUs.
- `ticket-project-sync`: Project cluster checkout declarations, grant restriction to those clusters, pull on grant with held start commands, and ticket-scoped Run push on end.

### Modified Capabilities
- `user-accounts`: admins get owner reach on every Project, Project-to-admin grants are removed, and admins manage user read grants on every Project. The capability is still defined by the unarchived `user-accounts-admin` change; this delta applies after it.

## Impact

- Web: `lib/server/auth/*` (Bearer resolution in identity/middleware, admin reach), `lib/server/account-store.ts` (token table, removal of admin Project grants), `/api/admin/project-admins` (retired), `/api/project-access`, new `/api/tokens`, ticket routes under `/api/gpu-pool/tickets/[id]/*` (exec stream, tasks, logs, kill, attach WebSocket in `server.ts`), `lib/server/gpu-pool/{store,broker,planner,herdr}.ts` (owner, sync state, cluster restriction, pull/push), and an API token card in the admin Access control page.
- Core: central config schema for `gpu_clusters`; a shared Run-dir selection helper for ticket Runs.
- CLI (MINOR): `memon login`/`logout`, Bearer credentials, `ticket sync`, and the ticket subcommands rewired to the central API. `run create/update` read `MEMON_TICKET`.
- Skills: the ticket usage section of the bundled skills (remote use, sync failures).
- Ops: central must be reachable from remote devices over its existing public HTTPS URL; no new listener. Existing tickets have no owner and stay readable to the super admin only.
