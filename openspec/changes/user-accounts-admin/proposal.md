# Proposal

## Why

memon has exactly one human identity: the owner whose plaintext credentials live in central `config.yml`, plus anonymous share-link viewers. The owner now wants several people on one central instance, at different trust levels. Cluster access and the GPU pool must stay with a few administrators. Collaborators should see only the Projects or Reports/Wikis they are given. Instance configuration (users, clusters, file access) stays with the owner. The admin tools also need one dedicated place instead of loose sidebar links.

## What Changes

- **Accounts with four levels.** `super_admin`, `admin`, `user` and `guest` accounts are stored central-side in an embedded SQLite file next to `config.yml`.
  - The existing `config.yml` `auth` owner becomes account #1 and the single super admin. Its credentials stay in `config.yml`, so existing sessions, Basic auth and automation keep working, with no lockout.
  - Other accounts have scrypt-hashed passwords and log in through the existing login page.
- **Capabilities, not ad-hoc role checks.**
  - `manage_accounts` and `configure_instance` (accounts, Project grants to admins, file access and other instance settings): super admin only.
  - `access_clusters` (cluster monitoring and the GPU pool): admin and above.
  - `manage_project_grants`: the super admin on every Project; an admin only on the Projects the super admin granted to it.
  - Only the super admin keeps today's full owner reach.
  - Admins, users and guests are read-only scoped identities. An admin sees its granted Projects, a user its granted Projects/Reports/Wikis, and a guest only what share links and public pages allow.
  - All of these are enforced on routes, not only hidden in navigation.
- **Project grants to admins (super admin, scriptable).** `/api/admin/project-admins` accepts the owner's Basic auth, so the main agent or a script can grant and revoke Projects to admins. Projects start with none.
- **Admins manage read grants on their Projects.** `/api/project-access` lets an admin grant users read access to a granted Project or to one Report/Wiki by exact username. There is no account directory, and probing for names reveals nothing.
- **Admin area.**
  - The `/manage` area becomes the admin interface, with a top navbar whose sections follow the viewer's capabilities.
  - It is entered from the sidebar's bottom-left account entry, which shows the signed-in account.
  - File access moves into this navbar and leaves the sidebar footer. Its URL is unchanged.
  - A new **Users** section (super admin only) lists, creates, edits, disables and resets accounts and edits a user's grants.
  - A new **Projects** section shows an admin its granted Projects and their read grants. For the super admin it covers every Project and also assigns admins.
  - A new **Shares** section lists share links with their creator. The super admin sees all of them; an admin sees only its own, created on its granted Projects. Both can revoke.
- **Session cookie v2** carries the account id. A v1 owner cookie still means the super admin until it rolls over.

## Capabilities

### New Capabilities
- `user-accounts`: the account store, levels and capabilities, login of stored accounts, per-user grants, route gating by capability, the admin area layout and navbar, and the Users section.

### Modified Capabilities
- `project-share`: share records store their creator; `/api/shares` admits admins on their granted Projects and scopes listing and revocation to their own shares.
- `auth-system`: the single-user credential requirement now describes the `config.yml` owner as super admin account #1 alongside stored accounts.
- `file-access-settings`: the settings panel is super-admin-only and lives in the admin area.

## Impact

- **Web (central only):**
  - `lib/server/auth/*`: identity, cookies, capability gating and an account store;
  - `middleware.ts`;
  - login route;
  - new `/api/admin/accounts*`, `/api/admin/project-admins` and `/api/project-access` routes;
  - `app/manage/*` layout, navbar, index, Users and Projects pages;
  - sidebar footer account entry;
  - session bootstrap fields.
- **Release:** central-only → PATCH. No CLI, skills or filesystem change. The release itself is sequenced by the coordinator.
- **Data:** a new untracked SQLite file beside the instance `config.yml`; `config.yml` is not rewritten.
- **Coordination:** the concurrent `cluster-dashboard` change's `/manage/clusters` and `/api/clusters` are gated by `access_clusters` through the shared path rule added here; its page is not moved. Its handler's `role === 'owner'` check must become `requestCan(req, 'access_clusters')`, because admins resolve to the viewer route role.
