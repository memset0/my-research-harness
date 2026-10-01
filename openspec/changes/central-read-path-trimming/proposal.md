## Why

On the operator project (about 1,300 Runs, 30 Experiments, 36 wiki pages, served
directly from a network mount) every dashboard page pays a fixed layout cost of
159 filesystem operations, an Experiment detail with 448 members costs about
2,465, a wiki list about 8,700 even when warm, and the anomaly list about 5,400.
Nothing is cached between requests, so an open tab repeats the same work on
every 30-second heartbeat, and a `304` still recomputes the full body first.
Three interface defects make it worse: the Run list answers `500
PAYLOAD_TOO_LARGE` at this scale, `/api/runs/<id>/files` is `404` in direct
mode, and the translation readiness probe holds the first page load for about
3 s before failing.

## What Changes

- **Realpath once per request (D1).** Backend path containment memoizes the
  real path of the Project root for the duration of one request; Run path
  resolution reuses it instead of re-resolving the root per member.
- **Readdir-only inventories (D2).** The wiki inventory, the code-review
  inventory, the Report inventory and the Journal count no longer read every
  document body per request: identities come from directory listings, page
  frontmatter and the Journal count come from the summary index, and the
  code-review inventory judges listed entries by lexical containment under one
  resolved `docs/` directory instead of one realpath per directory.
- **Slim Experiment list rows (D3, wire change).** `GET /api/experiments` list
  rows carry only what the list renders: identity, title, status, archived,
  tags, effective times, `readmeMtime`, member/hypothesis/open-warning counts
  and parse issues. Section bodies, `warningsRaw`, the bundle activity `mtime`
  and the `runs` / `hypotheses` arrays are dropped from the list; the detail
  response is unchanged. Rows are built from README.md alone.
- **In-memory summary index with stat validation (D4).** The central process
  keeps a rebuildable, per-Project index of parsed Run README summaries,
  Experiment READMEs/bundles, wiki pages, Reports, code reviews, hypotheses,
  the Journal count, directory listings and the Run walk. Each entry is keyed by
  a stat fingerprint and re-read only when the fingerprint changes. Detail
  reads (Experiment member eligibility, a Run's parent lookup) validate every
  entry they use on each request; list reads served by central may reuse an
  entry validated within 60 s (Run summaries in a terminal status: up to
  300 s), so an external edit reaches a list within 5 minutes. A write through
  central invalidates the Project's index immediately. Detail pages always read
  the Experiment and Run documents themselves.
- **Conditional list heartbeats (D5).** Central list and inventory reads
  (Experiments, wiki, anomalies, Reports, code reviews, hypotheses, Journal
  count) answer with an `ETag` derived from the fingerprints of every index
  entry and listing they used, plus `Cache-Control: private, no-cache`. A
  request whose `If-None-Match` names a known validator is answered `304`
  after re-validating those fingerprints only, without recomputing the body.
  The browser resource protocol stores the validator and sends
  `If-None-Match` explicitly.
- **Fixes (D6).** The Run list is paginated (`limit`, `cursor`, `nextCursor`)
  so it can no longer exceed the response size limit; `/api/runs/<id>/files`
  resolves the Run by path through the Backend service instead of the empty
  legacy index; translation readiness is cached server-side and the client
  defers its readiness request until the page is idle.
- No on-disk convention change, no core change, no new storage mode.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `experiment-discovery`: defines the slim Experiment list row.
- `cluster-backend-api`: Run list pagination, conditional list reads with
  `ETag`/`304`, path-resolved Run file listing.
- `project-read-performance`: the central summary index, its validation
  windows and the request-scoped root realpath.
- `runtime-cache`: the summary index is an allowed rebuildable parsed cache
  layered on file observations; inventories stay body-free.
- `live-updates`: heartbeats send `If-None-Match` and an unchanged list costs
  no body recomputation; translation readiness never blocks first paint.

## Impact

- `packages/backend`: containment, Run path resolution, project/document
  services, new summary-index and conditional-read modules, route table
  (`limit`/`cursor` on `/runs`, conditional list routes), pipeline write
  invalidation.
- `apps/web`: direct runtime policy wiring, Run list/files routes, Experiment
  list route and DTO, card grid and its tests, resource protocol and
  `jsonFetch`, translation status route and `BodyTranslation`.
- Wire: Experiment list rows lose `sections`, `warningsRaw`, `mtime`,
  `frontMatter.runs`, `frontMatter.hypotheses` and gain counts; Run list gains
  `nextCursor` and is paged. Detail responses are unchanged.
- Release surface: central only (PATCH on its own).
