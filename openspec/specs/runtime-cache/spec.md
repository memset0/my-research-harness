# runtime-cache Specification

## Purpose
TBD - created by archiving change add-runtime-cache. Update Purpose after archive.
## Requirements
### Requirement: Hypotheses cache backed by Poller

The runtime SHALL maintain an in-memory cache of parsed `HYPOTHESES.md` content for every configured project. The cache key SHALL be the project's absolute root path; the value SHALL be the result of `parseHypotheses(content)` plus the `mtime` observed at parse time.

The runtime SHALL register every `<project_root>/HYPOTHESES.md` path with the existing `Poller` (using its standard `min/max/factor` settings). When the Poller observes the `mtime` advancing, it SHALL re-read the file, run `parseHypotheses`, and atomically replace the cached entry.

When the file does not exist (`ENOENT`), the cache entry SHALL be `null` and the Poller SHALL continue watching the path so a later create is observable.

#### Scenario: Cached read after warmup
- **WHEN** `getHypothesesData(project)` is called after the runtime has warmed up
- **THEN** it returns from the in-memory cache without invoking `fs.readFile` and the cached value matches what `parseHypotheses` produced at warmup time

#### Scenario: External edit observed within poll window
- **WHEN** an external tool (`memon` CLI, an agent's `Edit` write, etc.) modifies `HYPOTHESES.md`
- **THEN** the next `Poller` tick detects the new `mtime`, the file is re-read and re-parsed, and a subsequent `getHypothesesData(project)` call returns the new content (within `poll.max_interval_ms`)

#### Scenario: Missing file gracefully handled
- **WHEN** a project has no `HYPOTHESES.md` on disk
- **THEN** `getHypothesesData(project)` returns `{ entries: [], parseErrors: [], parseWarnings: [], legendBlock: null, summaryTableBlock: null, ... }` (matching the existing API shape) without throwing, AND the Poller continues to watch the path

### Requirement: Journal cache backed by Poller

The runtime SHALL maintain an in-memory cache of parsed `JOURNAL.md` content for every configured project, with the same lifecycle and missing-file handling as the hypotheses cache.

#### Scenario: Cached read after warmup
- **WHEN** `getJournalData(project)` is called after warmup
- **THEN** it returns from the in-memory cache without disk I/O

#### Scenario: Append refreshes cache promptly
- **WHEN** `POST /api/journal/append` succeeds and writes a new line to `JOURNAL.md`
- **THEN** the runtime invokes `Poller.resetBackoff()` for that file, the next tick (within `poll.min_interval_ms`, default 1s) re-reads + re-parses + updates cache, AND a subsequent `getJournalData(project)` call shows the new event

### Requirement: Eager warmup via instrumentation.ts

The web app SHALL include `apps/web/instrumentation.ts` whose exported `register()` triggers `getRuntime()` on server startup. This SHALL execute under both `next dev` and `next start`.

After server boot the following SHALL be true before the first HTTP request lands:
- `ExperimentIndex` is fully populated (all configured projects scanned and indexed)
- All `<project_root>/HYPOTHESES.md` and `<project_root>/JOURNAL.md` files have been read + parsed (or marked as `null` on ENOENT) and registered with the Poller
- The reports `DirCache` has scanned every `<project_root>/docs/reports/` directory and registered each matching file with the Poller (along with the directory itself)
- The digests `DirCache` has scanned every `<project_root>/docs/digests/` directory and registered each matching file with the Poller
- The code-reviews `DirCache` has scanned every `<project_root>/docs/code-review/` directory AND every existing `<project_root>/docs/experiments/E<NNNN>-<slug>/code-review/` directory, registering each matching file (and each directory) with the Poller
- The Poller is running for every watched path

#### Scenario: First request is fast
- **WHEN** the server has just booted (e.g., `next dev` reports `Ready`) and the very first HTTP request hits `/api/projects` or `/api/code-reviews?project=...`
- **THEN** the response is served in < 200ms (no disk I/O, no first-time scan)

#### Scenario: Re-init on dev restart still works
- **WHEN** the developer kills `next dev` and restarts it
- **THEN** warmup runs again on boot — including the reports / digests / code-reviews `DirCache` scans — the user sees a longer "Ready" time (a few seconds) but the next HTTP request remains fast

### Requirement: API routes serve from runtime cache

`GET /api/hypotheses?project=NAME`, `GET /api/journal?project=NAME[&limit=N&before=ISO]`, `GET /api/reports?project=NAME`, `GET /api/reports/<id>?project=NAME`, `GET /api/digests?project=NAME`, `GET /api/digests/<id>?project=NAME`, `GET /api/code-reviews?project=NAME`, and `GET /api/code-reviews/<...id>?project=NAME` SHALL read from the runtime cache instead of re-scanning directories on every request. The list endpoints SHALL be served entirely from in-memory metadata; the single-doc endpoints MAY read the one addressed file fresh (to return exact content+mtime+hash). The response shapes SHALL remain identical to the documented `reports-store` / `digests-store` / `code-review-store` / hypotheses / journal contracts.

#### Scenario: No directory rescan in hot path
- **WHEN** any of the listed list endpoints is invoked 100 times in a row against a steady-state project
- **THEN** zero directory scans happen on the request path (all list data comes from in-memory caches refreshed only by Poller ticks)

### Requirement: Server-side data fetchers (SSR) consume cache

`apps/web/lib/server/data.ts`'s `getHypothesesData` and `getJournalData` SHALL pull from the same cache used by the API routes. They MUST NOT re-implement disk I/O.

#### Scenario: Page prefetch is fast
- **WHEN** a Next.js page calls `getJournalData(project)` during SSR render
- **THEN** the call resolves in < 50ms after warmup (in-memory lookup + structuredClone for safety)

### Requirement: Runtime health diagnostic endpoint

The web backend SHALL expose `GET /api/runtime/health` returning a JSON document with:
- `warmupAt`: ISO8601 timestamp of when the runtime finished initial warmup
- `projects`: count of configured projects
- `experiments`: count of experiments in the index
- `hypothesesCached`: number of project-level hypothesis caches populated
- `journalsCached`: number of project-level journal caches populated
- `lastError`: most recent runtime error message (string or null)
- `uptimeMs`: milliseconds since warmup completed

#### Scenario: Health after a fresh boot
- **WHEN** `/api/runtime/health` is hit immediately after server boot
- **THEN** the response is 200 with `warmupAt` set, `projects` = configured project count, `experiments` >= 0, `lastError: null`

#### Scenario: Health is fast and never blocks
- **WHEN** `/api/runtime/health` is hit
- **THEN** the response returns in < 50ms regardless of how many projects/experiments are in the index

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

### Requirement: Code-reviews cache backed by Poller and DirCache

The runtime SHALL maintain an in-memory cache of all code-review docs for
every configured project, populated at warmup, backed by a
`DirCache<CodeReviewSummary>`. Unlike the flat reports/digests caches, the
code-reviews cache SHALL watch TWO kinds of locations per project:

- the flat `<projectRoot>/docs/code-review/` directory (project-wide docs), and
- every existing `<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/`
  directory (experiment-scoped docs).

Each is watched as a directory (for add/remove of docs) and every contained
file matching `^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$` is watched (for
content changes). Backoff rules SHALL be the standard 1s → 5min × 2. The
cache SHALL NOT use `fs.watch`.

The set of experiment `code-review/` directories changes at runtime and SHALL
be reconciled without a server restart:
- when `<projectRoot>/docs/experiments/` changes (an experiment folder is
  created or removed), the cache SHALL add/remove the corresponding
  `E*/code-review/` directories;
- when an experiment folder's own mtime advances and a `code-review/`
  subdirectory now exists that is not yet watched, the cache SHALL add it.

`DirCache` SHALL expose `addDir(dir, poller?)` (register + scan + watch a new
content directory) and `removeDir(dir)` (drop a directory's cache state) to
support this dynamic set.

The cache SHALL expose, per project, aggregating across the flat dir and all
experiment subdirs:
- `getCodeReviewsList(project): CodeReviewSummary[]` — metadata incl. id,
  scope, experiment, title, times, and the derived completion summary
- `getCodeReviewContent(project, id): { content, mtime, hash } | null`

On any list-level change the cache SHALL emit an SSE event
`code-reviews-change` carrying the affected project.

#### Scenario: New project-wide doc appears
- **WHEN** a `2026-05-24-foo.md` file is written to `<root>/docs/code-review/`
- **THEN** within the polling window the cache list includes it and a `code-reviews-change` SSE event fires for the project

#### Scenario: First review inside an existing experiment
- **GIVEN** experiment `E0042-attn` already exists with no `code-review/` subdir
- **WHEN** `docs/experiments/E0042-attn/code-review/2026-05-24-foo.md` is created
- **THEN** within the polling window the cache adds the new `code-review/` directory, lists the doc, and fires `code-reviews-change`

#### Scenario: New experiment with reviews
- **WHEN** a new experiment folder containing a `code-review/` subdir appears under `docs/experiments/`
- **THEN** the cache reconciles the new subdir and lists its docs without a restart

#### Scenario: External edit reflected
- **WHEN** an external process edits a code-review doc's content
- **THEN** within the polling window `getCodeReviewContent` returns the new content/mtime/hash and a `code-reviews-change` event fires

