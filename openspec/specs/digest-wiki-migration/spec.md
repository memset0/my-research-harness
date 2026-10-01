# digest-wiki-migration Specification

## Purpose
Preserve historical digest documents as ordinary Wiki pages through a reviewed,
recoverable migration that participates in the coordinated FS v7 transition.

## Requirements

### Requirement: V7 converts legacy digests to Wiki

The v6-to-v7 migration SHALL include every canonical legacy Digest as a Wiki page
with a unique W identity, `kind: digest`, original D identity in `legacy_id`, and
preserved title, date, metadata and body meaning. Relative links SHALL retain their
targets. The migration SHALL NOT overwrite existing Wiki pages, mark pages reviewed,
advance Journal cursors or reinterpret summaries as findings. Unsupported legacy
files or links SHALL be reported as blockers instead of silently discarded.

#### Scenario: Existing digests and Wiki pages
- **WHEN** a v7 preview discovers legacy digests and existing Wiki IDs
- **THEN** it reports deterministic unused W destinations and retained D provenance
- **AND** preview changes no files

#### Scenario: Unchanged FS6 preparation
- **WHEN** membership preparation explicitly preserves the version marker
- **THEN** it does not silently remove legacy digests from an active older reader

### Requirement: Safe complete migration and recovery

The migration SHALL validate source fingerprints, destination absence and path
containment before applying. It SHALL preserve external backup preimages, verify
new Wiki postimages before deleting originals, and advance the version only after
all conversion checks pass. Reruns SHALL not duplicate converted pages. Rollback
SHALL preserve concurrent edits and restore only verified migration-owned changes.

#### Scenario: Stale plan or occupied destination
- **WHEN** a source or target changes after preview
- **THEN** apply refuses without overwriting either document

#### Scenario: Recover completed conversion
- **WHEN** rollback receives an intact receipt and unchanged converted pages
- **THEN** original legacy files are restored and migration-owned pages removed

#### Scenario: Completed v7 verification
- **WHEN** final verification still finds an unmigrated digest
- **THEN** it fails rather than reporting the project ready
