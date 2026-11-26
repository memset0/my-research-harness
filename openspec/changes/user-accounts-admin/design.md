# Design

## Context

See proposal.md for motivation. Today `resolveIdentity` (lib/server/auth/identity.ts) yields one of three roles. A route class decides who may pass: `owner` passes everything, `viewer` passes only `read` routes in its share scope, `anon` passes only `anon` routes and public documents. Middleware forwards the outcome to handlers as `x-memon-*` request headers. The whole Web surface already gates on that `owner`/`viewer` split, so the least risky design maps every account onto it instead of rewriting each route.

## Goals / Non-Goals

**Goals:** four account levels with capability checks; no lockout of the existing owner; read-only, grant-scoped users; one admin area with a navbar; route-level denial for cluster and GPU-pool surfaces.

**Non-Goals:**
- writable access for `user` accounts;
- per-account UI preferences (stored accounts share the instance preference row, as before);
- Basic auth for stored accounts;
- self-service password change;
- audit log;
- SSO.

## Decisions

1. **Level → route role mapping.**
   - `super_admin` resolves to route role `owner` and keeps today's full reach.
   - `admin`, `user` and `guest` resolve to route role `viewer`, so every existing viewer rule applies unchanged: scope-checked, document grants, `global` routes refused.
   - Scopes come from grants: an admin's Project-admin grants and a user's Project grants become `scopeProjectRefs`, and a user's document grants become `scopeDocuments`. A guest has no grants. Each scope is merged with the account's share cookie.
   - **Scoped owner reach for admins.** An admin's granted Projects are also its `ownerProjectRefs`. A request that selects exactly one of them is authorized as `owner`, reads and writes alike, in two places:
     - the central gateway, for host-qualified Backend routes, where every Project write lands; the target is the route's selected Host+Project, or the service's;
     - middleware, for pages and reads whose rule resolves that Project, so the page renders with owner controls.
   - Routes that name no single Project (`global`, `multi`, unresolved) are never elevated. Instance actions therefore stay super-admin-only. Each Project's `read_only`/`allowed_edits` is enforced by the services exactly as for the owner.
   - Alternative: add new route roles. Rejected, because every route, list filter and test keyed on `role === 'owner'` would need re-auditing; per-request elevation reuses them unchanged.

2. **Mutating and shell routes are refused for viewer-role sessions.** A share viewer never reached them before, because mode 3 was evaluated only on read routes. A user session resolves in mode 1, so middleware now denies `viewer` identities on non-`read` classes with `403` before any scope check.

3. **Capability gating by path, in one table.** `lib/server/auth/capabilities.ts` holds the level→capability matrix and an ordered path table:
   - `/manage/users` and `/api/admin/*` need `manage_accounts`;
   - `/manage/projects`, `/api/project-access`, `/manage/shares` and `/api/shares*` need `manage_project_grants`;
   - `/manage/file-access` and `/api/file-access*` need `configure_instance`;
   - `/manage/clusters*`, `/api/clusters*`, `/manage/gpu-pool*` and `/api/gpu-pool*` need `access_clusters`;
   - the rest of `/manage*` needs any of the latter three.

   Middleware applies the table after authentication. A missing capability is a `403`; a held capability admits the request regardless of route role, because an admin is a viewer that must still reach cluster and grant APIs. Handlers re-check with `requestCan(req, capability)` and scope the data, for example to an admin's granted Projects. The concurrent `cluster-dashboard` routes are therefore gated without editing them. Their handler's owner-role check must switch to `requestCan`.

4. **Account context header.** Middleware always sets `x-memon-account`, a base64url JSON `{id, username, level}` or empty. It overwrites any browser-supplied value, matching the existing identity headers. Server components and handlers read it through `request-context.ts`. The session bootstrap exposes `{username, level, capabilities}` to client components, which use it only for navigation.

5. **Store.** `lib/server/account-store.ts` uses `sqlite3`, like the UI preference store, with three tables:
   - `accounts(id, username, level, password_hash, disabled, created_at, updated_at)`;
   - `account_grants(account_id, host, project, kind, doc_id)` for user read grants;
   - `project_admins(host, project, account_id)` for many-to-many Project grants to admins.
   - Account #1 is a synthetic row kept in sync with `config.yml` `auth.username`, with a NULL hash. Its password always comes from `config.yml`, so the file-edit password flow stays authoritative.
   - Middleware looks accounts up per request (one indexed read), so disabling an account or changing its level takes effect immediately.

6. **Session cookie v2** is `{v: 2, uid, iat, exp}`. v1 `{role: owner}` cookies remain valid as account #1 until they roll over, so there is no lockout.

7. **Passwords:** Node `scrypt` (N=16384, r=8, p=1, 16-byte salt, 64-byte key), encoded `scrypt$16384$8$1$<salt>$<hash>`. They are verified only at login, which is already rate-limited.

8. **Admin area is `/manage`.** It is the existing management layout, so File access "moves in" by joining the navbar and leaving the sidebar footer. Its URL `/manage/file-access` stays and needs no redirect. A cluster section can be added by appending one entry to `ADMIN_SECTIONS` with `access_clusters`; this change does not move `/manage/clusters`.

## Assumptions the owner should confirm

- Users and guests cannot create share links. Admins create them only on their granted Projects, from the project page's share dialog, which now opens for admins.
- Share label and expiry cannot be edited after creation: the share API has no edit operation, so the Shares section offers revoke only.
- Shares made before creator tracking show the super admin as creator with a Legacy mark. `shares.json` is not rewritten.

- (Confirmed by the owner) An `admin` edits the Projects granted to it like the owner, within each Project's `read_only`/`allowed_edits`.
- The client session's role is taken when a page is loaded. After a client-side navigation between a granted Project and other pages, controls may show the previous role until the next full load; the server enforces access on every request.
- Admins grant users by exact username, with no directory or autocomplete. A grant to an unknown, disabled or non-user name fails with one identical error. An admin sees only the usernames already granted on its own Projects.
- `user` grants are read-only. `guest` holds no grants: its reach equals today's share links plus public pages.
- Only account #1 is `super_admin`; the API cannot create or promote another one.
- Stored accounts cannot use HTTP Basic, which remains for the `config.yml` super admin, so CLI and curl automation, including the Project-admin grant API, are unchanged.
- "Cluster config" is not a section yet; there is no cluster configuration UI to move. A future section joins `ADMIN_SECTIONS` with `configure_instance`.

## Risks / Trade-offs

- [Native sqlite3 loaded from Node middleware] → `sqlite3` is already in `serverExternalPackages`; verified in a production build before release.
- [Per-request store read] → A single primary-key lookup on a local WAL database, done only when the session is a v2 cookie.
- [Shared preference row for stored owner-role accounts] → Documented non-goal; it can be keyed per account later.

## Migration Plan

- Deploy as usual. The store file is created on first use, and account #1 is derived from `config.yml`.
- Rollback to the previous release: v2 cookies are rejected (users log in again), v1 and Basic keep working, and the store file is ignored.
