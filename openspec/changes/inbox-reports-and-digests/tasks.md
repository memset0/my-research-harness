## 1. Core: types + parsers + DirCache

- [x] 1.1 Add `ReportSummary` and `DigestSummary` interfaces in `packages/core/src/types.ts`. Fields: id, slug (reports) / date (digests), path, mtime, title (string | null).
- [x] 1.2 Add filename regex constants in the same file: `REPORT_FILENAME_REGEX = /^R\d{4}-[a-z0-9][a-z0-9-]*\.md$/` and `DIGEST_FILENAME_REGEX = /^D\d{4}-\d{4}-\d{2}-\d{2}\.md$/`.
- [x] 1.3 Add a `extractTitle(content: string): string | null` helper to `packages/core/src/readme/sections.ts` (or a new `markdown.ts`) that returns the first H1 heading text or null.
- [x] 1.4 Implement `DirCache<T>` in `apps/web/lib/runtime/dir-cache.ts` next to the existing `FileCache`. Methods: `warmup`, `getList(dir)`, `getContent(absPath)`, `putContent(absPath, content, expectedMtime, expectedHash)`, `handlePollChange(path)`. Watches both the directory mtime (for adds/removes) and each matching file (for content edits). Uses sha1 for content hash.
- [x] 1.5 Unit-test `DirCache` independently of HTTP: warmup populates list, file write through `putContent` returns new mtime+hash, conflict on stale mtime, dir change re-scans.

## 2. Core: runtime integration

- [x] 2.1 In `apps/web/lib/runtime.ts`: instantiate `reportsCache: DirCache<ReportSummary>` and `digestsCache: DirCache<DigestSummary>` with the per-project `docs/reports/` and `docs/digests/` directories. Register dir + file paths with the shared `Poller` after warmup.
- [x] 2.2 Wire SSE invalidation: when `DirCache.handlePollChange` triggers a refresh, emit a runtime event `{ type: 'reports' | 'digests', project: string }`; `apps/web/lib/events-client.ts` and the SSE bridge surface this to React Query as a key invalidation for `['reports', project]` / `['digests', project]`.

## 3. Backend: API routes

- [x] 3.1 `apps/web/app/api/reports/route.ts` (GET: list).
- [x] 3.2 `apps/web/app/api/reports/[id]/route.ts` (GET: read; PUT: write with mtime+hash optimistic lock; route through `assertWithinProjectRoots`).
- [x] 3.3 Mirror under `apps/web/app/api/digests/...`.
- [x] 3.4 Tests for each route: 200 success, 400 BAD_REQUEST (bad id format), 403 FORBIDDEN (path traversal), 404 NOT_FOUND, 409 CONFLICT (stale mtime).

## 4. Server data fetchers (SSR prefetch)

- [x] 4.1 `apps/web/lib/server/data.ts`: add `getReportsList(project)`, `getReport(project, id)`, `getDigestsList(project)`, `getDigest(project, id)` — all reading from the runtime cache.
- [x] 4.2 `apps/web/lib/api.ts`: add client-side `fetchReports(project)`, `fetchReport(project, id)`, `putReport(project, id, payload)` and digest mirrors. Plus types `ReportSummary` / `Report` / `DigestSummary` / `Digest`.

## 5. Frontend: shared inbox shell

- [x] 5.1 `apps/web/components/inbox-shell.tsx` (server component or client; lean toward client because of FAB/Sheet state). Props: `kind: 'reports' | 'digests'`, `project: string`, `items: Array<...>`, `selectedId: string | null`, `selectedItem: { content, mtime, hash } | null`, `emptyState: ReactNode`.
- [x] 5.2 `apps/web/components/inbox-rail.tsx` — the scrollable list. Each item: id (mono), title (truncated), date/slug fingerprint. Active item highlight via `usePathname()`-derived selectedId.
- [x] 5.3 `apps/web/components/inbox-editor.tsx` — Monaco wrapper using existing `<ReadmeMonaco>` with `language="markdown"`. Props: `initialContent`, `expectedMtime`, `expectedHash`, `onSaved`, `onCancel`. Internal state for buffer + dirty flag. PUT on Save; toast on CONFLICT with Reload action.
- [x] 5.4 Mobile FAB: `<Button size="icon" className="fixed bottom-6 right-6 z-30 md:hidden">` opening a `<Sheet side="right">` containing the same rail. Auto-close on selection.
- [x] 5.5 Mobile edit takeover: a separate `<Sheet side="bottom" h-[100svh]>` mounted from the rendered view's Edit button on mobile. Sticky toolbar with Save / Cancel.

## 6. Frontend: routes

- [x] 6.1 `apps/web/app/p/[project]/reports/page.tsx` — landing (no item selected). SSR-prefetches `['reports', project]`.
- [x] 6.2 `apps/web/app/p/[project]/reports/[id]/page.tsx` — detail. SSR-prefetches `['reports', project]` AND `['report', project, id]`. Validates id matches `^R\d{4}$`; 404s otherwise.
- [x] 6.3 Mirror under `apps/web/app/p/[project]/digests/...`.

## 7. AppBar tabs

- [x] 7.1 In `apps/web/components/app-bar.tsx`, add `Reports` and `Digests` tabs in the order Experiments / Hypotheses / Journal / Reports / Digests. Active match using `pathname.startsWith(`${projectBase}/reports`)` etc.

## 8. Mock fixtures

- [x] 8.1 Add `mock/project-a/docs/reports/R0001-attn-overlap.md` (~50 lines of plausible content).
- [x] 8.2 Add `mock/project-a/docs/digests/D0001-2026-05-01.md` and `D0002-2026-05-04.md`.
- [x] 8.3 (Optional) Add the same shape under `mock/project-b/docs/` so cross-project switching is exercised.

## 9. Verification

- [x] 9.1 `pnpm --filter @memon/core test` and `--filter @memon/web test` clean.
- [x] 9.2 `pnpm --filter @memon/web typecheck` clean.
- [x] 9.3 Smoke: open `/p/sparse-fsdp/reports` (one real file: `R0001-predictive-skip-p3`) — list rail shows it, right pane renders, Edit button works (write back same content, expect 200; corrupt mtime client-side, expect CONFLICT toast).
- [x] 9.4 Smoke: open `/p/project-a/reports` and `/p/project-a/digests` — mock fixtures show.
- [x] 9.5 Mobile smoke (DevTools narrow viewport): verify FAB appears bottom-right, Sheet slides right with list, tapping an item navigates and closes; Edit takes full viewport.
- [x] 9.6 Curl the new APIs against the running dev server: list, read, PUT (with deliberate stale mtime to confirm 409).
- [x] 9.7 `openspec validate inbox-reports-and-digests --type change` clean.
- [x] 9.8 Commit: split into logical units (core+cache, backend, frontend, mock+spec) following recent precedent.
