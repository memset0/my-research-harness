## 1. Backend Run inventory

- [x] 1.1 Let `FilesystemProjectService.readWikiArtifacts` (and `scanBackendWikiArtifacts` / `BackendWikiArtifactProvider`) accept an optional Run-path loader, falling back to the current `discoverRuns` walk
- [x] 1.2 Add a per-Project single-flight, stale-while-revalidate Run inventory to `FilesystemDocumentService` (15 s refresh age, keep last value on failure) and pass it to every wiki projection
- [x] 1.3 Derive git review only for the cited page in single-page projections (`getWiki`, post-write re-projection)
- [x] 1.4 Bound cited-Run resolution and README reads in `readWikiArtifacts` so a concurrent page read is not queued behind a list's thousand Run reads

## 2. Web

- [x] 2.1 Make `app/p/[project]/wiki/[id]/page.tsx` prefetch only the selected page, leaving the list to the client

## 3. Verification

- [x] 3.1 Add backend tests: concurrent page+list share one walk; warm read serves cached inventory and refreshes in background after the refresh age; failed refresh keeps the last inventory; single-page review matches the list's review
- [x] 3.2 Run the selected backend wiki/document tests and web typecheck
- [x] 3.3 Measure page and concurrent page+list latency against the real Project on a separate port with the new build, and confirm rendered wiki HTML/CSS per the UI verification protocol
