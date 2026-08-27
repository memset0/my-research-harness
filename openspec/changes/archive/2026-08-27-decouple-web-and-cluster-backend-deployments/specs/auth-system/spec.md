## ADDED Requirements

### Requirement: Central is the only human authentication boundary
In central mode, the existing owner username/password, owner session cookie, session-signing secret, rate limit, and viewer authorization SHALL be evaluated only by central. A Backend SHALL use only its independent service Bearer token and SHALL NOT initialize or accept browser-facing credentials. Standalone SHALL retain the existing human authentication behavior.

#### Scenario: One owner login covers all configured Hosts
- **WHEN** the owner authenticates to central once
- **THEN** authorized central pages may route to multiple Backends without asking for any Backend credential

#### Scenario: Backend challenge is not exposed to browser
- **WHEN** Backend service authentication fails
- **THEN** central reports a Host authentication failure without relaying the Backend token challenge or secret context to the browser

### Requirement: Central viewer authorization uses Host-qualified scopes
Viewer identities SHALL carry a set of `{host, project}` scopes. A scope for one Host SHALL NOT grant access to an equal-name Project on another Host. Central SHALL authorize before proxying, and Backend SHALL enforce the forwarded viewer context against the exact tuple.

#### Scenario: Equal-name Project stays unauthorized
- **WHEN** a viewer has `{host-a, project-x}` and requests `{host-b, project-x}`
- **THEN** central returns 403 and does not forward protected data from Host B

### Requirement: Internal identity headers are never browser-controlled
Central SHALL remove all client-provided internal identity/scope headers and construct trusted actor context only from its resolved human session. Backend SHALL accept such context only on a valid service-authenticated request.

#### Scenario: Forged owner header fails
- **WHEN** an anonymous browser sends `X-Memon-Role: owner`
- **THEN** central ignores it and applies normal anonymous authentication

### Requirement: Service-bearing configurations are owner-only
On POSIX, central and Backend instance configurations containing service tokens SHALL be owner-only. Human first-run initialization SHALL preserve comments and keep the resulting file owner-only; startup SHALL fail before listen on unsafe permissions.

#### Scenario: First run does not weaken permissions
- **WHEN** first-run central auth is initialized in an owner-only registry file
- **THEN** the file remains owner-only and all existing Host/runbook comments remain intact
