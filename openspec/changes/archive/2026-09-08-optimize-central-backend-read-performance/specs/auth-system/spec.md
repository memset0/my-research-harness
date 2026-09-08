## ADDED Requirements

### Requirement: Browser-facing authentication failures do not advertise Basic challenges
The Web/central server SHALL continue to accept an explicitly supplied owner
`Authorization: Basic` header using the existing constant-time comparison and
rate limit. A failed HTTP API or auth-check request SHALL return 401 without
`WWW-Authenticate`, so a browser never replaces the memon login/share
experience with a native HTTP Basic dialog. HTML navigations without a usable
identity SHALL continue to redirect to `/login?next=...`.

#### Scenario: Anonymous browser background API request
- **WHEN** the login page or another anonymous browser surface causes a same-origin API request without credentials
- **THEN** the response is 401 with `Cache-Control: no-store`
- **AND** `WWW-Authenticate` is absent

#### Scenario: Preemptive CLI Basic remains supported
- **WHEN** curl or CLI sends a valid `Authorization: Basic ...` header on its first request
- **THEN** it authenticates as owner without requiring a preceding challenge response

### Requirement: Anonymous pages do not open authenticated live-update streams
The root client provider SHALL subscribe to `/api/events` only for an injected `owner` or `viewer` session. An anonymous `/login` render SHALL not open or retry EventSource until a later authenticated navigation remounts the provider.

#### Scenario: Login page remains quiet
- **WHEN** an anonymous browser renders `/login`
- **THEN** no `/api/events` EventSource is created
- **AND** the login form remains the only authentication prompt
