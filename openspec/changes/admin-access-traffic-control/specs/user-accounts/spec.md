## MODIFIED Requirements

### Requirement: Admin area with a capability-aware top navbar
`/manage/*` SHALL be the admin area, reachable only with `access_clusters`, `configure_instance` or `manage_project_grants`. Its layout SHALL render a top navbar listing, in this order, exactly the sections the identity may open: **Clusters** (`access_clusters`), **Access control** (`manage_accounts` or `manage_project_grants`, at `/manage/access`) and **Traffic control** (`configure_instance`, at `/manage/traffic`); further cluster sections join under `access_clusters`. `/manage` SHALL redirect to the first permitted section. Access control SHALL show Users, Projects and Shares as separate cards with the anchors `#users`, `#projects` and `#shares`; the Users card SHALL be rendered only with `manage_accounts` and the Projects and Shares cards only with `manage_project_grants`. `/manage/users`, `/manage/projects` and `/manage/shares` SHALL keep their previous capability requirement and redirect to the matching anchor; `/manage/file-access` SHALL keep `configure_instance` and redirect to `/manage/traffic`.

#### Scenario: Super admin navbar
- **WHEN** the super admin opens `/manage`
- **THEN** it lands on Clusters and the navbar shows Clusters, Access control and Traffic control

#### Scenario: Admin navbar
- **WHEN** an admin opens `/manage`
- **THEN** the navbar shows Clusters and Access control and never Traffic control

#### Scenario: Admin opens Access control
- **WHEN** an admin opens `/manage/access`
- **THEN** it sees the Projects and Shares cards and no Users card, and the page names no other accounts

#### Scenario: Old section URL
- **WHEN** the super admin opens `/manage/shares`
- **THEN** it is redirected to `/manage/access#shares`

#### Scenario: Guest is refused the area
- **WHEN** a `guest` session opens `/manage/users`
- **THEN** the response is `403`

### Requirement: Shares section manages share links by creator
The Shares card of Access control SHALL require `manage_project_grants`. It SHALL list the shares the `/api/shares` listing returns to the identity (every share for the super admin, an admin's own shares otherwise), with label, Project, scope (Project, document, public or service), creation, expiry, active or expired status and, for the super admin only, the creator with a legacy mark. Each row SHALL offer revoke. Users and guests SHALL have no Shares card and cannot create shares.

#### Scenario: Super admin reviews creators
- **WHEN** the super admin opens `/manage/access#shares`
- **THEN** every share is listed with its creator, and legacy records show the super admin as creator

#### Scenario: Admin revokes its share
- **WHEN** admin `ada` revokes one of its own shares from the Shares card
- **THEN** the share disappears and its link stops granting access
