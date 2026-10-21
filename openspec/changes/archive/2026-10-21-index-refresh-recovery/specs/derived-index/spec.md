## ADDED Requirements

### Requirement: Refresh publishes every catalog or nothing

A plain `memon refresh` SHALL build the snapshot and the Experiment, Wiki and Report catalog entries before writing any of them. When any Wiki page or Report cannot be indexed — its directory or file name does not carry a valid identity, its frontmatter or manifest cannot be parsed, a required manifest field is missing, or two documents claim the same ID — the command SHALL write nothing, leave the previously published snapshot and catalogs unchanged, report every such document with its project-relative path and reason in one response, and exit non-zero. Content diagnostics that do not prevent indexing SHALL be published together with the catalogs, listed in the response and still make the command exit non-zero. The response SHALL state whether the index was published and SHALL count Runs, Experiments, Wiki pages and Reports.

#### Scenario: Two unindexable Reports
- **GIVEN** a published index and two new Report bundles whose manifests lack a title, plus one new valid Wiki page
- **WHEN** the agent runs `memon refresh`
- **THEN** the command exits non-zero, lists both Report paths with "manifest title is required", reports that nothing was published
- **AND** the snapshot and all three catalogs are byte-identical to before

#### Scenario: Content diagnostics still publish
- **WHEN** a Wiki page uses a status outside its kind's vocabulary and everything else is indexable
- **THEN** the catalogs are published including that page, the diagnostic is listed and the command exits non-zero

### Requirement: Refresh can check the published index without writing

`memon refresh --check` SHALL build the snapshot and the three catalogs in memory, compare them with the published catalogs by ID, resource and document modification time, and write nothing. It SHALL list entries missing from, extra in, or changed against each published catalog, missing or unreadable catalogs, and every document that cannot be indexed, and SHALL exit zero only when all three catalogs are current. Targeted `memon refresh <experiments…>` SHALL be documented as republishing only those Experiments' results and records, not the Wiki and Report catalogs.

#### Scenario: New page not yet published
- **GIVEN** a published index and a new `docs/wiki/finding/W0004-x/README.md`
- **WHEN** the agent runs `memon refresh --check`
- **THEN** it reports `W0004` missing from the Wiki catalog and exits non-zero, and no file under `.memon/index/` changes
- **WHEN** the agent then runs `memon refresh` followed by `memon refresh --check`
- **THEN** the check reports the index current and exits zero

### Requirement: Central tells unrefreshed documents from missing ones

When a central detail lookup for an Experiment, Wiki page or Report finds no catalog entry and the requested ID matches that kind's identity rule (`E<NNNN>-<slug>`, `W<NNNN>`, `R<NNNN>`), central SHALL inspect only the directories where a document with that ID can live (the Experiment directory itself; the Wiki kind directories; the Reports directory and its category directories), without reading document bodies or walking further. If such a document exists, the response SHALL be a 404 with code `NOT_REFRESHED` and the page SHALL show "Not refreshed" for that ID; otherwise the response SHALL be the ordinary not-found. An ID that does not match the rule SHALL receive the ordinary not-found without any inspection.

#### Scenario: Page written but not refreshed
- **GIVEN** `docs/wiki/finding/W0004-x/README.md` exists and the published Wiki catalog lacks `W0004`
- **WHEN** a reader opens `/h/<host>/p/<project>/wiki/W0004`
- **THEN** the reading pane shows "Not refreshed" and the rail remains usable

#### Scenario: Well-formed ID that does not exist
- **WHEN** a reader opens `R0099` and no Report directory or file starts with `R0099-`
- **THEN** the ordinary not-found state is shown

#### Scenario: Malformed ID
- **WHEN** a reader opens a Wiki ID such as `W!@#`
- **THEN** the ordinary not-found response is returned and no source directory is listed
