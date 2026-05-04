## ADDED Requirements

### Requirement: Reports cache backed by Poller and DirCache

The runtime SHALL maintain an in-memory cache of all reports for every configured project, populated at warmup. The cache SHALL be backed by a `DirCache<ReportSummary>` that watches `<projectRoot>/docs/reports/` (the directory itself, for additions and deletions) and every individual file matching `^R\d{4}-[a-z0-9][a-z0-9-]*\.md$` (for content changes). Backoff rules SHALL be the standard 1s → 5min × 2.

The cache SHALL expose:
- `getReportsList(project: string): ReportSummary[]` returning the metadata list (id, slug, path, mtime, title)
- `getReportContent(project: string, id: string): { content, mtime, hash } | null` returning the latest content+mtime+hash for one report (or null if missing)

#### Scenario: New report file appears
- **WHEN** a skill writes `R0042-new-finding.md` to a watched directory
- **THEN** within the polling backoff window the cache list includes the new entry, and an SSE invalidation event with kind `reports` fires
- **AND** subsequent `getReportsList(project)` returns it

#### Scenario: External edit reflected
- **WHEN** an external process edits a report's content
- **THEN** within the polling window `getReportContent` returns the new content, mtime, and hash; an SSE invalidation event fires

### Requirement: Digests cache backed by Poller and DirCache

The runtime SHALL mirror the reports cache for digests, watching `<projectRoot>/docs/digests/` with filename regex `^D\d{4}-\d{4}-\d{2}-\d{2}\.md$`. Same lifecycle, same Poller integration, same SSE event kind (`digests`).

#### Scenario: New digest file appears live
- **WHEN** `memon-digest-journal` writes a new digest
- **THEN** the cache list includes it within the polling window and an SSE invalidation event of kind `digests` fires

## MODIFIED Requirements

### Requirement: Eager warmup via instrumentation.ts

The web app SHALL include `apps/web/instrumentation.ts` whose exported `register()` triggers `getRuntime()` on server startup. This SHALL execute under both `next dev` and `next start`.

After server boot the following SHALL be true before the first HTTP request lands:
- `ExperimentIndex` is fully populated (all configured projects scanned and indexed)
- All `<project_root>/HYPOTHESES.md` and `<project_root>/JOURNAL.md` files have been read + parsed (or marked as `null` on ENOENT) and registered with the Poller
- The reports `DirCache` has scanned every `<project_root>/docs/reports/` directory and registered each matching file with the Poller (along with the directory itself)
- The digests `DirCache` has scanned every `<project_root>/docs/digests/` directory and registered each matching file with the Poller
- The Poller is running for every watched path

#### Scenario: First request is fast
- **WHEN** the server has just booted (e.g., `next dev` reports `Ready`) and the very first HTTP request hits `/api/projects` or `/api/reports?project=...`
- **THEN** the response is served in < 200ms (no disk I/O, no first-time scan)

#### Scenario: Re-init on dev restart still works
- **WHEN** the developer kills `next dev` and restarts it
- **THEN** warmup runs again on boot — including the reports / digests `DirCache` scans — the user sees a longer "Ready" time (a few seconds) but the next HTTP request remains fast

### Requirement: API routes serve from runtime cache

`GET /api/hypotheses?project=NAME`, `GET /api/journal?project=NAME[&limit=N&before=ISO]`, `GET /api/reports?project=NAME`, `GET /api/reports/<id>?project=NAME`, `GET /api/digests?project=NAME`, and `GET /api/digests/<id>?project=NAME` SHALL read from the runtime cache instead of `fs.readFile` on every request. The response shapes SHALL remain identical to the documented `reports-store` / `digests-store` / hypotheses / journal contracts.

#### Scenario: No fs.readFile in hot path
- **WHEN** any of the listed GET endpoints is invoked 100 times in a row against a steady-state project
- **THEN** zero `fs.readFile` calls happen on the request path (all data comes from in-memory caches refreshed only by Poller ticks)
