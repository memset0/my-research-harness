# Spec Delta

## Purpose

Let several people share one central memon instance at different trust levels: a super admin who configures the instance, admins who use the GPU clusters and control who reads the Projects granted to them, and users and guests whose reach is limited to what they are explicitly given.

## ADDED Requirements

### Requirement: Accounts are stored central-side with one of four levels
Central SHALL keep accounts in an embedded SQLite file next to the instance `config.yml`, never tracked. Each account SHALL have a numeric id, a unique username (`[A-Za-z0-9._-]{1,64}`), a level (`super_admin`, `admin`, `user` or `guest`), a disabled flag and creation time. Stored passwords SHALL be scrypt hashes with a per-account salt.

#### Scenario: Store file location
- **GIVEN** the instance config is `/srv/memon/config.yml`
- **WHEN** the server first needs an account
- **THEN** it creates `/srv/memon/memon-accounts.sqlite3` and does not modify `config.yml`

#### Scenario: Duplicate username
- **WHEN** an account named `alice` exists and another account named `alice` is created
- **THEN** creation fails with a conflict and the store is unchanged

### Requirement: The config.yml owner is the single super admin
Account #1 SHALL be the `config.yml` `auth` owner with level `super_admin`; its username SHALL follow `auth.username` and its password SHALL be verified against `auth.password`, never stored in the account store. Account #1's level, disabled flag and password SHALL NOT be changeable through the API, and no other account SHALL be given `super_admin`.

#### Scenario: Existing owner keeps working
- **GIVEN** an instance that predates accounts, with a valid v1 owner session cookie and `auth` in `config.yml`
- **WHEN** the owner opens any page, or calls an API with Basic credentials from `config.yml`
- **THEN** the request is authenticated as account #1 with level `super_admin`

#### Scenario: Super admin cannot be demoted
- **WHEN** a request tries to change account #1's level or disable it
- **THEN** it is refused with `400` and nothing changes

### Requirement: Stored accounts sign in through the login page
`POST /api/auth/login` SHALL authenticate `auth.username`/`auth.password` as account #1 and any other enabled stored account by scrypt verification, under the existing rate limit. On success it SHALL issue a session cookie naming the account. HTTP Basic SHALL remain limited to the `config.yml` credentials.

#### Scenario: Stored user logs in
- **GIVEN** an enabled `user` account `bob` with password `p@ss1234`
- **WHEN** `bob` posts the login form with that password
- **THEN** the response sets `memon-session` with a v2 payload naming bob's account id and redirects to `next`

#### Scenario: Disabled account
- **GIVEN** account `bob` is disabled
- **WHEN** `bob` logs in, or presents a session cookie issued before the account was disabled
- **THEN** login fails like a wrong password, and the existing cookie no longer authenticates

### Requirement: Capabilities derive from the level
The levels SHALL grant these capabilities, and route handlers and navigation SHALL check capabilities rather than raw levels:

| capability | super_admin | admin | user | guest |
|---|---|---|---|---|
| `manage_accounts` (accounts, Project grants to admins) | yes | no | no | no |
| `configure_instance` (file access and other instance settings) | yes | no | no | no |
| `access_clusters` (cluster monitoring, GPU pool) | yes | yes | no | no |
| `manage_project_grants` (user read grants) | all Projects | granted Projects only | no | no |
| Project reach | full owner reach, all Projects | read-only, granted Projects | read-only, granted Projects/documents | share links and public pages only |

#### Scenario: Admin lacks instance configuration
- **GIVEN** an `admin` session
- **WHEN** it requests the Users section or the file-access settings API
- **THEN** the response is `403` (page or API alike) and no configuration is read or written

### Requirement: Non-super-admin accounts are read-only scoped identities
An `admin`, `user` or `guest` session SHALL be evaluated like a share viewer. Only `read`-class routes SHALL pass, scoped as follows: an admin to the Projects granted to it, a user to its read grants, and a guest to nothing; each scope is merged with any valid `memon-shares` entries. Every other `mutating`, `shell` or `global` route SHALL be refused with `403`, except routes admitted by a held capability.

#### Scenario: User reaches a granted Project only
- **GIVEN** user `bob` with a Project grant for `{host: h1, project: project-a}`
- **WHEN** bob opens `/h1/project-a` and then `/h1/project-b`
- **THEN** the first page renders read-only and the second is refused with `403`

#### Scenario: Ungranted Project is invisible to an admin
- **GIVEN** admin `ada` granted `{h1, project-a}` only
- **WHEN** ada opens `/h1/project-b` or lists Projects
- **THEN** the page is refused with `403` and the list contains only `project-a`

#### Scenario: Scoped accounts cannot write
- **WHEN** a `user` or `admin` session sends a mutating request for a Project it can read
- **THEN** the response is `403` and nothing is written

#### Scenario: Account signs out
- **WHEN** an `admin`, `user` or `guest` session posts `/api/auth/logout`
- **THEN** the session cookie is cleared, although every other ungated write is refused

#### Scenario: Guest relies on share links
- **GIVEN** a `guest` session with no grants and a valid share cookie for `{h1, project-a}`
- **WHEN** it opens `/h1/project-a`
- **THEN** the page renders read-only as for a share viewer

### Requirement: The super admin grants Projects to admins
`/api/admin/project-admins` SHALL require `manage_accounts` and SHALL list, add (`POST {host, project, username}`) and remove (`DELETE`, same body) admin grants of configured Projects, many-to-many. It SHALL accept the `config.yml` owner's HTTP Basic credentials so scripts and agents can call it. A grant SHALL name an existing `admin` account. Changing an account away from `admin` SHALL remove its Project grants. Projects start with no admin grants.

#### Scenario: Scripted grant
- **WHEN** a script posts `{host: h1, project: project-a, username: ada}` with the owner's Basic credentials
- **THEN** ada can open `/h1/project-a` and manage its read grants on her next request

#### Scenario: Grant to a non-admin
- **WHEN** the super admin grants a Project to user `bob`
- **THEN** the request fails with `400` and nothing is stored

### Requirement: Admins manage user read grants on their granted Projects
`/api/project-access` SHALL require `manage_project_grants`. `GET` SHALL list the caller's manageable Projects (all for the super admin, else the admin's granted ones) with their user grants as usernames. `POST`/`DELETE {host, project, username, document?}` SHALL add or remove a read grant on a manageable Project by exact username; any other Project SHALL answer `404`.

#### Scenario: Super admin view lists admins
- **WHEN** the super admin requests `GET /api/project-access`
- **THEN** every configured Project is listed with its user grants and its admins

#### Scenario: Admin grants a Report
- **GIVEN** admin `ada` manages `{h1, project-a}` and user `bob` exists
- **WHEN** ada posts `{h1, project-a, username: bob, document: {kind: report, id: R0003}}`
- **THEN** bob can open Report R0003 and nothing else of project-a

#### Scenario: Probing for accounts reveals nothing
- **WHEN** ada grants access to a name that does not exist, to a disabled account, and to another admin's name
- **THEN** all requests fail with the same status and body

### Requirement: Grants name a Project or one Report/Wiki
A user grant SHALL name `{host, project}`, optionally narrowed to one document `{kind: report|wiki, id}`. A document grant SHALL admit only requests for that document, with the existing document-scope rules. Only `user` accounts SHALL hold read grants; changing an account to another level SHALL remove them.

#### Scenario: Document grant
- **GIVEN** user `bob` with a grant for `{h1, project-a, report, R0003}`
- **WHEN** bob opens Report R0003 and then the Project's experiment list
- **THEN** the Report renders and the experiment list is refused

### Requirement: Cluster and GPU-pool routes require access_clusters
Central SHALL refuse every route under `/manage/clusters`, `/api/clusters`, `/manage/gpu-pool` and `/api/gpu-pool` with `403` unless the identity has `access_clusters`, and SHALL admit identities that hold it there regardless of their Project scope. Navigation to these routes (the sidebar Clusters entry and the admin navbar section) SHALL be rendered only with that capability.

#### Scenario: Anonymous and Basic requests
- **WHEN** an anonymous request and a request with the `config.yml` Basic credentials ask for `GET /api/clusters`
- **THEN** the first gets `401` (or the login redirect for the page) and the second is admitted as the super admin

#### Scenario: User asks for cluster monitoring
- **WHEN** a `user` session requests `GET /api/clusters`
- **THEN** the response is `403` and no node is probed

#### Scenario: Admin uses the clusters
- **WHEN** an `admin` session requests `GET /api/clusters`
- **THEN** middleware admits it

### Requirement: Admin area with a capability-aware top navbar
`/manage/*` SHALL be the admin area, reachable only with `access_clusters`, `configure_instance` or `manage_project_grants`. Its layout SHALL render a top navbar listing exactly the sections the identity may open: **Clusters** (`access_clusters`), **Users** (`manage_accounts`), **Projects** and **Shares** (`manage_project_grants`) and **File access** (`configure_instance`); further cluster sections join under `access_clusters`. `/manage` SHALL redirect to the first permitted section.

#### Scenario: Super admin navbar
- **WHEN** the super admin opens `/manage`
- **THEN** it lands on the first permitted section and the navbar shows Clusters, Users, Projects, Shares and File access

#### Scenario: Admin navbar
- **WHEN** an admin opens `/manage`
- **THEN** the navbar shows Clusters, Projects and Shares and never Users or File access

#### Scenario: Guest is refused the area
- **WHEN** a `guest` session opens `/manage/users`
- **THEN** the response is `403`

### Requirement: Sidebar footer is the account entry
The sidebar footer's bottom-left SHALL show the signed-in account (username and level) for account sessions. With admin-area access, it SHALL link to `/manage`; it SHALL also offer sign-out. File access SHALL no longer have its own sidebar footer link. Share viewers without an account SHALL see no account entry.

#### Scenario: Super admin footer
- **WHEN** the super admin views any page with the sidebar
- **THEN** the footer shows its username with an Admin link to `/manage` and no separate File access link

### Requirement: Users section manages accounts
The Users section and `/api/admin/accounts*` SHALL require `manage_accounts`; no other route or page SHALL disclose which accounts exist. They SHALL list accounts without password material, create an account (username, initial password ≥ 8 characters, level `admin`/`user`/`guest`), change a level, disable or enable an account, reset a password, and replace a user's grants. Every change SHALL take effect on the account's next request.

#### Scenario: Create and grant
- **WHEN** the super admin creates user `bob` and grants `{h1, project-a}`
- **THEN** the list shows bob as `user` with that grant, and bob's next request is scoped to it

#### Scenario: Admin cannot manage accounts
- **WHEN** an `admin` session calls `POST /api/admin/accounts`
- **THEN** the response is `403`

#### Scenario: Admin requests the user list
- **WHEN** an `admin` session calls `GET /api/admin/accounts` or opens `/manage/users`
- **THEN** the response is `403`, and no page, navbar or payload available to it names or counts other accounts

### Requirement: Shares section manages share links by creator
`/manage/shares` SHALL require `manage_project_grants`. It SHALL list the shares the `/api/shares` listing returns to the identity (every share for the super admin, an admin's own shares otherwise), with label, Project, scope (Project, document, public or service), creation, expiry, active or expired status and, for the super admin only, the creator with a legacy mark. Each row SHALL offer revoke. Users and guests SHALL have no Shares section and cannot create shares.

#### Scenario: Super admin reviews creators
- **WHEN** the super admin opens `/manage/shares`
- **THEN** every share is listed with its creator, and legacy records show the super admin as creator

#### Scenario: Admin revokes its share
- **WHEN** admin `ada` revokes one of its own shares from `/manage/shares`
- **THEN** the share disappears and its link stops granting access
