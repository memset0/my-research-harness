## Why

Historical digests still have a parallel discovery, API and UI stack despite
Wiki being the unified document architecture. Retire that stack without losing
existing documents during the coordinated FS v7 migration.

## What Changes

- **BREAKING**: remove standalone Digest list/detail routes, navigation, runtime
  observation and backend document capabilities. Digests become ordinary Wiki pages.
- Register `digest` with explanatory help and generated authoring guidance.
- Extend the reviewed v6-to-v7 planner/apply/recovery flow to move all canonical
  legacy digests into collision-safe Wiki identities with `kind: digest` and
  `legacy_id`, retaining source text and relative-link meaning.
- Fail closed on unsafe paths, duplicate identities, unsupported legacy content,
  stale plans and occupied destinations; preserve backups and support rollback.
- Do not change review marks, journal cursors or the separately deferred FS7
  release gate. Never remove the live legacy reader before its data migration.

## Capabilities

### New Capabilities
- `digest-wiki-migration`: lossless reviewed conversion and recovery during v7 migration.

### Modified Capabilities
- `digests-store`: retire independent storage/read surfaces in favor of Wiki.
- `wiki-kind-registry`: add digest as a normal configurable kind.
- `inbox-viewer`: drop Digest rail/surface/edit-exclusion branches; the inbox serves Reports only.
- `page-titles`: remove Digest list/detail titles; Report detail titles keep their form.
- `web-layout`, `web-dashboard`: remove the Digests tab, route, shell consumer and nav entries.
- `dev-route-prewarm`, `auth-system`, `runtime-cache`, `markdown-link-preview`: remove Digest routes, classifications and document-surface mentions.
- `fs-migration-runtime`, `memon-skills`, `memon-wiki-skill`: preflight/protected paths and skill guidance no longer name standalone Digests or the retired Journal skills.

`journal` and `reports-store` mention "digest" only for the retired Journal
cursor and are unchanged.

## Impact

Core migration and protocol, Backend documents/observation, Web routes/navigation,
generated skills and focused tests. Coordinates with the active membership v7
change without archiving it or advancing its deferred version gate. Existing
research data is changed only through an explicitly reviewed migration plan.
