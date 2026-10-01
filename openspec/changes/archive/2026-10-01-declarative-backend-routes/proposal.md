## Why

`packages/backend/src/server.ts` has grown to ~3300 lines: one closure dispatches ~57 routes, the route set is written out three times (a constant allow-list, a regex resolver and a per-route query validator), actor-context decoding and its error mapping are copied into eleven branches, and the same domain error maps to different HTTP statuses depending on which branch caught it (`INVALID_RESOURCE` is 422 on Project reads, 404 on README and Journal-history reads and 400 on documents; a 401 actor error carries code `BAD_REQUEST`). Path containment is likewise re-implemented in five service files, and byte-asset streams open files with `node:fs` outside the Project file facade. Every new route has to be added in three places and every new error class in eleven, which is how these inconsistencies appeared.

## What Changes

- Replace the three hand-written route tables with one declarative route table. Each entry declares its path pattern and parameter parsers, its query schema, its per-method route class, read-only policy and handler. Path resolution, query validation, method allow-list (including the public `BACKEND_ROUTE_ALLOW_LIST`), route-class authorization and the read-only check are all derived from it. A parity test proves the new table agrees with the legacy tables before they are deleted.
- Route every request through one pipeline: service authentication → canonical path → route match → query → method → read-only policy → availability → actor decode → authorization → handler → error mapping. Handlers receive validated parameters and return or throw domain errors only.
- Split route handlers into resource-domain modules (projects/shares, runs/experiments, documents/wiki, git, streams/assets); `server.ts` only assembles the table and exports the handler factories. Public exports and signatures (`createBackendHandler`, `createBackendServer`, route constants, option types) are unchanged.
- Map each error class to an HTTP error in exactly one place. **Wire change**: a request that names a malformed resource returns **400 `BAD_REQUEST`** on every route (was 422 on Project reads and 404 on README / Journal-history reads); a 401 actor-context failure carries code `UNAUTHORIZED` everywhere; oversized JSON bodies on Run/Experiment mutation routes return 413 `PAYLOAD_TOO_LARGE` (was 400); state/partial/internal mutation failures on status, archive and warning routes return 409/500 like the other mutation routes (were 404). A literal `[param]` template path is no longer an alias of the route.
- Share one containment resolver across the Backend services and stream asset bytes through the Project file facade (`projectFs.open`) instead of raw `node:fs`, keeping the synchronous `openByteStream` signature and streaming semantics.
- Add a package-boundary assertion that `server.ts` imports no service implementation.
- Out of scope: removing the in-process HTTP/Bearer shell between Web and Backend (follow-up change `direct-service-calls`, see design.md Future).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `cluster-backend-api`: the safety requirement gains consistent error-status rules (malformed identifiers are 400, one mapping per error), and a new requirement makes the declarative route table the single source of route resolution, query validation, route class and read-only policy.

## Impact

- Code: `packages/backend/src/**` only (new `http/` and `routes/` modules, slimmer `server.ts`, shared `containment.ts`, `stream-service.ts`, `document-service.ts`, `git-service.ts`, `execution-service.ts`). No change to `packages/core`, `apps/web`, `packages/cli`.
- Wire: the status-code changes listed above, visible to central Web through the in-process handler. No Web code branches on the old 422/404 values for these routes (verified read-only); the standalone Web results route keeps its own 422 `INVALID_RESULTS` envelope.
- Release surface: central only (Backend is consumed in-process by Web); no CLI, skills or filesystem change.
