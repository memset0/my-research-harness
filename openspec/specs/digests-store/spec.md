# digests-store Specification

## Purpose
Keep historical digest discovery and reading available while retiring managed authoring and Journal cursor advancement.

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

### Requirement: Historical digest reads refresh through shared file observations

Existing digest discovery and read surfaces SHALL remain backed by central primitive file observations and foreground heartbeat queries. Externally added, edited or removed canonical digest files SHALL remain visible after the applicable observation becomes due and a subsequent query retrieves it. No managed digest authoring skill or cursor advance SHALL be required for discovery.

#### Scenario: Existing digest edited outside memon
- **WHEN** a user edits a historical digest with their own editor
- **THEN** the read-only dashboard reflects that file change without any Journal cursor mutation

### Requirement: Historical digests remain readable without managed authoring

Digest list/detail GET contracts and canonical file discovery SHALL remain available. The managed digest editor, PUT route and cursor-driven generation workflow SHALL be removed. Existing files SHALL NOT be deleted, relabelled as wiki evidence, or rewritten during rollout.

#### Scenario: Historical digest after cutover
- **WHEN** a user opens an existing D0001 document
- **THEN** its content is readable and no Edit or digest-generation action is offered
