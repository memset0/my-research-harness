# digests-store Specification

## Purpose
TBD - created by archiving change inbox-reports-and-digests. Update Purpose after archive.
## Requirements
### Requirement: Digests live at `<projectRoot>/docs/digests/D<NNNN>-<YYYY-MM-DD>.md`

The dashboard SHALL discover, parse, and serve markdown files from `<projectRoot>/docs/digests/` whose base name matches the strict regex `^D\d{4}-\d{4}-\d{2}-\d{2}\.md$` (i.e. `D` + 4 digits + `-` + ISO date). Files that do not match SHALL be ignored. Discovery SHALL be one level deep within the directory.

#### Scenario: Match canonical pattern
- **GIVEN** `docs/digests/D0001-2026-05-04.md` and `docs/digests/D0002-2026-05-05.md`
- **WHEN** the API lists digests
- **THEN** both appear with the parsed id and date

#### Scenario: Reject malformed
- **GIVEN** `docs/digests/D1-2026-05-04.md` (unpadded id) and `docs/digests/notes.md`
- **WHEN** the API lists digests
- **THEN** neither appears

### Requirement: GET /api/digests?project=NAME lists all digests

`GET /api/digests?project=<name>` SHALL return `{ digests: DigestSummary[] }` sorted by date descending. `DigestSummary` SHALL include `id` (e.g. `D0001`), `date` (`2026-05-04`), `path`, `mtime`, and `title` (first H1 of body, or null). Response SHALL come from runtime cache.

#### Scenario: Sort by date desc
- **GIVEN** digests for 2026-05-01, 2026-05-04, 2026-05-02
- **WHEN** the API returns the list
- **THEN** order is `D…-2026-05-04, D…-2026-05-02, D…-2026-05-01`

#### Scenario: Empty directory
- **WHEN** the project has `docs/digests/` empty or missing
- **THEN** the API returns `{ digests: [] }` with HTTP 200

### Requirement: GET /api/digests/[id]?project=NAME returns one digest

`GET /api/digests/<id>?project=<name>` SHALL return `{ id, date, path, mtime, hash, content }`. The id SHALL match `^D\d{4}$`; mismatch returns 400. Missing id returns 404.

#### Scenario: Read existing digest by id
- **WHEN** the user requests `/api/digests/D0001?project=p` and a digest with that id exists
- **THEN** the response includes mtime, hash, content, and the parsed `date` field

### Requirement: PUT /api/digests/[id]?project=NAME writes with mtime+hash optimistic lock

Identical contract to `PUT /api/reports/<id>` (body `{ content, expectedMtime, expectedHash }`; sha1 hash; 409 CONFLICT on stale mtime or hash; 403 FORBIDDEN on path-traversal). The server SHALL NOT modify the digest's filename or directory in any way — only the content bytes change.

#### Scenario: Successful write
- **WHEN** PUT arrives with matching expected mtime+hash
- **THEN** the file is rewritten and response carries new mtime+hash

#### Scenario: Stale write → 409 CONFLICT
- **GIVEN** the digest was edited externally since the client opened it
- **WHEN** PUT arrives with stale expectedMtime
- **THEN** 409 with current mtime, hash, content

#### Scenario: Editing does NOT advance the JOURNAL `last_digest_at` cursor
- **WHEN** the user edits a digest's content via PUT
- **THEN** `<projectRoot>/JOURNAL.md` frontmatter `last_digest_at` is unchanged
- **AND** no JOURNAL events are appended (digest content edits are not journal events)

### Requirement: Live cache backed by Poller

Same shape as the reports cache. The runtime SHALL warm at boot, watch the digests directory and every matching file via the shared Poller, and emit SSE invalidations with kind `digests` on additions / deletions / content changes.

#### Scenario: New digest appears live
- **WHEN** `memon-digest-journal` writes a new digest
- **THEN** the dashboard sees it within the polling window with an SSE event of kind `digests`

