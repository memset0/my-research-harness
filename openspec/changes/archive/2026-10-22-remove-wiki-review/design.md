## Context

The review layer spans core projections, a commit-ordered CSV, backend Git execution seams, CLI commands and Web controls. It is independent of page identity, source staleness and document locking.

## Goals / Non-Goals

Goals: remove the layer and its filesystem/Git costs from every Wiki read and write path. Keep historical files unchanged and document rendering functional.

Non-goals: redesign Wiki discovery, staleness, kind vocabularies, content storage, normal Git history or the separate code-review document feature; simplify bundled skill workflows in this change. Obsolete review instructions are removed to match the shipped interface.

## Decisions

- Remove review types and fields rather than returning fabricated or permanent null verification state. Update all in-repository consumers together.
- Remove API/CLI entry points and core review implementation; leave existing CSV files untouched. There is no automatic data migration.
- Remove the legacy runtime cache's Git/review polling along with backend request-time review derivation so no hidden path preserves the overhead.
- Preserve unknown legacy frontmatter keys as ordinary data; they no longer have special trust or edit restrictions.
- Keep Git history outside Wiki review intact. Avoid broad replacement of similarly named code-review and commit-mark features.

## Risks / Trade-offs

- External review API consumers lose those operations → release notes identify the removal; the coordinated architecture release handles compatibility.
- Shared Markdown rendering could lose checklist or callout behavior → remove only review decoration and test existing rendering plus Wiki UI.
- Old cache paths could still poll Git → focused tests assert Wiki reads do not call Git or read the ledger.

## Migration Plan

Ship CLI, core and central UI together. Do not delete old review files or rewrite project pages. Rollback can read the untouched historical ledgers with the older release.
