# project-read-performance Specification

## Purpose
Record first-stage performance improvements and truthful limits; archival is not a guarantee that all read latency is optimized.

## Requirements

### Requirement: Stage-one performance acceptance is bounded

Performance claims SHALL identify the observed operation or request scenario. Warm-cache and identity-only results SHALL NOT be represented as universal cold/detail/Git latency guarantees. Further optimization MAY follow independently of this phase's archival.

#### Scenario: Fast inventory but expensive detail
- **WHEN** identity enumeration avoids body reads but a selected detail still needs membership or Git work
- **THEN** the inventory improvement is reported without claiming the detailed work has been eliminated

### Requirement: Improvements preserve research and authorization boundaries

Read optimizations SHALL retain exact project identity, authorization, read-only data policy and source content. Cache data SHALL be rebuildable rather than a second research authority. The central primitive Store and scheduler SHALL own the accepted read architecture; this phase SHALL NOT require a parsed Backend snapshot, remote monitor or document SSE.

#### Scenario: Architecture replacement
- **WHEN** central serves a configured project directly
- **THEN** it retains the public read/share protections without deploying an old Backend cache service

### Requirement: Central keeps a rebuildable summary index validated by fingerprints

The central process SHALL keep, per Project, an in-memory index of parsed
summaries — Run README summaries (path, status, `updated_at`, `deprecated`,
`archived`, README mtime and size), Experiment READMEs and bundles, wiki pages,
Reports, code reviews, hypotheses, the Journal event count, directory listings
and the Run walk. Each entry SHALL be keyed by a stat fingerprint (device,
inode, size, modification and change time) and SHALL be re-read only when the
fingerprint changes or the entry is missing. The index SHALL be populated on
demand, never by a startup scan, SHALL NOT persist, and SHALL be droppable at
any time without changing any response; it is never a source of truth, and
files edited by tools other than memon SHALL be picked up through the
fingerprint.

Validation windows: detail reads SHALL validate every entry they use on each
request (Experiment member eligibility, a Run's parent Experiment). Central
list and inventory reads MAY reuse an entry, listing or Run walk validated
within the last 60 s, and a Run summary whose status is terminal (`FINISHED`,
`FAILED`, `INTERRUPTED`) validated within the last 300 s, so an external edit
SHALL reach every central list within 5 minutes. Any successful mutating
request handled by central for a Project SHALL invalidate that Project's
index so the next read re-validates every entry. Readers outside central
(standalone routes, the CLI) SHALL validate every entry on every request.
The Experiment, Run, wiki page, Report and code-review documents shown on a
detail page SHALL always be read from disk for that request.

#### Scenario: Warm Experiment detail
- **GIVEN** an Experiment declaring 448 Runs whose summaries are indexed
- **WHEN** its detail is requested again and no Run README changed
- **THEN** member eligibility costs one stat per member and no README read

#### Scenario: External edit reaches the list
- **WHEN** a script outside memon rewrites a Run README's `status`
- **THEN** every central list that shows it reflects the change within 5 minutes, and the Run detail reflects it on the next request

#### Scenario: Central write
- **WHEN** an Experiment status is changed through central
- **THEN** the next Experiment list request re-validates and shows the new status

#### Scenario: Unreadable eligibility metadata
- **WHEN** a declared member's README exists but cannot be read or has malformed eligibility frontmatter
- **THEN** the Experiment detail reports the eligibility failure as before instead of treating the Run as eligible

### Requirement: Project root real path is resolved once per request

Within one Backend request, path containment SHALL resolve the real path of a
Project root at most once and reuse it for every contained path the request
resolves; the real path of each target SHALL still be resolved (or its
fingerprint matched against an entry whose containment was verified) so a
symlink cannot leave the Project. The memo SHALL NOT outlive the request.

#### Scenario: Many members
- **WHEN** a request resolves 448 declared Run paths
- **THEN** the Project root real path is resolved once, not 448 times
