## ADDED Requirements

### Requirement: Wiki cache backed by Poller and DirCache

The runtime SHALL maintain an in-memory cache of every project's wiki pages, populated at warmup, in addition to the existing reports cache. The cache SHALL be backed by a `DirCache<WikiSummary>` operating two levels deep over `<projectRoot>/docs/wiki/`: it SHALL watch `docs/wiki/` itself (for kind directories appearing and disappearing), every kind directory (for pages appearing and disappearing), and every discovered page file — `<slug>.md` or a bundle's `<slug>/README.md` — for content changes. The depth-2 mode SHALL be opt-in per `DirCache` instance; depth-1 SHALL remain the default, so the reports, digests, and code-reviews caches are unaffected. Backoff rules SHALL be the standard 1s → 5min × 2. The cache SHALL NOT use `fs.watch`.

The cache SHALL expose:
- `getWikiList(project: string): WikiSummary[]` returning the list projection (id, slug, kind, title, status, date, tags, sources, legacyId, stale, staleSources, review (state, verifiedThrough, unverifiedCommits, dirty), format, mtime, updatedAt, diagnostics)
- `getWikiPage(project: string, id: string): { content, mtime, hash } | null` returning the latest content+mtime+hash for one page (or null if missing)

On any list-level change the cache SHALL emit an SSE invalidation event of kind `wiki-change` carrying the affected project. The `reports` invalidation kind and the reports cache SHALL continue to behave exactly as before.

Staleness and review state SHALL be derived when the list projection is built, from state already in memory (the Experiment index, the hypotheses cache, and the wiki list itself); serving `getWikiList` SHALL NOT read the filesystem.

#### Scenario: New page file appears
- **WHEN** an agent writes `docs/wiki/finding/kv-cache-ceiling.md`
- **THEN** within the polling backoff window the cache list includes the new entry, and an SSE invalidation event of kind `wiki-change` fires for the project
- **AND** subsequent `getWikiList(project)` returns it

#### Scenario: New kind directory is picked up without a restart
- **WHEN** `docs/wiki/decision/` is created and its first page written
- **THEN** within the polling window the new kind directory is registered and watched, the page is listed, and a `wiki-change` event fires

#### Scenario: External page edit reflected
- **WHEN** an external process edits a page's content
- **THEN** within the polling window `getWikiPage` returns the new content, mtime, and hash; a `wiki-change` invalidation event fires

#### Scenario: Cited Experiment change flips staleness
- **GIVEN** page `W0004` cites `E0017` and currently reports `stale: false`
- **WHEN** `E0017`'s effective updated time advances past `W0004`'s `updated_at`
- **THEN** the next `getWikiList(project)` reports `W0004` with `stale: true` and `E0017` in `staleSources`

#### Scenario: Reports cache is untouched by the wiki cache
- **GIVEN** a project with both `docs/reports/` and `docs/wiki/` populated
- **WHEN** a report file and a wiki page are both written
- **THEN** the reports cache lists the report and fires the `reports` invalidation kind, the wiki cache lists the page and fires `wiki-change`, and neither cache's directory set includes the other's tree

## MODIFIED Requirements

### Requirement: Eager warmup via instrumentation.ts

The web app SHALL include `apps/web/instrumentation.ts` whose exported `register()` triggers `getRuntime()` on server startup. This SHALL execute under both `next dev` and `next start`.

After server boot the following SHALL be true before the first HTTP request lands:
- `ExperimentIndex` is fully populated (all configured projects scanned and indexed)
- All `<project_root>/HYPOTHESES.md` and `<project_root>/JOURNAL.md` files have been read + parsed (or marked as `null` on ENOENT) and registered with the Poller
- The reports `DirCache` has scanned every `<project_root>/docs/reports/` directory and registered each matching file with the Poller (along with the directory itself)
- The wiki `DirCache` has scanned every `<project_root>/docs/wiki/` tree two levels deep and registered every discovered page file (`<slug>.md` or a bundle's `<slug>/README.md`) with the Poller, along with `docs/wiki/` itself and each kind directory
- The digests `DirCache` has scanned every `<project_root>/docs/digests/` directory and registered each matching file with the Poller
- The code-reviews `DirCache` has scanned every `<project_root>/docs/code-review/` directory AND every existing `<project_root>/docs/experiments/E<NNNN>-<slug>/code-review/` directory, registering each matching file (and each directory) with the Poller
- The Poller is running for every watched path

#### Scenario: First request is fast
- **WHEN** the server has just booted (e.g., `next dev` reports `Ready`) and the very first HTTP request hits `/api/projects` or `/api/code-reviews?project=...`
- **THEN** the response is served in < 200ms (no disk I/O, no first-time scan)

#### Scenario: Re-init on dev restart still works
- **WHEN** the developer kills `next dev` and restarts it
- **THEN** warmup runs again on boot — including the reports / wiki / digests / code-reviews `DirCache` scans — the user sees a longer "Ready" time (a few seconds) but the next HTTP request remains fast

### Requirement: API routes serve from runtime cache

`GET /api/hypotheses?project=NAME`, `GET /api/journal?project=NAME[&limit=N&before=ISO]`, `GET /api/reports?project=NAME`, `GET /api/reports/<id>?project=NAME`, `GET /api/wiki?project=NAME`, `GET /api/wiki/<id>?project=NAME`, `GET /api/digests?project=NAME`, `GET /api/digests/<id>?project=NAME`, `GET /api/code-reviews?project=NAME`, and `GET /api/code-reviews/<...id>?project=NAME` SHALL read from the runtime cache instead of re-scanning directories on every request. The list endpoints SHALL be served entirely from in-memory metadata; the single-doc endpoints MAY read the one addressed file fresh (to return exact content+mtime+hash). The response shapes SHALL remain identical to the documented `reports-store` / `wiki-store` / `digests-store` / `code-review-store` / hypotheses / journal contracts.

#### Scenario: No directory rescan in hot path
- **WHEN** any of the listed list endpoints is invoked 100 times in a row against a steady-state project
- **THEN** zero directory scans happen on the request path (all list data comes from in-memory caches refreshed only by Poller ticks)
