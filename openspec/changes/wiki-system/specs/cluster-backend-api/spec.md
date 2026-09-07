## ADDED Requirements

### Requirement: Backend serves the wiki document kind

`wiki` SHALL be a Backend document kind in addition to `report`, which SHALL remain available with its existing routes, envelopes, and `reportAssets` capability. The versioned namespace SHALL expose authenticated wiki list, single-page read, single-page write, single-page review, and bundle-asset operations whose request and response envelopes carry the same fields as the dashboard contract in `wiki-store`: the summary projection (`id`, `slug`, `kind`, `title`, `status`, `date`, `tags`, `sources`, `legacyId`, `stale`, `staleSources`, `reviewState`, `reviewedAt`, `mtime`, `updatedAt`, `format`, `diagnostics`) for list entries, plus `hash` and `content` for a single page. Both directions SHALL be runtime-validated and SHALL omit cluster absolute paths, addressing pages by `W<NNNN>` id within a Host-qualified Project. A page write SHALL carry `expectedMtime` and `expectedHash` and, on mismatch, SHALL return the conflict envelope (`currentMtime`, `currentHash`, `currentContent`) without modifying the file; it SHALL reject changes to `id`, `kind`, and the review keys. The review operation (`POST` on the page's `review` sub-route) SHALL compute the review hash Backend-side, SHALL be accepted only for an owner actor context, and SHALL return 403 for a viewer actor context. Backend metadata SHALL advertise a `wikiAssets` capability beside the existing `reportAssets` capability, and the event stream SHALL carry a `wiki-change` topic for wiki mutations, naming the local Project, beside the existing report topic. Central SHALL proxy the wiki asset route only to Backends advertising `wikiAssets`. Wiki list responses SHALL NOT include page bodies.

#### Scenario: List and detail cross the boundary
- **WHEN** central lists a Backend Project's wiki and then reads one page
- **THEN** the list validates against the summary envelope with no body and no absolute path
- **AND** the page response adds `hash`, `content`, and `diagnostics` for the addressed `W<NNNN>` id

#### Scenario: Conflicting write is refused
- **WHEN** central forwards a wiki write whose `expectedMtime`/`expectedHash` no longer match the cluster file
- **THEN** the Backend returns the conflict envelope with the current mtime, hash, and content
- **AND** the on-disk page is unchanged

#### Scenario: Capability gates asset proxying
- **GIVEN** a Backend whose metadata omits `wikiAssets`
- **WHEN** the browser requests a wiki bundle asset for one of its Projects through central
- **THEN** central does not proxy the request to that Backend
- **AND** report asset proxying for that Backend is unaffected as long as it advertises `reportAssets`

#### Scenario: Review marks are owner-only
- **WHEN** central forwards a `POST /wiki/review/<sha>` request with a viewer actor context
- **THEN** the Backend returns 403 and `.memon/wiki-review.csv` is unchanged
- **AND** the same request with an owner actor context appends the mark and returns the updated `verifiedThrough`; a read-only Backend still accepts it because the mark lives under `.memon/`, not in project documents

#### Scenario: Read-only Backend rejects wiki writes
- **GIVEN** a Backend started with `access_mode: read_only`
- **WHEN** an authenticated wiki write arrives
- **THEN** the Backend rejects it before invoking a provider, while wiki list and page reads remain available

#### Scenario: Report kind keeps serving
- **GIVEN** a Backend advertising both `reportAssets` and `wikiAssets`
- **WHEN** central lists that Project's reports and then its wiki
- **THEN** both kinds answer over their own routes with their own envelopes and neither displaces the other

## MODIFIED Requirements

### Requirement: Backend transport streams with cancellation and bounds
The Backend API SHALL stream SSE, log data, report assets, wiki bundle assets, and terminal traffic with backpressure rather than buffering or base64-wrapping complete responses. JSON/control bodies SHALL have explicit size limits. Downstream disconnect SHALL cancel upstream work, and a mutation SHALL NOT be automatically replayed after an ambiguous timeout.

#### Scenario: Large asset remains streamed
- **WHEN** central reads a large binary Report asset
- **THEN** bytes stream unchanged with bounded buffering and no base64 JSON expansion

#### Scenario: Large wiki bundle asset remains streamed
- **WHEN** central reads a large binary wiki bundle asset
- **THEN** bytes stream unchanged with bounded buffering and no base64 JSON expansion

#### Scenario: Client disconnect cancels Backend stream
- **WHEN** the browser disconnects during a long log stream
- **THEN** cancellation reaches the Backend and the abandoned stream stops consuming resources
