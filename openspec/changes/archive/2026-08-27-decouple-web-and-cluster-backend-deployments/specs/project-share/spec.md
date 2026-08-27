## ADDED Requirements

### Requirement: Central share identity is Host-qualified
New central share URLs SHALL use `/share/<host>/<project>/<token>`, and viewer cookie entries SHALL store `{host, project, token}`. A share for one Host SHALL not authorize an equal-name Project on another Host.

#### Scenario: Same Project name has independent shares
- **WHEN** Host A and Host B both expose `project-x` and only Host A token is redeemed
- **THEN** the viewer can read Host A's Project but receives 403 for Host B's

### Requirement: Owning Backend validates and stores share state
Share creation, listing, revocation, expiry, and landing validation SHALL route to the exact owning Backend Project. Central SHALL mint/refresh the viewer cookie only after that Backend validates the token. An offline/unusable Backend SHALL not mint or revalidate access.

#### Scenario: Revocation takes effect through central
- **WHEN** a share is revoked on its owning Backend
- **THEN** later central requests prune or reject that Host-qualified viewer scope

### Requirement: Legacy share landing is migration-only and fail-safe
A legacy project-only share URL MAY be supported during bootstrap only through an explicitly configured migration Host or a unique unambiguous validation result. It SHALL never select the first Host by name. Newly created central shares SHALL always use the Host-qualified form.

#### Scenario: Ambiguous legacy share does not grant access
- **WHEN** a legacy share cannot be bound to exactly one Host
- **THEN** central rejects it without adding any viewer scope
