## Why

Membership currently intersects Experiment `runs` basename IDs with the Run README's `experiment` field. Resolving IDs and validating both sides requires discovery and Run hydration, and basename collisions can select the wrong directory. Explicit Experiment-owned paths remove that dependency without introducing another authoritative cache.

## What Changes

- **BREAKING**: FS convention v7 makes Experiment README frontmatter `runs` the sole membership authority, storing normalized project-root-relative Run directory paths, not bare IDs or paths relative to the Experiment bundle.
- **BREAKING**: remove the persisted Run `experiment` field and all dual-write/intersection behavior. A displayed parent is a derived projection of Experiment declarations only.
- Resolve declared members directly, without project-wide Run discovery or reading unrelated Run READMEs. Preserve one-owner semantics; unassigned Runs remain valid, and duplicate owners are explicit conflicts.
- Provide a reusable v6-to-v7 batch migration command/script with read-only planning, an explicit reviewed apply step, source fingerprints, backups, fail-closed verification and resumable recovery. Never relocate Run directories or outputs.
- Update parsing, serialization, CLI/Web mutations, doctor, result/citation resolution, shared views and managed skills. Basename IDs remain display/search conveniences, never an ambiguous locator.
- Publish the consecutive v6-to-v7 migration guide and align `FS_CONVENTION_VERSION` and the release Major at 7.0.0 when implemented. Do not change versions or migrate research data during proposal authoring.

## Capabilities

### New Capabilities
- `experiment-run-path-resolution`: direct safe path lookup, collision-safe resource identity and bounded membership I/O.

### Modified Capabilities
- `experiment-readme`: v7 path-valued authoritative membership.
- `run-readme`: no persisted parent field in v7.
- `experiment-membership-anomalies`: declaration-based validation rather than bidirectional reconciliation.
- `experiment-edit`: membership mutations affect Experiment declarations only.
- `fs-migration-runtime`: deterministic, reviewed v6-to-v7 batch conversion and recovery.
- `memon-skills`: teach the new authority, paths, validation and migration procedure.
- `experiment-discovery`: membership derives from declarations only.
- `run-edit`, `memon-cli`: run rename and the run/experiment command families rewrite declarations, not Run fields.
- `web-dashboard`: legacy run redirects derive the parent from declarations; orphan cards are retired.
- `fs-version-tracking`: the constant becomes 7 at the 7.0.0 release.
- `wiki-store`: `@` Run references accept project-relative paths.

## Impact

### Staged rollout decision

Ship compatible CLI, Backend, Web and skill readers/writers now. An explicitly
approved data-only migration converts the real Experiment and Run documents
while retaining the FS v6 marker byte-for-byte (`--keep-version`). The marker
does not claim that this optional preparation has or has not run; verify actual
documents. Legacy unique basename declarations remain readable during this
transition, but new membership writes use canonical project-relative paths.
The final v7 guide and release readiness are now completed in this change; the
version constants move to 7 / 7.0.0 only in the separate release commit.
Legacy bare IDs stay readable after v7 (design D2). Do not migrate other
projects as part of this change.

Core types/parsers/serializers, membership/discovery helpers, rename and reference resolution; Backend project/document/mutation services; CLI create/link/unlink/delete/doctor/migrate-fs; Web member lists, Run navigation and resource query keys; result provenance, eligibility/deprecation checks and Wiki citations; bundled skills, version metadata, migration guides and regression fixtures.

Existing v6 projects require the reviewed migration before v7 skills proceed (skill preflight and `memon fs-version check` report `behind`); ordinary write paths do not read the marker (design D1). Ordinary list/read requests do not migrate data. Deployment must coordinate central and CLI compatibility; a read-only central project does not authorize a migration write. Operator-specific audits, project paths and migration reports remain outside tracked artifacts.
