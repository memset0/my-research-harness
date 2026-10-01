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
