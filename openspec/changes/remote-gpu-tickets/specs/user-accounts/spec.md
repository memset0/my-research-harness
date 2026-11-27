# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Admins have owner reach on their granted Projects`
- TO: `### Requirement: Admins have owner reach on every Project`

- FROM: `### Requirement: Admins manage user read grants on their granted Projects`
- TO: `### Requirement: Admins manage user read grants on every Project`

## MODIFIED Requirements

### Requirement: Capabilities derive from the level
The levels SHALL grant these capabilities, and route handlers and navigation SHALL check capabilities rather than raw levels:

| capability | super_admin | admin | user | guest |
|---|---|---|---|---|
| `manage_accounts` (accounts) | yes | no | no | no |
| `configure_instance` (file access and other instance settings) | yes | no | no | no |
| `access_clusters` (cluster monitoring, GPU pool) | yes | yes | no | no |
| `manage_project_grants` (user read grants) | all Projects | all Projects | no | no |
| Project reach | full owner reach, all Projects | full owner reach (reads and writes), all Projects | read-only, granted Projects/documents | share links and public pages only |

#### Scenario: Admin lacks instance configuration
- **GIVEN** an `admin` session
- **WHEN** it requests the Users card's API or the file-access settings API
- **THEN** the response is `403` and no configuration is read or written

### Requirement: Non-super-admin accounts are scoped identities
A `user` or `guest` session SHALL be evaluated like a share viewer, scoped to a user's read grants or to nothing for a guest, each merged with valid `memon-shares` entries. An `admin` session SHALL reach every configured Project as below. Other `mutating`, `shell` or `global` routes SHALL be refused with `403` for these accounts unless a held capability or the admin rule below admits them.

#### Scenario: User reaches a granted Project only
- **GIVEN** user `bob` with a Project grant for `{host: h1, project: project-a}`
- **WHEN** bob opens `/h1/project-a` and then `/h1/project-b`
- **THEN** the first page renders read-only and the second is refused with `403`

#### Scenario: Admin lists every Project
- **WHEN** admin `ada` lists Projects
- **THEN** the list contains every configured Project

#### Scenario: User cannot write
- **WHEN** a `user` session sends a mutating request for a Project it can read
- **THEN** the response is `403` and nothing is written

#### Scenario: Account signs out
- **WHEN** an `admin`, `user` or `guest` session posts `/api/auth/logout`
- **THEN** the session cookie is cleared, although every other ungated write is refused

#### Scenario: Guest relies on share links
- **GIVEN** a `guest` session with no grants and a valid share cookie for `{h1, project-a}`
- **WHEN** it opens `/h1/project-a`
- **THEN** the page renders read-only as for a share viewer

### Requirement: Admins have owner reach on every Project
A request from an `admin` that addresses exactly one configured Project SHALL be authorized as the owner, writes included, still bounded by that Project's `read_only`/`allowed_edits`. Requests naming no single Project SHALL NOT be elevated.

#### Scenario: Admin edits any Project
- **WHEN** admin `ada` saves a Wiki page in `project-a` and then in `project-b`
- **THEN** both writes succeed as for the owner

#### Scenario: Project stays read-only when configured so
- **GIVEN** `{h1, project-a}` is configured `read_only`
- **WHEN** admin `ada` saves a Wiki page there
- **THEN** it is refused exactly as the super admin's write would be

#### Scenario: Admin keeps no instance-level writes
- **WHEN** admin `ada` writes UI preferences, file-access settings or accounts
- **THEN** each request is refused with `403`

### Requirement: Admins manage user read grants on every Project
`/api/project-access` SHALL require `manage_project_grants`. `GET` SHALL list every configured Project with its user grants as usernames. `POST`/`DELETE {host, project, username, document?}` SHALL add or remove a read grant on a configured Project by exact username. Any other Project SHALL answer `404`.

#### Scenario: Admin view lists every Project
- **WHEN** admin `ada` requests `GET /api/project-access`
- **THEN** every configured Project is listed with its user grants

#### Scenario: Admin grants a Report
- **GIVEN** user `bob` exists
- **WHEN** admin `ada` posts `{h1, project-a, username: bob, document: {kind: report, id: R0003}}`
- **THEN** bob can open Report R0003 and nothing else of project-a

#### Scenario: Probing for accounts reveals nothing
- **WHEN** ada grants access to a name that does not exist, to a disabled account, and to another admin's name
- **THEN** all requests fail with the same status and body

## REMOVED Requirements

### Requirement: The super admin grants Projects to admins
**Reason**: Admins reach every Project; GPU nodes give no isolation between Projects, so per-Project admin grants restricted nothing real.
**Migration**: `/api/admin/project-admins` is retired. Stored admin Project grants are deleted when the account store opens. No admin loses access.
