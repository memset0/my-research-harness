## Context

See proposal.md. FS11 already publishes `run.json → result.csv → results.csv → index`; the original CLI monolith registered 90 leaves. Historical command services are also used by tests and sometimes shared readers. The migration Skill is updated; other Skill roles remain unchanged. README documents replacements for their older command examples; reference-only Skill corrections remain a separate clarification.

## Goals / Non-Goals

Goals: genuinely remove redundant registrations, preserve explicit optional/historical operations, and provide a complete fresh-project workflow through six routine leaves while retaining 13 optional commands under the same binary.

Non-goals: changing FS11, migrating research data, redesigning Wiki rendering, replacing shared domain services, or merging the seven Skills.

## Decisions

- Keep modular research, operational and legacy registrations, composed into one `memon` command tree. Reuse the same root options and existing Experiment/Run groups so restored commands see the caller's project root and output format. Independent binaries are deferred; no second command tree or installer requirement remains. Help distinguishes routine work from retained operational/historical commands.
- Reuse targeted Experiment/Wiki/Run readers behind `show`. Inventory uses the existing snapshot/event projection. Result and section options reuse domain projections with cache writes disabled; no second aggregation system or new result-file metadata.
- Reuse coordinated create/update/publication and writer locks. Initialize missing declaration/marker only after proving the research namespace is empty; code and ordinary project files may exist. Older marked projects retain their existing behavior and require explicit migration for FS11 writes.
- Remove retired CLI-only adapters when they have no surviving runtime callers. Keep useful domain parsers, migration functions and read helpers; removal of a CLI spelling is not deletion of historical evidence.
- Use existing contained target resolvers and project file access for new reads. No arbitrary-path read shortcuts.
- Keep seven Skill names. The migration Skill reads the source marker and the installed version guides, then runs scoped executors under `packages/core/migrations/scripts/`. Existing mechanical executors move into that directory; no old version/binding authoring command is re-created as a script. New experiment and Report conversion scripts preserve locks, preimages, historical times and native evidence.
- Remove only the 13 agreed CLI leaves; keep run record, experiment archive/unarchive, mock seed and wiki move pending separate decisions. Existing readers and shared domain services remain available. Shared diagnostic hints point to migration scripts; this updates central-facing error text without changing research data.

## Risks / Trade-offs

- Existing scripts use removed spellings → document a concrete replacement table; retain the 13 optional commands at their `memon …` paths.
- Direct edits can leave stale inventory → `show` identifies its published source and `refresh` remains explicit.
- Initialization mistakes could relabel legacy data → test empty, existing marked, unmarked legacy and malformed-marker cases.
- Historical guides contain retired invocations → update script paths and executable checks, keeping their per-version meaning. Ordinary Skill reorganization remains separately scoped.

## Migration Plan

No filesystem migration. Verify command registries, a fresh-project lifecycle, targeted historical reads, contained paths, publication failures and optional/legacy dispatch. Publish a CLI minor release and install its exact revision with the single memon entrypoint. Rollback is restoring the previous CLI installation; project files remain FS11.
