# `packages/core/migrations/`

This directory holds **natural-language migration guides** that describe how
to upgrade a project root's on-disk layout from one `FS_CONVENTION_VERSION`
to the next. Guides are read and applied by an LLM agent through the
`memon-migrate-fs` skill. A guide MAY reference a narrowly scoped executor in
`scripts/` when a semantic migration needs persistent approval state,
hash-based invalidation, transactional publication, or rollback support; the
guide remains the authoritative workflow.

## Naming

```
v<N>-to-v<N+1>.md
```

`<N>` and `<N+1>` are consecutive positive integers. Every consecutive pair
from `1` up to the current `FS_CONVENTION_VERSION` MUST have a guide; gaps
(e.g. `v1-to-v3.md` skipping the v2 step) are forbidden.

## Required structure

Every guide MUST contain these H2 headings in this exact order:

1. `## Background / Why`
2. `## Detection`
3. `## Diff (v<N> → v<N+1>)`
4. `## Target State (v<N+1> Summary)`
5. `## Verification`
6. `## Rollback Notes`
7. `## Edge Cases`

## Style

Guides are LLM-targeted. Write **imperatively, atomically, hedge-free**:

- Numbered steps with one definite action each.
- Embed exact match strings, paths, and shell commands; avoid metaphors.
- No "might" / "consider" / "you could" — every step is a definite action.
- Use literal shell commands for verification (returns 0 on success,
  non-zero on failure; print `OK` on success).

## Where the rules live

The full meta-spec for guide authoring lives at:

```
openspec/specs/fs-migration-guide-authoring/spec.md
```

Read that before writing a new guide. It defines the required section
content, verification command standards, the fixed commit-message format
(`chore(memon): migrate FS convention v<N> -> v<N+1>`), and the four
canonical edge cases every guide must address.

## Status

The current value lives in `packages/core/src/version.ts`. Guides present:

- `v1-to-v2.md`
- `v2-to-v3.md`
- `v3-to-v4.md`
- `v4-to-v5.md`
- `v5-to-v6.md` — staged, per-Experiment semantic migration to structured
  Implementation, Investigation, and Results sidecars.
- `v6-to-v7.md` — mechanical, plan-reviewed migration to Experiment-owned
  project-relative Run paths and Digest-to-Wiki conversion, executed by
  `scripts/migrate-v6-to-v7.mjs` (`plan` / `apply` / `verify` / `rollback`).
- `v7-to-v8.md` — mechanical migration that builds the derived index
  `.memon/index/` (self-ignored, rebuildable) and advances the marker; it
  changes no document and never creates `.memon/project.yml`. Executed by
  `scripts/migrate-v7-to-v8.mjs` (`plan` / `apply` / `verify` / `rollback`).
