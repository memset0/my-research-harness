## Context

Host-qualified wiki requests are served by the Backend `FilesystemDocumentService` created once per
directly served Host (`apps/web/lib/central/direct-runtime.ts`). Each wiki projection calls the
artifact provider `readWikiArtifacts`, which runs `discoverRuns(project, { includeArchived: true })`
to learn every Run directory, then reads only cited Runs. Measured on a real Project with 1416 Run
directories on NFS: the walk alone takes 1.2–9.5 s. Git review for all pages takes about 0.3 s, and
the report inventory takes 15 ms. With page and list requests arriving together, the two walks
compete and both responses land after 4–44 s. The standalone runtime (`/p/...`) serves from its
own polling cache and is already fast. Its detail route still awaits the list prefetch before
rendering.

## Goals / Non-Goals

**Goals:**
- A warm page open costs no Run walk. Concurrent wiki projections of one Project share one walk.
- A single-page read derives review for that page only.
- The standalone detail route renders the page without waiting on the list.

**Non-Goals:**
- Changing API shapes, splitting diagnostics out of the page response, or streaming responses.
- Caching Run metadata, experiment docs, or git state.
- Pre-warming the inventory at process start. The first wiki request after a restart still pays
  one walk.

## Decisions

1. **Per-Project Run inventory with single-flight + stale-while-revalidate, owned by
   `FilesystemDocumentService`.** Each entry holds `{ paths, builtAt, inFlight }`.
   - With no value, the caller awaits the in-flight walk and starts one if none is running.
   - With a value, the caller gets it at once. If the value is older than
     `RUN_INVENTORY_REFRESH_MS` (15 s) and no walk is running, a background walk starts.
   - A failed walk keeps the previous value. A failed walk with no value rejects the waiting
     callers, and the next call retries.

   The inventory is passed to `readWikiArtifacts` through a new optional `runPaths` loader. The
   default provider (`scanBackendWikiArtifacts`) forwards it, so an injected provider still sees
   the old signature plus one optional argument. This is a polling-style refresh with no watcher,
   which the "no fs.watch" rule allows.
   *Alternative considered:* reuse the filesystem monitor's snapshot. It is keyed by base name and
   drops paths, and it would couple document reads to monitor lifecycle. Rejected.
   *Alternative considered:* a fixed-TTL cache. Every expiry would put a full walk back on a user's
   page open. Rejected.

2. **Single-page review is scoped to the cited page.** `projectWiki` already receives `cited`. It
   now passes `cited` page paths to `wikiReviews` whenever `cited !== pages`. Sibling summaries in
   that projection are discarded, so leaving their review `null` is invisible to callers.
   `deriveWikiReview` is per target, so the requested page's review is identical to the list's.

3. **Cited-Run resolution and reads are bounded (8 in flight).** A list that cites busy
   Experiments reads about 1.1k member Run READMEs. Launched all at once, they fill Node's file
   I/O queue, and a concurrent page request's handful of reads wait behind all of them. Measured
   on the real Project with a warm inventory, the page finished just before the list (~600 ms vs
   ~100 ms alone). With the bound it returns in ~330 ms while the list still takes ~650 ms, so list
   throughput is unchanged. A bound of 4 measured the same, so 8 is kept.

4. **Standalone route prefetches the page only.** `app/p/[project]/wiki/[id]/page.tsx` drops the
   list prefetch. `WikiShell` already issues the list query on the client and shows the rail
   skeleton. The Host-qualified route already renders client-side with independent queries.

## Risks / Trade-offs

- A Run directory created in the last ≤15 s, or since the last request, may be missing from the
  inventory. A page citing it by bare base name shows `WIKI_SOURCE_UNRESOLVED` for one refresh.
  Its `@` mention is also unresolved for that window. Path-form citations resolve directly and are
  unaffected. The next request after the background walk is correct.
- The memory cost is one path array per Project: about 1.4k strings.
- Standalone first paint shows a rail skeleton instead of a server-rendered rail. This is
  acceptable and is the requested behaviour.
