## ADDED Requirements

### Requirement: Document-scoped viewers reach only the shared document
A viewer whose only grant for a `{host, project}` is document-scoped SHALL be authorized for a `read` route of that Project only when the route targets the shared document: its page route; its detail, backlinks and bundle-asset reads; content-gateway assets that resolve to those bundle reads; and, for an Experiment, its README, results, document assets under its own directory, Run details and Run files of Runs under its own run directory, and log reads under that directory. Every other route of that Project, including Project-wide lists, SHALL be denied with 403, and multi-Project routes SHALL not expose that Project. Paths in query parameters SHALL be normalized and rejected when they contain dot-segments. Requests authorized through a document grant SHALL carry that Project in the request's viewer scope only for that request, so handler-level scope checks admit it while multi-Project handlers never see it. Project-scoped grants keep their existing authorization. The server-injected session SHALL expose document grants so the UI can omit Project navigation for such viewers.

#### Scenario: Shared Wiki page and its assets
- **GIVEN** a viewer holding only a `wiki W0004` grant for `{host-a, project-x}`
- **WHEN** it requests the W0004 page, `/api/wiki/W0004` and W0004 bundle assets
- **THEN** each request is allowed

#### Scenario: Other documents and lists are denied
- **GIVEN** the same viewer
- **WHEN** it requests `/api/wiki/W0001`, `/api/wiki?host=host-a&project=project-x` or `/api/experiments`
- **THEN** each request receives 403

#### Scenario: Experiment share covers its Runs only
- **GIVEN** a viewer holding an `experiment E0001-x` grant
- **WHEN** it reads a Run under `logs/E0001/` and its log
- **THEN** the reads are allowed
- **AND** a Run or log under `logs/E0002/` or a `resource` with `..` is denied
