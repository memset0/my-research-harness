# cluster-backend-api Specification

## Purpose
Define safe central in-process project services and public document contracts; the legacy capability name does not require a remote Backend listener.

## Requirements

### Requirement: Central services preserve Wiki document contracts

Wiki SHALL remain a document kind alongside Reports, using the public list/detail/write/review/asset contracts from wiki-store. Central SHALL resolve configured host-qualified projects directly to project services; no remote Backend listener, token or capability probe SHALL be necessary. List envelopes SHALL omit bodies and absolute paths; detail envelopes SHALL include content, hash and diagnostics. Runtime validation, read-only project-data policy and owner-only review marks SHALL remain enforced.

#### Scenario: List and detail preserve their envelopes
- **WHEN** central lists a configured project's Wiki and reads a page
- **THEN** the list contains summaries and the detail adds content/hash/diagnostics without absolute paths or a remote Backend request

#### Scenario: Conflicting write is refused
- **WHEN** expectedMtime or expectedHash no longer matches the Wiki file
- **THEN** the write returns a conflict with current document state and does not alter the file

#### Scenario: Review marks are owner-only
- **WHEN** a viewer requests a Wiki review mark
- **THEN** central denies it without modifying the mark file

#### Scenario: Read-only data rejects Wiki writes
- **WHEN** a configured read-only project receives a Wiki document write
- **THEN** central rejects it while preserving authorized list/detail reads; control-plane review permission is separately enforced

#### Scenario: Report kind keeps serving
- **WHEN** a project has Reports and Wiki pages
- **THEN** both kinds retain their own routes and envelopes

### Requirement: Wiki assets preserve bounded streaming

Central Wiki asset responses SHALL retain bounded streaming, range support, cancellation and path containment. Large assets SHALL not be expanded into JSON or eagerly loaded into the document-content cache. Ambiguous mutation failures SHALL not be automatically replayed.

#### Scenario: Large Wiki bundle asset remains streamed
- **WHEN** a client reads a large binary Wiki asset
- **THEN** bytes stream unchanged with bounded buffering

#### Scenario: Client disconnect cancels stream
- **WHEN** a client disconnects during asset transport
- **THEN** abandoned stream work is canceled without affecting other resources

### Requirement: Central service mutations record activity without peer negotiation

Supported non-readonly project-service invocations SHALL record automatic activity while enforcing owner authorization, read-only project policy and path safety. Direct document submissions SHALL remain CLI-owned. This surface SHALL NOT require a remote Backend or advertise unimplemented evidence-review endpoints.

#### Scenario: Read-only project refuses a mutation
- **WHEN** a request attempts to mutate a read-only configured project
- **THEN** central rejects the research write without a remote capability probe

### Requirement: Journal authoring endpoints are removed

Central manual journal-append routes SHALL be removed along with their advertised schemas/capabilities and client helpers. Automatic native mutation receipts SHALL remain supported. New receipt diagnostic reads SHALL be owner-only; existing legacy Journal read scope SHALL not expand to include these receipts.

#### Scenario: Retired append endpoint
- **WHEN** an old client POSTs manual Journal prose
- **THEN** the request is rejected without creating legacy content or an activity receipt

### Requirement: Retired service boundary does not remove safety
Central SHALL enforce exact project authorization, read-only data mode, separately authorized share administration, path containment, runtime-validated public data and bounded streaming. Browser credentials SHALL never be forwarded to remote command targets. Ambiguous mutation failures SHALL not be automatically replayed.

Every project-service error SHALL map to the same HTTP status and error code on every route that can surface it:
- a request that names a malformed or uncontainable resource identifier SHALL return `400` with code `BAD_REQUEST`;
- a well-formed identifier that does not resolve SHALL return `404` with code `NOT_FOUND`;
- an identifier that resolves to more than one resource SHALL return `409` with code `CONFLICT`;
- a stale optimistic lock SHALL return `409` with the current document state; a mutation refused because of the resource's current state SHALL return `409` with code `CONFLICT`;
- a JSON request body over the route's size limit SHALL return `413` with code `PAYLOAD_TOO_LARGE`;
- a missing or malformed actor context SHALL return `400` with code `BAD_REQUEST`, and an actor-context failure caused by missing service authentication SHALL return `401` with code `UNAUTHORIZED`;
- a mutation that partially applied SHALL return `500` with code `PARTIAL`, and any other server-side mutation failure SHALL return `500`.

Project bytes served as asset streams SHALL be opened through the same project file access policy (containment, read-only and storage scheduling) as every other project read.

#### Scenario: Viewer mutation
- **WHEN** a viewer requests a document write or shell operation
- **THEN** central rejects it before file or command access

#### Scenario: Read only data
- **WHEN** a read-only project receives a document write
- **THEN** the write is rejected; share administration remains separately governed and physical write errors are surfaced

#### Scenario: Malformed resource identifier is a bad request on every route
- **WHEN** a Run, Experiment, Results, README, Journal-history, document, Git or stream request names a resource that the project service rejects as malformed
- **THEN** the response is `400` with code `BAD_REQUEST` instead of `422` or `404`

#### Scenario: Unauthenticated actor context carries the unauthorized code
- **WHEN** actor-context decoding fails because service authentication is missing
- **THEN** the response is `401` with code `UNAUTHORIZED` on every route, including Project data reads

#### Scenario: Oversized mutation body
- **WHEN** a Run or Experiment status, archive, warning, create, delete, link or unlink request sends a JSON body over its size limit
- **THEN** the response is `413` with code `PAYLOAD_TOO_LARGE`

#### Scenario: State-refused status or warning mutation
- **WHEN** a status, archive or warning mutation is refused because of the resource's current state, or applies only partially
- **THEN** the response is `409` `CONFLICT` or `500` `PARTIAL` respectively, the same as for Experiment create/delete/link mutations, instead of `404`

#### Scenario: Asset bytes respect the project file policy
- **WHEN** a Report or Wiki bundle asset is streamed
- **THEN** the file is opened through the project file access policy, still streams in bounded chunks and still honours byte ranges and client cancellation

### Requirement: Central detail preserves the safe v6 document contract
Central Experiment detail SHALL preserve ordered raw sections, sanitized Implementation/Investigation/Results data, canonical projections, diagnostics, read-only state and Results update metadata including bounded column/value annotations. It SHALL omit absolute filesystem authority. Lists SHALL remain summary-only. This contract SHALL not require a Backend HTTP request.

#### Scenario: Valid detail
- **WHEN** an experiment bundle parses successfully
- **THEN** central returns the data needed for canonical sections and Results without absolute paths

#### Scenario: Summary list
- **WHEN** the user requests experiment summaries
- **THEN** managed document bodies are omitted

### Requirement: Backend routes derive from one declarative table
The in-process Backend request handler SHALL resolve every route from a single declarative route table. Each entry SHALL declare its path pattern and parameter validation, its accepted query parameters, the methods it serves and, per method, its actor route class (`read`, `mutating` or `shell`, or none for instance metadata and events), its read-only policy and its handler. Path resolution, query validation, the method allow-list, the `405` `Allow` header, route-class authorization and the read-only refusal SHALL all be derived from that table; no second list of routes, methods or query rules SHALL exist.

Requests SHALL be evaluated in this order: service authentication, canonical-path check, route match, query validation, method check, read-only policy, capability availability, actor-context decoding, actor authorization, handler. A path that does not match a registered pattern, whose parameters fail validation, or whose query carries an unregistered, duplicated or invalid parameter SHALL return `404` `NOT_FOUND`. A literal template path (for example one containing `[id]`) SHALL NOT resolve to its route without parameters; its bracket text is an ordinary parameter value and is validated as such.

#### Scenario: Route table is the single source
- **WHEN** a route, method or query parameter is added to the Backend
- **THEN** it is declared once in the route table and the allow-list, query validation, route class and read-only policy follow from that declaration

#### Scenario: Unregistered query parameter
- **WHEN** a request to a registered route carries a query parameter its table entry does not declare, or repeats a declared one
- **THEN** the response is `404` `NOT_FOUND` before any actor decoding or file access

#### Scenario: Method outside the table
- **WHEN** a registered route receives a method its table entry does not serve
- **THEN** the response is `405` `METHOD_NOT_ALLOWED` with an `Allow` header listing the declared methods, except Project data read routes, which answer `404` as before

#### Scenario: Literal template path
- **WHEN** a request targets a path that spells a template literally, such as `/projects/[project]/shares`
- **THEN** the bracket text is validated as the parameter value, so this request is `404` `NOT_FOUND` instead of being answered as if it had no parameters

### Requirement: Standalone Results snapshot reports invalid results with the central status

Standalone `GET /api/experiments/:id/results` SHALL answer a `results.yaml`
that exists but fails to parse or validate with status `400`, the same status
central returns for that failure. The body SHALL keep its existing shape:
`{"error":{"code":"INVALID_RESULTS","message":…},"diagnostics":[…],"updatedAt":…}`.
A missing `results.yaml` SHALL remain `404` `RESULTS_NOT_FOUND`.

#### Scenario: Malformed results.yaml in standalone
- **GIVEN** an Experiment whose `results.yaml` is not valid YAML
- **WHEN** a standalone client requests its Results snapshot
- **THEN** the response is `400` with code `INVALID_RESULTS` and the parser
  diagnostics, instead of `422`

### Requirement: Run list is paginated

`GET /api/runs` (without `inventory=1`) SHALL accept an optional `limit`
(integer 1–1000, default 200) and an optional opaque `cursor`, and SHALL return
`{ runs, nextCursor }` where `runs` holds at most `limit` Run summaries in the
existing order (created time descending, then Run path) and `nextCursor` is the
cursor for the following page or `null` on the last page. A `cursor` that does
not decode SHALL be `400`. Combining `limit` or `cursor` with `inventory=1`
SHALL be `404` like any other invalid query. Each page SHALL fit the Backend
response size limit, so the Run list SHALL NOT answer `500 PAYLOAD_TOO_LARGE`
because a Project has many Runs.

#### Scenario: Large Project
- **GIVEN** a Project with 1,300 Runs
- **WHEN** the client requests `/api/runs?project=<p>`
- **THEN** the response is `200` with 200 Runs and a non-null `nextCursor`
- **AND** following `nextCursor` until it is `null` yields every Run exactly once

#### Scenario: Bad cursor
- **WHEN** the client sends `cursor=not-a-cursor`
- **THEN** the response is `400 BAD_REQUEST`

### Requirement: Central list reads are conditional

Central list and inventory reads — Experiment list and inventory, wiki list and
inventory, anomalies, Report list and inventory, code-review inventory,
hypotheses and the Journal count — SHALL answer `200` with an `ETag` validator
and `Cache-Control: private, no-cache`. The validator SHALL be derived from the
fingerprints of every file, directory listing and Run walk the response was
built from, not from the response body. A request whose `If-None-Match` carries
a validator issued by this process for the same route and query SHALL be
answered `304` with the same `ETag` when re-validating those fingerprints finds
no change; that check SHALL NOT read any document body or recompute the
response. Unknown, foreign or changed validators SHALL get a full `200`.
Authorization, read-only policy and Project selection SHALL be evaluated before
the conditional check, so a `304` is never sent to a caller who would not get
the `200`. Detail reads are not conditional by validator and keep the existing
semantic-version protocol.

#### Scenario: Unchanged heartbeat
- **GIVEN** a client holding the Experiment list with validator `V`
- **WHEN** it repeats the request with `If-None-Match: V` and nothing changed
- **THEN** the response is `304` with `ETag: V` and no Experiment README is read

#### Scenario: Changed source
- **GIVEN** a client holding validator `V`
- **WHEN** an Experiment README changed and its fingerprint was re-validated
- **THEN** the response is `200` with the new body and a different validator

#### Scenario: Validator after restart
- **WHEN** the client presents a validator issued by an earlier process
- **THEN** the response is a full `200`

### Requirement: Run file listing resolves the Run by path

`GET /api/runs/<id>/files` SHALL locate the Run through the selected Project's
Run reference resolution (a project-relative Run path, or a unique Run
directory name), with the usual containment checks, and SHALL NOT depend on a
legacy in-memory Run index. An unknown Run SHALL be `404 NOT_FOUND`; the
response SHALL NOT carry an absolute Run path.

#### Scenario: Direct mode
- **GIVEN** central serves a Project directly and has no legacy Run index
- **WHEN** the client requests `/api/runs/logs%2F<run>/files?project=<p>&depth=3`
- **THEN** the response is `200` with the Run's file tree
