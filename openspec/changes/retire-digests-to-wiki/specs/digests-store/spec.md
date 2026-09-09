## REMOVED Requirements

### Requirement: Digests live at `<projectRoot>/docs/digests/D<NNNN>-<YYYY-MM-DD>.md`
**Reason**: Wiki replaces standalone Digest storage and discovery.
**Migration**: Reviewed v7 conversion creates Wiki digest pages with retained legacy IDs.

### Requirement: GET /api/digests?project=NAME lists all digests
**Reason**: The independent Digest API is retired.
**Migration**: Use the Wiki list with digest kind.

### Requirement: GET /api/digests/[id]?project=NAME returns one digest
**Reason**: The independent Digest API is retired.
**Migration**: Use the migrated W identity and Wiki detail API.

### Requirement: Historical digest reads refresh through shared file observations
**Reason**: Standalone Digest observation is retired.
**Migration**: Ordinary Wiki observations serve the converted pages.

### Requirement: Historical digests remain readable without managed authoring
**Reason**: Historical content now lives in Wiki rather than a parallel read-only surface.
**Migration**: Convert documents through the reviewed v7 plan before removing the old reader.

## ADDED Requirements

### Requirement: Standalone Digest surfaces are retired

The application SHALL NOT expose dedicated Digest list/detail pages, API routes,
backend capabilities, navigation entries or observation topics. Historical parsing
needed exclusively for explicit migration SHALL NOT re-enable live Digest support.

For the coordinated v7 reader, this retirement SHALL supersede historical
standalone Digest clauses in inbox-viewer, web-layout, web-dashboard, page-titles,
dev-route-prewarm, runtime-cache, auth-system and markdown-link-preview. Their
Report and other non-Digest behavior SHALL remain unchanged. Migrated Digest
pages SHALL use Wiki navigation, titles, authentication, observation and editing.
Legacy D tokens and canonical Digest Markdown paths SHALL resolve through a
unique Wiki `legacy_id`; ambiguous identities SHALL NOT be guessed. Legacy
standalone HTTP URLs SHALL remain retired rather than restoring a Digest reader.

#### Scenario: Migrated reader
- **WHEN** the coordinated v7 release serves a migrated project
- **THEN** digest content is available through Wiki and no standalone Digest entry is offered

#### Scenario: Historical document reference
- **WHEN** a Markdown document references a migrated D identity or canonical legacy Digest path
- **THEN** it resolves to the unique Wiki successor without enabling a standalone route
