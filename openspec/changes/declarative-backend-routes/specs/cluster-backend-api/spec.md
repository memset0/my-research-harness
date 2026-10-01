## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Backend routes derive from one declarative table
The in-process Backend request handler SHALL resolve every route from a single declarative route table. Each entry SHALL declare its path pattern and parameter validation, its accepted query parameters, the methods it serves and, per method, its actor route class (`read`, `mutating` or `shell`, or none for instance metadata and events), its read-only policy and its handler. Path resolution, query validation, the method allow-list, the `405` `Allow` header, route-class authorization and the read-only refusal SHALL all be derived from that table; no second list of routes, methods or query rules SHALL exist.

Requests SHALL be evaluated in this order: service authentication, canonical-path check, route match, query validation, method check, read-only policy, capability availability, actor-context decoding, actor authorization, handler. A path that does not match a registered pattern, whose parameters fail validation, or whose query carries an unregistered, duplicated or invalid parameter SHALL return `404` `NOT_FOUND`. A literal template path (for example one containing `[id]`) SHALL NOT resolve to a route.

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
- **WHEN** a request targets a path that spells a template literally, such as `/runs/[id]`
- **THEN** the response is `404` `NOT_FOUND`
