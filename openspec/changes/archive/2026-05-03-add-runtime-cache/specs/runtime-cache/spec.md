## ADDED Requirements

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
- The Poller is running for every watched path

#### Scenario: First request is fast
- **WHEN** the server has just booted (e.g., `next dev` reports `Ready`) and the very first HTTP request hits `/api/projects`
- **THEN** the response is served in < 200ms (no disk I/O, no first-time scan)

#### Scenario: Re-init on dev restart still works
- **WHEN** the developer kills `next dev` and restarts it
- **THEN** warmup runs again on boot; the user sees a longer "Ready" time (a few seconds) but the next HTTP request remains fast

### Requirement: API routes serve from runtime cache

`GET /api/hypotheses?project=NAME` and `GET /api/journal?project=NAME[&limit=N&before=ISO]` SHALL read from the runtime cache instead of `fs.readFile`. The response shapes MUST remain identical to the previous behavior (no breaking change to clients or SSR fetchers).

#### Scenario: No fs.readFile in hot path
- **WHEN** `/api/hypotheses?project=project-a` is invoked 100 times in a row
- **THEN** at most ONE `fs.readFile` for `HYPOTHESES.md` happens during that period (only when the Poller observes a real mtime change); all other calls hit the cache

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
