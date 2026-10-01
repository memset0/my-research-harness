## ADDED Requirements

### Requirement: Run route identifiers are shape-validated before lookup

Every Web `/api/runs/:id` route (detail, README, status, archive, files and
warnings) SHALL accept `:id` only when, after URL decoding, it is either a Run
directory name (`<slug>-<YYMMDD>-<HHMMSS>` with no `/`) or a safe
project-relative Run path (`logs|outputs|experiments/…/<run-dir>` without
empty, `.` or `..` segments, backslashes, NUL or encoded separators). Any
other id SHALL be answered with `400` and body
`{"error":{"code":"INVALID_RESOURCE","message":…}}` before any project,
runtime-index or filesystem lookup.

#### Scenario: Encoded traversal id
- **WHEN** a client requests `GET /api/runs/..%2Fetc`
- **THEN** the response is `400` with code `INVALID_RESOURCE`, not `500`

#### Scenario: Path-qualified Run id still resolves
- **WHEN** a client requests `GET /api/runs/logs%2Ffoo-260501-100000`
- **THEN** the id passes validation and is resolved as before
