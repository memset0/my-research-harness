## Context

Central serves the operator Project directly from a network mount
(`storage: local`), so the Project file Store runs in its direct mode: every
Node fs call is a physical round trip, nothing is cached between requests, and
the in-process Backend recomputes every response. An offline harness (a
separate Node process that loads the same direct runtime and counts fs calls
under the Project root, read-only) measured the baseline below on the v7.3.0
code with the operator's current configuration (the `outputs/` subtree already
excluded from the Run walk). Counts are Node fs calls per page
(stat+lstat+access / readdir / readFile+open / realpath).

| Page (requests) | ops | dominant cost |
|---|---|---|
| Layout floor (6 inventories) | 159 | wiki inventory reads all 36 pages; code-review inventory does 66 realpaths |
| Project home (+ Experiment list) | 430 | list reads README + 3 YAML for 30 bundles, 650 KB body |
| Experiment detail, 448 members | 2,465 | per member: realpath root + target + README, stat, read README |
| Experiment detail, 1 member | 230 | layout floor + code-review list |
| Run detail (by path) | 39 | parent lookup reads all 30 Experiment READMEs |
| Run detail (by base name) | 143 | Run walk |
| Wiki list | 8,701 | staleness reads ~1,225 member READMEs, 3,616 realpaths |
| Wiki page | 11,935 | same, plus the page's own projection |
| Reports | 285 | Report list reads every Report |
| Anomalies | 5,424 | walk + read all Run READMEs + 1,295 sidecar probes |

A heartbeat (every 30 s per open tab) repeats the full page cost: the semantic
`304` of the existing resource protocol is decided after the body is built.

Constraints: no core or on-disk change in this change (a parallel change owns
`packages/core`), no new storage mode, Path containment stays a hard rule, the
user accepted a ≤5 minute delay for external edits on lists while detail pages
always read the documents themselves.

## Goals / Non-Goals

**Goals:** layout floor ≈25 ops cold and ≈0 warm; Experiment list ≈61 ops and
≈30 KB; Experiment detail with 448 members ≈470 ops warm; wiki list warm
≈1,500 or less; anomalies ≈1,500 or less; unchanged heartbeats with no body
reads; fix the three interface defects.

**Non-Goals:** the Run walk itself (owned by the parallel discovery change),
an on-disk index (a future FS version), the `storage: network` mode, git-status
polling, PHANTOM classification by path.

## Decisions

### D1. Request-scoped root realpath

`packages/backend` gets a request scope (AsyncLocalStorage) opened by the route
pipeline around every handler. `resolveContained` and the backend's own Run
path resolver take the Project root's real path from the scope (computed once,
shared by concurrent awaits) and still resolve every target's real path. The
Run resolver mirrors core's `resolveDeclaredRunPath` checks (Run-path shape,
target and `README.md` real paths inside the real root, target is a
directory). Outside a request (CLI-shaped callers, tests) the memo is absent
and behaviour is unchanged.

### D4. Summary index (before D2/D3 because they use it)

One `ProjectReadIndex` per Project root, shared by the project and document
services through a module-level registry (both services of a host runtime see
the same object). Entry kinds:

| Key | Fingerprint | Value |
|---|---|---|
| `file:<abs>#<parser>` | `stat`: dev, ino, size, mtimeMs, ctimeMs (null = missing) | parser output (Run summary, Experiment README record, Experiment bundle, wiki page text, Report title, code-review metadata, hypotheses, Journal count) |
| `dir:<abs>` | sorted names + entry types of `readdir(withFileTypes)` | the listing |
| `real:<abs>` | `realpath` result | containment verdict |
| `tree:<abs>` | bundle asset list + newest mtime | the same |
| `walk` | sorted Run directory paths | the paths (stale-while-revalidate) |
| `git` | stat of `.git/index` and `.git/logs/HEAD` (60 s time bucket when `.git` is not a directory) | none |

`observe(key, maxAgeMs, fingerprint, load)`: an entry validated within
`maxAgeMs` is returned without I/O; otherwise the fingerprint is taken; an
equal fingerprint refreshes `validatedAt`; a different one reloads; a missing
target drops the entry. Concurrent observations of a key share one promise.
A load that throws is not cached. The value is parsed from the bytes read
after the stat, so a write racing the stat leaves a stale fingerprint that the
next validation corrects (never the reverse).

A Run summary entry is keyed by the Run directory and fingerprinted by its
README (the directory itself when there is no README). It stores the parsed
README record without its body (same defaults and backfills as `readRunDir`,
one read per load), the deprecation flag, and an `eligibilityError` that
reproduces `listDeprecatedRunIds`' strictness (unterminated frontmatter, a
frontmatter that is not a mapping, a non-boolean `deprecated`). Archival is
the declared `archived` key; only when the README does not declare it is the
legacy `.archived` sidecar probed (itself an index observation, adding the
same migration warning). A README that declares `archived` is no longer
probed for a coexisting stale sidecar — this removes one `access` per Run.
Walked directories are never followed links, so only declared Run paths
(Experiment `runs`, wiki citations) are verified with real paths, once per
loaded entry; a later fingerprint match proves the same inode is still
reached, so a swapped symlink shows up as a fingerprint change and a full
re-resolution.

Validation policy (`ReadPolicy`), passed by the service per call:

| Policy | listMaxAgeMs | terminalRunMaxAgeMs | walkRefreshMs |
|---|---|---|---|
| default (standalone, tests) | 0 | 0 | 15,000 for the wiki inventory as before; 0 (fresh walk) elsewhere |
| central (direct runtime) | 60,000 | 300,000 | 60,000 |

Detail consumers always pass 0. Terminal statuses are `FINISHED`, `FAILED`,
`INTERRUPTED`; `RUNNING`, `PENDING`, `UNKNOWN` use `listMaxAgeMs`. The route
pipeline invalidates a Project's index (all `validatedAt` reset, walk marked
due) after every successful non-GET request for that Project. The index is
not a source of truth: dropping it only costs reads.

Consumers moved onto the index: Experiment list and inventory, Experiment
detail member eligibility (declared paths, legacy base names through the walk),
Run detail parent lookup, Run list and anomalies (walk + Run summaries +
Experiment READMEs), wiki inventory, wiki list and page projection (pages,
bundles, cited Experiments, cited and member Runs, hypotheses, review marks,
Report ids), Reports, code reviews, hypotheses and the Journal count.

### D2. Readdir-only inventories

- Wiki inventory: `dir` observations of `docs/wiki/` and each kind; page id and
  `legacy_id` come from the page entry (frontmatter parsed once per
  fingerprint).
- Code-review inventory: real path of `docs/` once; `code-review/`,
  `experiments/` and each `E…/code-review/` are judged lexically when the
  listing reports a real directory (not a symlink); a symlinked directory falls
  back to `resolveContained`.
- Report inventory: one listing plus a `real:` observation of `docs/reports`.
- Journal count: `file:` entry whose value is the event count.

### D3. Slim Experiment list rows

| Field | List (before) | List (after) | Detail |
|---|---|---|---|
| id, project, resource | yes | yes | yes |
| readmeMtime | yes | yes | yes |
| mtime (bundle activity, needs YAML stats) | yes | **removed** | yes |
| frontMatter.id/slug/title/status/archived/tags/createdAt/updatedAt | yes | yes | yes |
| frontMatter.runs | yes | **removed → `runCount`** | yes |
| frontMatter.hypotheses | yes | **removed → `hypothesisCount`** | yes |
| sections | yes | **removed** | yes |
| warningsRaw | yes | **removed → `openWarningCount`** | yes |
| parseErrors, parseWarnings | yes | yes | yes |
| effectiveCreatedAt/UpdatedAt | yes | yes | yes |

The only list consumer is the card grid, which renders id, title, status,
archived, tags and effective times; nothing reads a removed field from the
list (archive/status controls invalidate the list key and use the detail for
locks). The Backend schema for the row is derived from core's
`BackendExperimentSummarySchema` (`omit` / `extend` with shapes taken from the
same schema) because the backend has no direct zod dependency; the web DTO gets
an `ExperimentListRow` type, and `ExperimentDocDetail` keeps extending the full
summary.

### D5. ETag algorithm

A conditional route runs its handler inside a dependency recorder. Every index
observation records `(key, fingerprint, maxAgeMs, revalidate)`; the recorder
is an AsyncLocalStorage so concurrent awaits inside one handler share it.

```
validator = W/"<base64url(sha256(routeKey + "\n" + sorted(key + "=" + fingerprint)))[0..27]>"
routeKey  = project + " " + backend path + "?" + sorted query without the conditional headers
```

The validator and its dependency list go into a bounded LRU (1,024 entries,
process-local). On a request with `If-None-Match`, each listed validator that
is in the LRU for the same `routeKey` is checked by re-validating its
dependencies with their recorded windows (stat/readdir only when due); if all
fingerprints are equal the route answers `304` with that `ETag` and
`Cache-Control: private, no-cache`. Otherwise the handler runs and the `200`
carries a fresh validator. Fingerprints are taken before the bytes are read,
so a body is never older than the validator it is sent with; a race only
causes one extra `200`. The direct runtime forwards `ETag` and
passes the `304` through (it is not a JSON read), adding its freshness headers.
The semantic `X-Memon-Resource-Version` is still computed for every `200`, so a
metadata-only change that alters the validator does not show an update toast.

Client: `versionCache` stores `{ version, etag, body }`; `beginResourceRequest`
sets `If-None-Match` (and the known version) when an entry exists. Fetch turns
a request with an explicit `If-None-Match` into cache mode `no-store`, so the
`304` reaches `jsonFetch`, which already returns the cached body object and
retries unconditionally when the body was evicted. A fresh tab without a JS
entry may still get the browser's own revalidation from the `no-cache` HTTP
cache entry; either path ends with zero body recomputation on the server.

### D6. Fixes

1. Run list: `limit` (1–1000, default 200) and `cursor` =
   base64url(JSON `[createdAt, path]`) of the last row; the next page starts
   strictly after it in (createdAt desc, path asc) order. Response
   `{ runs, nextCursor }`; the standalone route mirrors it (`experiments` key
   kept for its existing client). The list is composed from the walk and Run
   summaries instead of `scanProjectRoot`.
2. Run files: the Next route drops the legacy-index lookup and lets
   `getRunFiles` resolve the reference (`RESOURCE_NOT_FOUND` / unknown Project
   → 404); `runPath` (absolute) is no longer sent.
3. Translation readiness: a process-wide memo of the probe (in-flight shared,
   success cached 10 min, failure 60 s; `TRANSLATION_DISABLED` is decided
   before the memo, cheaply); `BodyTranslation` requests status from
   `requestIdleCallback` (fallback `setTimeout` 1.5 s) after mount.

### Adopting the parallel discovery change

The core change `bounded-run-discovery` (already on main) classifies
`PHANTOM_RUN_REF` for path declarations by the declared path on disk and adds
a per-Project `run_dirs` (glob patterns for Run locations; it replaced an
interim `run_depth`). Central adopts both: membership is classified from the
declared path, and every central walk — the summary index's shared walk, the
wiki inventory walk, Run reference resolution and the standalone runtime's
discovery — calls `discoverRuns(project)` with the configured Project, which
applies `run_dirs` itself; no central path calls `scanProjectRoot` any more.
The standalone runtime's `recomputeAnomalies` becomes async for the disk check
(only the newest recompute per Project publishes). When the composition later
moves onto the summary index (D4) the declared-path map is built from indexed
Run entries — an existing contained directory yields its Run record, anything
else null — and passed to `computeMembership` as `declaredRuns`, which is the
same classification at one fingerprint per declared path. Direct `discoverRuns`
callers pick up `run_dirs` from the Project config automatically. The core
`onPatternNonRun` lint callback is not surfaced by central yet (Future).

## Risks / Trade-offs

- NFS attribute caching (`acregmax`) can delay a fingerprint change by up to
  its own window; this adds to the list window but not to detail reads, which
  still read the documents.
- A legacy `.archived` sidecar added without touching the README is seen only
  when the README fingerprint changes (the sidecar is a migration-window
  artifact; frontmatter is canonical).
- Process memory: ~1,300 Run summaries without bodies plus 30 Experiment
  bundles and 36 pages, a few MB.
- The LRU of validators is process-local; a restart costs one full `200` per
  open list.
- The wiki review state comes from git; the `git` fingerprint covers commits
  and index updates in an ordinary `.git` directory, and falls back to a 60 s
  bucket otherwise.

## Migration Plan

No data migration. Deploy is a central PATCH; the Experiment list wire change
ships together with its only client. Rollback is the previous release.

## Measurements

Filled in after implementation (same harness, same page set).

## Future

- Persist the index per Project (`.memon/index/`) maintained by every memon
  writer, with the same fingerprint validation (FS v8 option B).
- `storage: network` with TTLs for mounted Projects once measured.
- Git-status polling (10 s per Project) is now the largest periodic cost left.
- Surface core's `RUN_DIR_PATTERN_NON_RUN` (`onPatternNonRun`) next to anomalies.
