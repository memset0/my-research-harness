## MODIFIED Requirements

### Requirement: Central share identity is Host-qualified
New central share URLs SHALL use `/share/<host>/<project>/<token>`, and viewer cookie entries SHALL store `{host, project, token}`. Central SHALL construct this public URL from its configured public origin after validating the exact owning Backend's create response; it SHALL NOT return a Backend-internal URL or a Backend DTO that omits `share_url`. A share for one Host SHALL not authorize an equal-name Project on another Host.

#### Scenario: Central creates a canonical share URL
- **WHEN** an owner creates a share for `{host-a, project-x}` through central
- **THEN** the response contains `https://<public-origin>/share/host-a/project-x/<token>`
- **AND** opening that link redeems only the `{host-a, project-x}` viewer scope

#### Scenario: Same Project name has independent shares
- **WHEN** Host A and Host B both expose `project-x` and only Host A token is redeemed
- **THEN** the viewer can read Host A's Project but receives 403 for Host B's

### Requirement: Owning Backend validates and stores share state
Share creation, listing, revocation, expiry, and landing validation SHALL route to the exact owning Backend Project. These operations SHALL be guarded by the independent `shares` capability; create/revoke SHALL NOT additionally require the broad Project-data `mutations` capability. Central SHALL mint/refresh the viewer cookie only after that Backend validates the token. An offline/unusable Backend SHALL not mint or revalidate access.

#### Scenario: Read-only data Backend issues a viewer credential
- **GIVEN** a usable Backend advertises `shares: true` and `mutations: false`
- **WHEN** an authenticated owner creates or revokes a share through central
- **THEN** the exact Backend updates only its share store and returns the bounded share DTO
- **AND** unrelated Project-data mutations remain unavailable

#### Scenario: Revocation takes effect through central
- **WHEN** a share is revoked on its owning Backend
- **THEN** later central requests prune or reject that Host-qualified viewer scope
