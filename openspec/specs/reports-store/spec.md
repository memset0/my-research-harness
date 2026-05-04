# reports-store Specification

## Purpose
TBD - created by archiving change inbox-reports-and-digests. Update Purpose after archive.
## Requirements
### Requirement: Reports live at `<projectRoot>/docs/reports/R<NNNN>-<slug>.md`

The dashboard SHALL discover, parse, and serve markdown files from `<projectRoot>/docs/reports/` whose base name matches the strict regex `^R\d{4}-[a-z0-9][a-z0-9-]*\.md$`. Files in the directory that do not match SHALL be ignored (no warning at the API level — they are not reports). Discovery SHALL be recursive only one level deep (we look at `docs/reports/*` directly, not at subdirectories).

#### Scenario: Match the canonical pattern
- **GIVEN** files `docs/reports/R0001-attn-overlap.md` and `docs/reports/R0042-fsdp-comm.md`
- **WHEN** the API lists reports
- **THEN** both are returned with `id` `R0001` / `R0042` and `slug` `attn-overlap` / `fsdp-comm`

#### Scenario: Ignore non-matching files
- **GIVEN** an extra file `docs/reports/notes.md` next to canonical reports
- **WHEN** the API lists reports
- **THEN** `notes.md` is NOT in the result

### Requirement: GET /api/reports?project=NAME lists all reports

`GET /api/reports?project=<name>` SHALL return `{ reports: ReportSummary[] }` sorted by `id` descending. `ReportSummary` SHALL include `id`, `slug`, `path` (absolute), `mtime`, and `title` (the first H1 heading of the file body, or null if absent). The response SHALL NOT include the file content (use `GET /api/reports/<id>` for that). The response SHALL be served from the runtime cache populated at warmup; no `fs.readFile` per request on the hot path.

#### Scenario: Empty directory
- **WHEN** the project has `docs/reports/` empty or missing
- **THEN** the API returns `{ reports: [] }` with HTTP 200

#### Scenario: Sort by id desc
- **GIVEN** reports `R0001-a`, `R0003-c`, `R0002-b`
- **WHEN** the API returns the list
- **THEN** order is `R0003-c, R0002-b, R0001-a`

#### Scenario: Title extracted from first H1
- **GIVEN** `R0001-attn.md` whose body starts with `# Attention overlap analysis`
- **WHEN** the API returns the list
- **THEN** the entry's `title` is `"Attention overlap analysis"`

#### Scenario: Missing H1 yields null title
- **GIVEN** `R0007-quick.md` whose body has no top-level H1
- **WHEN** the API returns the list
- **THEN** the entry's `title` is `null`

### Requirement: GET /api/reports/[id]?project=NAME returns one report

`GET /api/reports/<id>?project=<name>` SHALL return `{ id, slug, path, mtime, hash, content }` for the report whose canonical id matches. `hash` SHALL be the sha1 hex digest of the UTF-8 content. The id SHALL match the canonical regex `^R\d{4}$`; non-matching ids return 400 BAD_REQUEST. A report id whose file does not exist returns 404 NOT_FOUND.

#### Scenario: Read existing report
- **WHEN** the user requests `/api/reports/R0001?project=p`
- **THEN** the response includes the file's mtime, sha1 hash, and full markdown content

#### Scenario: Bad id format
- **WHEN** the user requests `/api/reports/foo?project=p`
- **THEN** the response is 400 BAD_REQUEST with `error.code: "BAD_REQUEST"`

#### Scenario: Missing report
- **WHEN** the user requests `/api/reports/R9999?project=p` and no such file exists
- **THEN** the response is 404 NOT_FOUND

### Requirement: PUT /api/reports/[id]?project=NAME writes with mtime+hash optimistic lock

`PUT /api/reports/<id>?project=<name>` body `{ content, expectedMtime, expectedHash }` SHALL atomically replace the file's content via a `.tmp.<random>` sibling + rename. On success, return `{ ok: true, mtime, hash }` reflecting the post-write state. The server SHALL refuse the write and return 409 CONFLICT with `{ error: { code: "CONFLICT" }, currentMtime, currentHash, currentContent }` when on-disk mtime !== expectedMtime OR on-disk hash !== expectedHash. The path used for the write SHALL be validated by `assertWithinProjectRoots()`; out-of-root attempts return 403 FORBIDDEN.

#### Scenario: Successful write
- **GIVEN** the client read mtime/hash, then the user types and clicks Save
- **WHEN** PUT carries the matching expectedMtime+expectedHash
- **THEN** the file is rewritten and the response carries the new mtime+hash

#### Scenario: Stale mtime → 409 CONFLICT
- **GIVEN** an external write happened between client read and client save
- **WHEN** PUT arrives with the now-stale expectedMtime
- **THEN** the response is 409 with the current on-disk mtime, hash, and content

#### Scenario: Path traversal attempt blocked
- **WHEN** a request resolves to a path outside any configured project root
- **THEN** the response is 403 FORBIDDEN

### Requirement: Live cache backed by Poller

The runtime SHALL maintain an in-memory cache of all reports for every configured project. The cache SHALL be warmed at server start. The shared `Poller` SHALL watch `<projectRoot>/docs/reports/` (the directory itself, for additions/deletions) and every individual file matching the regex (for content changes). On `mtime` advance, the cache SHALL refresh the affected entry; on directory change the cache SHALL re-scan and update the list.

#### Scenario: New file appears
- **WHEN** a skill writes `R0042-new.md` to the watched directory
- **THEN** within the configured polling window, the cache reflects the new entry and an SSE invalidation event with kind `reports` fires
- **AND** subsequent `GET /api/reports?project=...` returns it

#### Scenario: External edit reflected
- **WHEN** an external process edits an existing report's content
- **THEN** the cache's content for that entry refreshes within the polling window and an SSE invalidation fires

