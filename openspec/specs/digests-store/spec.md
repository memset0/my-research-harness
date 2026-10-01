# digests-store Specification

## Purpose
Record the retirement of standalone Digest storage, APIs, pages and observation in favour of `digest`-kind Wiki pages produced by the reviewed v7 migration.

## Requirements

### Requirement: Standalone Digest surfaces are retired

The application SHALL NOT expose dedicated Digest list/detail pages, API routes,
backend capabilities, navigation entries or observation topics. Historical parsing
needed exclusively for explicit migration SHALL NOT re-enable live Digest support.

For the coordinated v7 reader, this retirement supersedes the historical
standalone Digest clauses in inbox-viewer, web-layout, web-dashboard, page-titles,
dev-route-prewarm, runtime-cache, auth-system and markdown-link-preview, which
this change's delta specs for those capabilities remove or modify. Their
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
