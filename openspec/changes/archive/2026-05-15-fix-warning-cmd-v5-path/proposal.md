## Why

`packages/cli/src/commands/warning.ts:43-69` resolves the target
`README.md` for `memon experiment warning {add, list, resolve, reopen,
delete}`. When the first argument is shaped like an experiment id
(matches `EXP_ID_RE = ^E\d{4}-[a-z0-9][a-z0-9-]*$`), the helper
constructs:

```ts
const readmePath = join(projectRoot, 'docs', 'experiments', `${idOrSlug}.md`)
```

This is the v4 file-form path. On a post-v5 project root the exp doc
lives at `docs/experiments/E<NNNN>-<slug>/README.md` (folder + README),
so `readmePath` points at a file that does not exist. The downstream
`readWithLock` call then `fs.stat`s it and exits with `NOT_FOUND`,
producing a confusing error: the exp doc plainly exists, just at a
different path.

The fix is to route the exp-id branch through `discoverExperiments` —
the same v5-aware helper every other CLI exp-doc command (`experiment
show`, `experiment status set`, etc.) uses — and use the returned
record's `.path` field (already the correct README path under v5, with
the legacy v4 file form supported as a `LEGACY_LAYOUT` fallback).

The slug-only / run-dir branch (lines 53-68) is unchanged: it already
goes through `scanProjectRoot` for the run side.

The change carries no spec capability *additions*, but it does require
tightening the `experiment-edit` requirement that covers `memon
experiment warning *` so the wording is explicit about resolving the
exp-id form through the v5-aware discovery helper rather than a
hard-coded path.

## What Changes

### CLI: route exp-id branch through `discoverExperiments`

- `packages/cli/src/commands/warning.ts`:
  - Add `discoverExperiments` to the `@memon/core` imports.
  - In `resolveTarget`, after `singleProjectRoot(r)`, capture
    `projectName = r.config.projects[0]!.name`.
  - When `EXP_ID_RE.test(idOrSlug)` is true, call
    `discoverExperiments(projectRoot, projectName)` and find the
    record whose `id === idOrSlug`. Return `exp.path` as `readmePath`.
    NOT_FOUND when no matching record.
  - The downstream branch (run-dir form via `scanProjectRoot`) and
    every other code path is unchanged.

### Test: add v5 exp-doc coverage

- `packages/cli/src/commands/warning.test.ts`:
  - ADD a new `describe('memon experiment warning add — v5 exp doc',
    …)` block (or equivalent) that seeds a `docs/experiments/E0001-foo/
    README.md` exp-doc fixture, invokes `runWarningAdd({ runId:
    'E0001-foo', --run: 'bar-260501-100000', ... })`, and asserts:
    - The exp doc README receives the new row (file content contains
      the message after the call).
    - The JOURNAL `[WARNING]` event includes `run=bar-260501-100000`.
  - Existing run-dir-form tests remain unchanged.

## Capabilities

### Modified Capabilities

- `memon-cli`: tighten the `memon experiment warning *` requirements so
  the exp-id form's path resolution explicitly goes through the
  v5-aware discovery helper (`discoverExperiments`) and supports the
  post-v5 folder layout.

## Impact

- `packages/cli/src/commands/warning.ts` — fix `resolveTarget` (≤ 10
  lines diff).
- `packages/cli/src/commands/warning.test.ts` — add one fixture +
  3-4 test cases.
- `openspec/specs/memon-cli/spec.md` — MODIFIED requirement delta in
  this change's `specs/memon-cli/spec.md`.
- No web, core, or skill changes.
