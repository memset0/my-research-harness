## Context

See proposal.md. FS11 already publishes `run.json → result.csv → results.csv → index`; the CLI monolith still registers 90 leaves. Historical command services are also used by tests and sometimes shared readers. The seven Skill files remain unchanged. README documents replacements for their older command examples; reference-only Skill corrections remain a separate clarification.

## Goals / Non-Goals

Goals: genuinely remove redundant registrations, preserve explicit optional/historical operations, and provide a complete fresh-project workflow through six normal leaves.

Non-goals: changing FS11, migrating research data, redesigning Wiki rendering, replacing shared domain services, or merging the seven Skills.

## Decisions

- Separate normal, tools and legacy registration modules and binaries. Share global option/error/invocation handling, not a hidden universal registry. This makes the actual command counts auditable and avoids loading unrelated command adapters on the normal path.
- Reuse targeted Experiment/Wiki/Run readers behind `show`. Inventory uses the existing snapshot/event projection. Result and section options reuse domain projections with cache writes disabled; no second aggregation system or new result-file metadata.
- Reuse coordinated create/update/publication and writer locks. Initialize missing declaration/marker only after proving the research namespace is empty; code and ordinary project files may exist. Older marked projects retain their existing behavior and require explicit migration for FS11 writes.
- Remove retired CLI-only adapters when they have no surviving runtime callers. Keep useful domain parsers, migration functions and read helpers; removal of a CLI spelling is not deletion of historical evidence.
- Use existing contained target resolvers and project file access for new reads. No arbitrary-path read shortcuts.
- The seven Skill names and roles remain intact. Current CLI documentation and command help describe direct editing, implicit diagnostics and optional workflows without adding mandatory steps.

## Risks / Trade-offs

- Existing scripts use removed spellings → document a concrete replacement table; retain only approved transitional commands in `memon-legacy`.
- Direct edits can leave stale inventory → `show` identifies its published source and `refresh` remains explicit.
- Initialization mistakes could relabel legacy data → test empty, existing marked, unmarked legacy and malformed-marker cases.
- A frozen Skill may contain an obsolete command → obtain clarification for reference-only corrections; do not silently keep old aliases.

## Migration Plan

No filesystem migration. Verify command registries, a fresh-project lifecycle, targeted historical reads, contained paths, publication failures and optional/legacy dispatch. Publish a CLI minor release and install its exact revision with all entrypoints. Rollback is restoring the previous CLI installation; project files remain FS11.
