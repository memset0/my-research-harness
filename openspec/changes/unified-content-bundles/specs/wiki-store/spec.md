## MODIFIED Requirements

### Requirement: Wiki pages live under `docs/wiki/<kind>/W<NNNN>-<slug>`
Wiki SHALL discover legacy standalone Markdown and folders under docs/wiki/<category>/W<NNNN>-<slug>. Folders SHALL accept README.md or manifest.json, with manifest precedence. IDs and slugs SHALL remain unique and old files SHALL remain readable without migration. Arbitrary category directory names SHALL be allowed. Manifest titles and identity SHALL be validated without requiring Markdown sections or legacy per-kind statuses.

#### Scenario: Three presentation forms
- **WHEN** a category contains a Markdown folder, HTML manifest folder and service manifest folder
- **THEN** all three are listed and addressable by their W identity

#### Scenario: Existing file
- **WHEN** an existing standalone Wiki file is opened after upgrade
- **THEN** it remains readable at its previous route

#### Scenario: Both forms discovered
- **GIVEN** `docs/wiki/finding/W0003-vsa-debt.md` and `docs/wiki/showcase/W0004-kernel-map/README.md`
- **WHEN** the project's wiki is listed
- **THEN** both pages appear, with `format` `markdown` and `bundle` respectively

#### Scenario: Prefix disagrees with frontmatter
- **GIVEN** `docs/wiki/note/W0009-alpha.md` whose frontmatter says `id: W0008`
- **WHEN** the project's wiki is listed
- **THEN** the page appears with a `WIKI_ID_MISMATCH` diagnostic

#### Scenario: Unknown kind is tolerated
- **GIVEN** `docs/wiki/retro/W0005-sprint-3.md`
- **WHEN** the project's wiki is listed
- **THEN** the page appears with `kind: "retro"` without an unknown-category diagnostic

#### Scenario: Duplicate slug is an error
- **GIVEN** `docs/wiki/note/W0006-alpha.md` and `docs/wiki/finding/W0007-alpha.md`
- **WHEN** the project's wiki is listed
- **THEN** both pages appear and each carries a `WIKI_SLUG_DUPLICATE` diagnostic

### Requirement: Recommended sections are advisory
Wiki authoring SHALL use free-form prose. Missing legacy kind-specific headings, maintenance-rule lists or literal evidence tokens SHALL NOT produce diagnostics. Kinds remain labels for compatible reads, not templates that require boilerplate.

#### Scenario: Concise finding
- **WHEN** a finding is expressed in a short paragraph without prescribed H2 headings
- **THEN** it is readable without missing-section or missing-evidence-token warnings

#### Scenario: Finding without Limits
- **GIVEN** a finding has only Claim and Evidence headings
- **WHEN** the page is linted
- **THEN** no missing-section warning is produced

#### Scenario: Chinese page keeps English headings
- **GIVEN** a Chinese page uses English headings with Chinese prose
- **WHEN** the page is linted
- **THEN** no section-format diagnostic is produced

#### Scenario: Chinese finding headings
- **GIVEN** a Chinese page uses Chinese headings
- **WHEN** the page is linted
- **THEN** no English-heading requirement is imposed

### Requirement: Page frontmatter carries identity, kind, status, and sources
Markdown pages SHALL accept identity, kind/category, title, explicit-offset timestamps and optional maintenance metadata. Legacy kind-specific status, sources and date SHALL be optional; supplied values SHALL remain validated. Unknown metadata SHALL survive writes. New CLI pages SHALL default to README folder bundles and a title without fabricated status or prescribed body sections. Arbitrary safe category directories SHALL be accepted.

#### Scenario: Agent creates a small current page
- **WHEN** an agent creates a Wiki page in a topic category
- **THEN** the CLI writes a README bundle with explicit-offset times and an editable title, without boilerplate sections or inferred research status

#### Scenario: Valid finding
- **GIVEN** a finding declares status VERIFIED and valid evidence sources
- **WHEN** its metadata is validated
- **THEN** no metadata diagnostic is produced

#### Scenario: Wrong status vocabulary
- **GIVEN** a legacy bottleneck page explicitly declares status VERIFIED
- **WHEN** it is validated
- **THEN** it remains readable with WIKI_STATUS_INVALID

#### Scenario: Custom keys survive a write
- **GIVEN** a page has additional author metadata
- **WHEN** it is rewritten through a supported writer
- **THEN** those fields remain intact

#### Scenario: Chinese page
- **GIVEN** a page declares language zh
- **WHEN** it is listed
- **THEN** its effective language is zh

#### Scenario: Unknown language
- **GIVEN** a Markdown page declares language fr
- **WHEN** it is validated
- **THEN** WIKI_LANGUAGE_INVALID is reported while the effective language remains en

## ADDED Requirements

### Requirement: Explicit content freshness takes precedence
An explicit CURRENT or STALE declaration SHALL take precedence over legacy source timestamp hints and SHALL be exposed with its reason. A source update SHALL NOT silently invalidate evidence or rewrite a declared freshness state.

#### Scenario: Current page with newer source
- **WHEN** a page explicitly declares CURRENT and a cited experiment receives an unrelated update
- **THEN** the declared freshness remains CURRENT

### Requirement: Wiki deletion requires repaired inbound references
The CLI SHALL provide `memon wiki delete <id>` after a user retirement decision. It SHALL resolve actual inbound references only in documents under `docs/wiki/`, `docs/reports/` and `docs/experiments/` (including Experiment details), including supported mentions, Markdown paths and web routes, metadata sources and HTML links. It SHALL report each blocking source and location/field, exclude the target's own internal links and code examples, and distinguish other projects' identities. External links to bundle assets SHALL block deletion or require asset handoff. No force option or automatic reference rewriting SHALL be provided.

Deletion SHALL hold the common project writer lock, revalidate document fingerprints, enforce realpath containment and fail closed on source errors or concurrent changes. It SHALL remove only the target document and exclusively owned bundle assets and refresh the inventory. A refusal SHALL leave all research files intact. Scanning SHALL exclude unrelated project files, Run directories, project configuration, nested repositories, dependency trees, and Experiment runtime/cache/output trees before following their links. Wiki and Report categories or assets named `cache` or `data` SHALL remain in scope. Supported document text and manifests within the three roots SHALL retain reference, containment and concurrent-change checks.

#### Scenario: Inbound links remain
- **WHEN** another document or manifest still references the target Wiki or its asset
- **THEN** deletion reports the source and location and deletes nothing
- **AND** the agent repairs the references before retrying

#### Scenario: References repaired
- **WHEN** the target has no inbound references and the locked source fingerprint remains unchanged
- **THEN** the CLI deletes the target bundle and refreshes navigation without creating a Report or alias

#### Scenario: Model caches and unrelated files are outside reference scope
- **WHEN** an Experiment cache contains an external model symlink or a Run or unrelated handoff mentions the Wiki
- **THEN** the deletion scan does not traverse those trees or read those files
- **AND** no-reference deletion succeeds without changing them

#### Scenario: Legitimate document categories remain checked
- **WHEN** a Wiki category named cache or a Report asset document contains an inbound reference
- **THEN** it blocks deletion just like an Experiment README, metadata or details document

#### Scenario: Ambiguous or unreachable source
- **WHEN** the scan cannot establish complete safe reference coverage or sees a concurrent source change
- **THEN** deletion fails closed with a readable error and preserves the document

### Requirement: Deleted Wiki identities are not reused
Creation and deletion SHALL advance an optional `wiki` high-water mark in the tracked `.memon/id-watermarks.json` file under the common writer lock. Allocation SHALL exceed both existing Wiki IDs and this persisted high-water mark. Refreshing or deleting the disposable index SHALL NOT permit reuse of a removed ID. The strict project declaration SHALL remain unchanged so older readers of the same source remain compatible.

#### Scenario: Delete the highest numbered page
- **WHEN** the highest Wiki ID is removed and the derived index is rebuilt
- **THEN** the next page receives a strictly higher ID
