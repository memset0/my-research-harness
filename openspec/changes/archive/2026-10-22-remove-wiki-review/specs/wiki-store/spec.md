## REMOVED Requirements

### Requirement: Wiki review is a commit-ordered human verification of `docs/wiki/`

**Reason**: Human Wiki review and its Git-derived verification workflow are retired.
**Migration**: Existing review CSV files can remain as inert historical files. Readers and writers do not consult them; use ordinary Wiki content and Git history without review marks.

### Requirement: Page review state is derived from verified commits and the working tree

**Reason**: Human Wiki review and its Git-derived verification workflow are retired.
**Migration**: Existing review CSV files can remain as inert historical files. Readers and writers do not consult them; use ordinary Wiki content and Git history without review marks.

## MODIFIED Requirements

### Requirement: Backlinks are derived from sources

The system SHALL expose, for any Experiment id, the list of wiki pages whose `sources` reference it (by bare id, id-with-slug, or Variant form), each with `id`, `slug`, `kind`, `title`, `status`, `stale`. `GET /api/experiments/<id>` SHALL include this list as `citedBy`, ordered by `updated_at` descending.

#### Scenario: Experiment detail lists citing pages
- **GIVEN** `W0004` (finding) and `W0009` (bottleneck) both cite `E0017`
- **WHEN** `GET /api/experiments/E0017-fused-attention` is requested
- **THEN** `citedBy` contains exactly `W0009` and `W0004` ordered by `updated_at` descending

### Requirement: GET /api/wiki?project=NAME lists all pages

`GET /api/wiki?project=<name>` SHALL return `{ pages: WikiSummary[] }` where `WikiSummary` includes `id`, `slug`, `kind`, `title`, `description` (nullable), `status` (nullable), `date` (nullable), `tags`, `sources`, `legacyId` (nullable), `stale`, `staleSources`, `format`, `mtime`, `updatedAt`, and `diagnostics` (code + severity + message). Pages SHALL be ordered by kind in canonical order (unknown kinds last, alphabetically), then `updated_at` descending. The response SHALL NOT include page bodies and SHALL be served from the runtime cache.

#### Scenario: Empty wiki
- **WHEN** `docs/wiki/` is empty or missing
- **THEN** the API returns `{ pages: [] }` with HTTP 200

#### Scenario: Canonical kind ordering
- **GIVEN** pages of kinds `note`, `meeting`, `finding`, `retro`
- **WHEN** the wiki is listed
- **THEN** the order of kinds is `meeting, finding, note, retro`

### Requirement: PUT /api/wiki/[id]?project=NAME writes with mtime+hash optimistic lock

`PUT /api/wiki/<id>?project=<name>` with body `{ content, expectedMtime, expectedHash }` SHALL atomically replace the file via a `.tmp.<random>` sibling and rename, and return `{ ok: true, mtime, hash }`. When on-disk mtime or hash differ from the expected values it SHALL return 409 `CONFLICT` with `currentMtime`, `currentHash`, `currentContent`. The target path SHALL pass project-root containment; escapes return 403 `FORBIDDEN`. A write whose new content changes `id` or `kind` SHALL be rejected with 400 `BAD_REQUEST` (identity is changed only through `memon wiki move`).

#### Scenario: Successful write
- **WHEN** PUT carries matching `expectedMtime` and `expectedHash`
- **THEN** the file is rewritten and the response carries the new `mtime` and `hash`

#### Scenario: Stale write
- **GIVEN** the file changed on disk after the client read it
- **WHEN** PUT arrives with the old values
- **THEN** the response is 409 with the current mtime, hash, and content

#### Scenario: Identity change rejected
- **WHEN** PUT content changes `id: W0004` to `id: W0040`
- **THEN** the response is 400 and the file is unchanged

### Requirement: Opening one page does not wait on project-wide work

A single-page read (`GET /api/wiki/<id>`) and the projection returned after a page write SHALL NOT read review ledgers or invoke Git to derive a review state. The inventory of Run directories that bare Run citations and `@` Run mentions resolve against SHALL be shared by every wiki projection of a Project (list, single page, write, backlinks): concurrent projections SHALL share one directory walk, and once an inventory exists it SHALL be served immediately while a walk older than a short refresh age runs in the background. Failure of a background refresh SHALL keep the last successful inventory. Reads of cited Run metadata SHALL be issued with bounded concurrency, so a projection citing many Runs does not delay the file operations of a concurrent single-page read until all of its own reads finish. The metadata of cited Runs SHALL still be read at request time, so staleness of an already-resolved citation is always current; only whether a newly created or removed Run directory exists may lag by one refresh.

#### Scenario: Page and list requested together
- **GIVEN** a Project with many Run directories and no inventory cached yet
- **WHEN** the page `W0004` and the wiki list are requested concurrently
- **THEN** the Run directories are walked once and both responses use that walk

#### Scenario: Warm page open
- **GIVEN** a Run inventory was built by an earlier wiki request
- **WHEN** `W0004` is requested again
- **THEN** the response is built from the cached inventory without waiting for a new walk
- **AND** an inventory older than the refresh age is refreshed in the background for later requests

#### Scenario: Single page review
- **WHEN** `W0004` is requested from a wiki of 30 pages
- **THEN** no review ledger or Git history is read and no review field is returned

## ADDED Requirements

### Requirement: Wiki content is independent of human review

Wiki list, page, write, lint and backlink operations SHALL ignore existing human-review ledgers and legacy review metadata. They SHALL NOT invoke Git HEAD, log, status or blame for verification and SHALL NOT emit review-derived warnings or response fields. Wiki review CLI commands and API operations SHALL no longer be exposed. Other Git history functionality SHALL remain available.

#### Scenario: Existing review data is inert
- **GIVEN** a page marked `status: VERIFIED` and an old `.memon/wiki-review.csv`
- **WHEN** the page is read or linted
- **THEN** its declared status remains readable without a human-review warning and the CSV is neither read nor modified

#### Scenario: Review commands removed
- **WHEN** CLI help or Wiki routes are inspected
- **THEN** there is no Wiki review log, diff, verify or unverify operation
