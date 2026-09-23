## Why

Opening a wiki page on a Host-qualified central project blocks the page body for seconds: every
`GET /api/wiki/:id`, like every list request, walks every Run directory of the project from scratch
(about 1.4k directories, 1–10 s on NFS) just to know which `@` Run mentions and bare Run citations
exist. The browser asks for the page and the rail list at the same time, so two identical walks
compete for the same filesystem and both requests finish together, often after 30–45 s. The reader
cannot see the page they opened until the sidebar's work is also done.

## What Changes

- The Backend document service keeps one Run-directory inventory per Project, shared by the wiki
  list, single-page, write and backlinks projections: concurrent requests join one in-flight walk,
  and a cached inventory is served immediately while an age-gated background walk refreshes it
  (stale-while-revalidate). Only directory existence is cached; cited Run metadata is still read
  fresh on every projection.
- Cited-Run resolution and README reads in a wiki projection run with bounded concurrency, so a
  list citing a thousand member Runs no longer queues a concurrent page's file reads behind them.
- `GET /api/wiki/:id` (and the post-write projection) derives git review state for the requested
  page only, instead of blaming every page of the wiki.
- The standalone `/p/<project>/wiki/<W-id>` route prefetches only the selected page on the server;
  the rail list loads on the client, so the reading surface never waits on the list.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-store`: opening one page SHALL NOT wait on a fresh project-wide Run walk or on other pages'
  review derivation; the Run inventory used for citation and `@` resolution may be served from a
  shared cache refreshed in the background.
- `wiki-viewer`: the selected page's reading surface SHALL render independently of the rail list's
  loading state, including on the server-rendered standalone route.

## Impact

- `packages/backend/src/document-service.ts`, `packages/backend/src/project-service.ts`
  (`readWikiArtifacts` accepts an injected Run inventory) and their tests.
- `apps/web/app/p/[project]/wiki/[id]/page.tsx`.
- Central Web/gateway-only release (PATCH). No CLI, skills, API shape or filesystem change.
