## MODIFIED Requirements

### Requirement: Central keeps a rebuildable summary index validated by fingerprints

The central process SHALL keep, per Project, an in-memory index of parsed
summaries — Run README summaries (path, status, `updated_at`, `deprecated`,
`archived`, README fingerprint), Experiment READMEs and bundles, wiki pages,
Reports, code reviews, hypotheses, the Journal event count, directory listings
and the Run walk. Each entry SHALL be keyed by a stat fingerprint (device,
inode, size, modification and change time; a fingerprint seeded from the
derived index omits the device) and SHALL be re-read only when the
fingerprint changes or the entry is missing. For FS v8 Projects the Run,
Experiment, wiki and walk entries SHALL be seeded on first use from the
merged derived index (snapshot plus unmerged events) with their recorded
verification times, and central SHALL write validated changes back through
derived-index compaction; all other entries are populated on demand. The
index SHALL never be populated by a startup scan of project files, SHALL be
droppable at any time without changing any response, and is never a source of
truth; files edited by tools other than memon SHALL be picked up through the
fingerprint.

Validation windows: the documents a detail page shows (the Experiment README
and its YAML documents, the requested Run README, wiki page, Report or code
review) SHALL always be read from disk for that request. Central list and
inventory reads, and the member facts of an Experiment detail (status,
archival, deprecation and eligibility errors of its declared Runs), MAY reuse
an entry, listing or Run walk validated within the last 60 s, and a Run
summary whose status is terminal (`FINISHED`, `FAILED`, `INTERRUPTED`)
validated within the last 300 s; an Experiment detail SHALL NOT stat or read
each member on every request. Two exceptions SHALL re-validate the member
entries of an Experiment detail before it is served: an explicit user refresh
of that detail (the manual refresh of `file-operation-scheduler`, which re-takes
each member's fingerprint for that request), and any successful central write
to the Experiment or to one of its Runs (through the invalidation below). A
write made by a CLI node reaches central through its index event and is
applied at the next background validation cycle (at most 60 s while the
Project is active), or earlier by the member's own window. While a Project is active (a request within
the last 10 minutes) central SHALL re-validate entries in the background so
that an external edit reaches every central list within 5 minutes; after an
idle period or a restart, lists MAY be served from the seeded entries while
the first background validation runs. Any successful mutating request handled
by central for a Project SHALL invalidate that Project's in-memory index so
the next read re-validates every entry. Readers outside central (standalone
routes, the CLI) SHALL validate every entry on every request.

#### Scenario: Cold Experiment detail
- **GIVEN** an FS v8 Project with a current derived index and an Experiment declaring 448 Runs
- **WHEN** a freshly started central process serves that Experiment's detail
- **THEN** it reads the Experiment's own documents and the index, and reads no member Run README and stats no member

#### Scenario: Member status within the window
- **GIVEN** an Experiment detail served 20 s ago and a member Run whose README a script rewrote to `FINISHED` 10 s ago
- **WHEN** the detail is requested again without a refresh
- **THEN** the Experiment's own documents are read again and the member may still show its previous status until its window elapses or the next validation cycle

#### Scenario: Explicit refresh re-validates members
- **WHEN** the user explicitly refreshes the same Experiment detail
- **THEN** every member's fingerprint is re-taken for that request and the member shows `FINISHED`

#### Scenario: Central write invalidates
- **WHEN** a member Run's status is set through central and the Experiment detail is requested next
- **THEN** the detail shows the new status

#### Scenario: Warm Experiment detail
- **GIVEN** an Experiment declaring 448 Runs whose summaries are indexed and were validated within the window
- **WHEN** its detail is requested again and no Run README changed
- **THEN** member eligibility costs no README read

#### Scenario: External edit reaches the list
- **WHEN** a script outside memon rewrites a Run README's `status` while the Project is active
- **THEN** every central list that shows it reflects the change within 5 minutes, and the Run detail reflects it on the next request

#### Scenario: Central write
- **WHEN** an Experiment status is changed through central
- **THEN** the next Experiment list request re-validates and shows the new status

#### Scenario: Unreadable eligibility metadata
- **WHEN** a declared member's README exists but cannot be read or has malformed eligibility frontmatter
- **THEN** the Experiment detail reports the eligibility failure as before instead of treating the Run as eligible

## ADDED Requirements

### Requirement: Cold central reads meet the FS v8 targets

On an FS v8 Project with a current derived index, a freshly started central
process SHALL render list pages without a Run walk, and the following cold
costs, counted as Node filesystem calls under the Project root by the
read-only offline harness used for the 7.4.0 measurements with the background
validator disabled, SHALL hold on the measured project (about 1,300 Runs, a
448-member Experiment, 36 wiki pages): Experiment detail of the 448-member
Experiment ≤ 100; wiki list ≤ 200; anomalies ≤ 200. Warm and heartbeat costs
SHALL NOT exceed the 7.4.0 measurements. The background validator's cost per
cycle SHALL be reported alongside. Claims SHALL name the measured scenario as
the stage-one bounded-acceptance requirement demands.

#### Scenario: Restarted central opens the wiki list
- **GIVEN** a current derived index and a freshly started central process
- **WHEN** the wiki list is requested
- **THEN** no Run walk is performed and the harness counts at most 200 calls

#### Scenario: No index yet
- **GIVEN** an FS v8 Project whose index is missing
- **WHEN** the same pages are requested
- **THEN** they render with 7.4.0 costs and no error, and a rebuild is scheduled
