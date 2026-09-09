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

## Impact

Core migration and protocol, Backend documents/observation, Web routes/navigation,
generated skills and focused tests. Coordinates with the active membership v7
change without archiving it or advancing its deferred version gate. Existing
research data is changed only through an explicitly reviewed migration plan.
