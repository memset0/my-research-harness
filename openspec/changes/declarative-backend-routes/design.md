## Context

See proposal.md (Why). The Backend handler is consumed only in-process by central Web
(`createBackendHandler` from the direct runtime, `createBackendServer` from tests and the
Web security-matrix integration test). Its 234 Backend tests are the behavioural safety net
for this refactor and keep their semantics; only import paths and the D5 status expectations
change.

Constraints that shape the design:

- `@memon/backend` depends only on `@memon/core`; adding `zod` as a direct dependency would
  change `pnpm-lock.yaml`, which this change must not touch. Query value checks therefore reuse
  the zod schemas `@memon/core` already exports (`ProjectNameSchema`, `ResourceIdSchema`,
  `BackendGitRefSchema`) through a `schemaCheck()` adapter and use small predicates for the
  remaining enumerations and digit patterns.
- `BackendStreamService.openByteStream()` is synchronous and Web calls it directly, so the
  projectFs-backed implementation must still return a `Readable` synchronously.
- `packages/core/src/backend-protocol.ts` stays unchanged (no route-table type is needed there).

## Goals / Non-Goals

**Goals:** one route declaration per path; one request pipeline; domain handler modules;
one error→HTTP mapping per error class; one containment resolver; `server.ts` ≤ 400 lines and
every route module ≤ 800 lines.

**Non-Goals:** removing the in-process HTTP/Bearer/actor-header shell (see Future); changing
DTOs, route paths, capabilities or authorization semantics; changing Web.

## Decisions

### D1. Route table entry

```ts
type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type RouteClassPolicy = 'none' | 'actor' | 'read' | 'mutating' | 'shell'

interface BackendRoute {
  key: string                                   // template, e.g. `${BACKEND_API_PREFIX}/runs/[id]`
  params?: Record<string, (decoded: string) => string | null>   // per-placeholder parser
  query: QuerySpec | ((method: string) => QuerySpec)
  unknownMethod?: 'not-found'                   // Project data reads answer 404, not 405
  operations: Partial<Record<HttpMethod, RouteOperation>>
}
interface QuerySpec {
  fields: Record<string, { check: (value: string) => boolean; required?: boolean }>
  refine?: (values: Record<string, string>, input: { method: string; params: RouteParams }) => boolean
}
interface RouteOperation {
  routeClass: RouteClassPolicy                  // 'none' = no actor (meta/events); 'actor' = decode only
  readOnly: 'refuse' | 'allow'                  // 'allow' = share admin + wiki review marks
  project?: 'query' | 'path' | 'path-or-query'  // authorization target
  available?: (ctx) => HttpError | null         // capability/service gate
  failure: HttpError                            // status for unclassified errors
  handle: (ctx: RouteContext) => Promise<void>
}
```

The table is the concatenation of the domain modules' arrays. `BACKEND_ROUTE_ALLOW_LIST` and
every `BACKEND_*_ROUTE` constant remain exported; the allow-list is derived from the table.
Every query key may occur at most once (the legacy validator already rejected every duplicate).

Path matching: exact literal templates first, then templates with placeholders ordered by
literal-segment count (so `shares/validate` precedes `shares/[id]`); the first structural match
decides, and a parameter parse failure is a 404 without trying other templates — the same rule
the legacy regex chain applied. `[...name]` placeholders decode per segment.

*Alternative considered:* one entry per `(path, method)`. Rejected because the legacy query and
405/404 decisions are evaluated per path before the method is known.

### D2. Proving parity before deletion

The legacy allow-list, regex resolver, query validator and the family key lists move verbatim
into `legacy-routes.ts`, together with a `legacyPreflight()` that is the unchanged decision
sequence (resolve → query → project-data method rule → 405 → read-only) and a `legacyRouteClass()`
transcribed from the legacy branches. `route-table.test.ts` generates a deterministic corpus
(every template × valid/invalid/encoded parameters × all methods × seeded random query sets drawn
from per-key valid/invalid/empty/duplicate values, plus hand-written edge cases) and asserts that
the new `preflight()` returns the same outcome, route key, parameters, `Allow` set, route class
and read-only decision for both read-only modes. It also records a SHA-256 digest of the full
outcome list. When the legacy file is deleted, the test keeps the corpus and asserts the recorded
digest, so the table cannot drift silently. The only intentional divergence — literal template
paths — is excluded from the comparison and asserted separately.

### D3. Pipeline order

`createRouteHandler(table, options)`:

1. Parse target; malformed target inside the namespace authenticates first (401) then 404.
2. Outside `/api/backend/v1` → 404. Service Bearer authentication → 401.
3. Canonical origin-form path (no dot-segment aliasing, no fragment) → else 404.
4. Route match + parameter parse → else 404. Query spec → else 404.
5. Method: not served → 404 for `unknownMethod: 'not-found'`, else 405 + `Allow`.
6. Read-only Backend and a non-GET/HEAD operation with `readOnly: 'refuse'` → 403.
7. `available(ctx)` gate (service/capability) → its declared error.
8. Actor decode (unless `routeClass: 'none'`); authorization against the operation's target
   project for `read`/`mutating`/`shell`.
9. `handle(ctx)`; any throw → if headers were sent, end the response; otherwise `toHttpError`
   (D5) or the operation's `failure`.

Steps 7–8 run in the same order as every legacy branch (gate, then actor, then authorization).
The eleven duplicated `BackendActorContextError` catches become step 8. Actor errors in the
Run/Experiment mutation branches used to fall into a generic `400 BAD_REQUEST` with a
branch-specific message; they now carry the decoder's own message with the same status and code.

### D4. Modules

```
src/server.ts                 assemble table, createBackendHandler/createBackendServer, re-exports
src/http/paths.ts             BACKEND_* constants, size limits
src/http/options.ts           BackendServerOptions, resolveOptions
src/http/auth.ts              service Bearer authentication
src/http/route.ts             route types, matcher, query evaluation, preflight
src/http/pipeline.ts          createRouteHandler
src/http/respond.ts           JSON writers, bounded body readers
src/http/errors.ts            HttpError, toHttpError
src/http/streaming.ts         SSE, byte ranges, log streams, control deadline
src/routes/projects-shares.ts meta, Project discovery, shares, share validation, Slurm
src/routes/runs-experiments.ts Run/Experiment reads, Journal, mutations, warnings
src/routes/documents-wiki.ts  Reports, code reviews, READMEs, Wiki, Wiki review
src/routes/git.ts             Git reads, commit marks, code preview
src/routes/stream-assets.ts   events, logs, Report/Wiki assets
src/routes/index.ts           BACKEND_ROUTES = concatenation
src/containment.ts            isContained / resolveContained
```

`server.ts` imports only `./http/*` and `./routes/*`; a package-boundary test forbids it from
importing any `*-service` module (D7).

### D5. One error mapping

`toHttpError(error)` holds one mapper per error class (`BackendControlBodyError`,
`BackendActorContextError`, `JournalRecordingError`, `BackendMutationError`,
`BackendProjectServiceError`, `BackendDocumentServiceError`, `BackendGitServiceError`,
`BackendStreamServiceError`, `BackendStreamDeadlineError`, `WikiReviewOrderError`,
`WikiReviewError`, `ShareNotFoundError`, `AmbiguousShareError`); unknown errors use the
operation's declared `failure` (500, 503, or 400 for body-schema failures on mutation routes,
exactly as before). Mappers live in the Backend HTTP layer rather than as methods on the error
classes so the services (also used by Web directly and by core) stay HTTP-free and the core-owned
classes are not modified. The spec had no prior status rule for `INVALID_RESOURCE`; the decided
400 is now specified (delta).

Status changes (all others unchanged):

| Route(s) | Error | Before | After |
|---|---|---|---|
| Runs, Run, Experiments, Experiment, Run files, Experiment results, Hypotheses, Journal, Anomalies (GET) | `BackendProjectServiceError INVALID_RESOURCE` | 422 `BAD_REQUEST` | 400 `BAD_REQUEST` |
| Journal history | `BackendProjectServiceError INVALID_RESOURCE` | 404 `NOT_FOUND` | 400 `BAD_REQUEST` |
| Run / Experiment README (GET, PUT) | `BackendProjectServiceError INVALID_RESOURCE` | 404 `NOT_FOUND` | 400 `BAD_REQUEST` |
| Project data reads | `BackendActorContextError` with status 401 | 401 `BAD_REQUEST` | 401 `UNAUTHORIZED` |
| Experiment create/delete/link/unlink, Run/Experiment status+archive, warnings | `BackendControlBodyError` (body too large) | 400 `BAD_REQUEST` | 413 `PAYLOAD_TOO_LARGE` |
| Run/Experiment status+archive | `BackendMutationError BAD_REQUEST` | 404 `NOT_FOUND` | 400 `BAD_REQUEST` |
| Run/Experiment status+archive, warnings | `BackendMutationError BAD_STATE` | 404 `NOT_FOUND` | 409 `CONFLICT` |
| Run/Experiment status+archive, warnings | `BackendMutationError PARTIAL` / `INTERNAL` | 404 `NOT_FOUND` | 500 `PARTIAL` / `INTERNAL` |
| Run/Experiment status+archive, warnings | `JournalRecordingError` | 400 `BAD_REQUEST` | 500 `<journal code>` |
| Experiment create/delete/link/unlink | `BackendProjectServiceError` / `BackendDocumentServiceError` leaking from the service | 400 `BAD_REQUEST` | 400 / 404 / 409 per class |
| Project data reads | `BackendDocumentServiceError` leaking from the service | 500 `INTERNAL` | 400 / 404 / 409 per class |
| any route | literal template path (e.g. `/runs/[id]`) | aliased the route (e.g. `/projects/[project]/shares` answered metadata) | 404 `NOT_FOUND` |

5xx messages are normalized ("Backend mutation failed"); 4xx messages for the same class are the
class's single message. Web was checked read-only: no client branch depends on 422 or 404 from
these Backend routes (Web's 422 checks are for `ARCHIVE_RUNNING_FORBIDDEN` and for the standalone
results route, which maps the service error itself).

### D6. Containment and byte streams

`containment.ts` exports `isContained(root, target)` (pure lexical rule shared by every caller,
including the SSH command-path mapper) and `resolveContained(projectRoot, relPath, { allowMissing })`
(lexical check, `projectFs.realpath` of root and target, containment of the real path; returns
`null` for a missing path when allowed, throws `PathContainmentError` on escape). Document, Git
and stream services translate `PathContainmentError` into their own `INVALID_RESOURCE`.
`FilesystemStreamService.openByteStream()` returns a `PassThrough` immediately and fills it from
`projectFs.open(path, 'r')` → `FileHandle.createReadStream({ start, end, highWaterMark })`;
destroying the returned stream before the open resolves closes the handle. Inside a Project file
context this applies the store's containment and read-only checks; outside one it is the native
open, as before.

## Risks / Trade-offs

- [Behaviour drift during the move] → parity test against the verbatim legacy code, then a
  digest-pinned corpus; all 234 existing tests stay green at every commit.
- [Clients relying on 422] → Web checked; the change is specified in the delta and listed above.
- [Byte stream open becomes asynchronous inside the stream] → open errors surface as stream
  errors, which `pipeline()` already converts into a destroyed response (unchanged handling).

## Migration Plan

Central-only release (PATCH bump by the release agent). Rollback is a revert of the commits;
no data or configuration changes.

## Future: direct service calls (`direct-service-calls`)

Web currently builds an `IncomingMessage` from a `Request`, mints a per-process Bearer token,
encodes the actor into a header, maps its public route to a Backend path and lets this handler
re-authenticate and re-route — two route tables and two authorization passes per request.
Recommended follow-up: expose the table's operations as typed service calls
(`invoke(routeKey, method, { actor, project, params, query, body })`) that run steps 6–9 of the
pipeline without HTTP framing, let Web's route layer call them directly, then delete the Bearer
token, actor header codec and `backend-route.ts` mapping. Byte and SSE operations keep returning
Node streams. This change prepares that by making the operations self-describing.
