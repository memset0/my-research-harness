# `packages/core/migrations/`

This directory holds **natural-language migration guides** that describe how
to upgrade a project root's on-disk layout from one `FS_CONVENTION_VERSION`
to the next. Guides are read and applied by an LLM agent (via the
`memon-migrate-fs` skill); there are no hardcoded migration scripts.

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

Currently empty (`FS_CONVENTION_VERSION = 1`; nothing to migrate from).
The first guide will land alongside the first breaking change to the
on-disk schema.
