## ADDED Requirements

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
