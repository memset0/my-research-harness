## Why

`JOURNAL.md` and `HYPOTHESES.md` currently live at the project root in shouting ALL-CAPS, while the project's other long-form artifacts (reports, digests, README per experiment) all live tidily under `docs/` in lowercase. The asymmetry rubs off as visual noise on `ls`, and the two files keep losing context against actual root metadata (`config.yml`, `.memon/`, repo-level `README.md`). Move them under `docs/` and rename to lowercase so the on-disk shape becomes:

```
<project-root>/
  docs/
    journal.md
    hypotheses.md
    reports/
    digests/
  experiments/
  .memon/version.json
```

This is a breaking on-disk schema change. memon's existing FS-convention machinery (version constant, `.memon/version.json` marker, `packages/core/migrations/`) is exactly built for this — so the change ships an `FS_CONVENTION_VERSION` bump from `1` to `2`, the canonical `v1-to-v2.md` guide, and lands every code-side rename in one shot.

## What Changes

- **BREAKING (FS schema)** new canonical locations:
  - `<root>/JOURNAL.md` → `<root>/docs/journal.md`
  - `<root>/HYPOTHESES.md` → `<root>/docs/hypotheses.md`
  All read paths, write paths, fixtures, mock data, skill text, agent-prompt strings, and CLI doctor checks SHALL refer to the new lowercase paths under `docs/`.
- Bump `FS_CONVENTION_VERSION` in `packages/core/src/version.ts` from `1` to `2`. Re-export remains the same.
- Author the canonical migration guide at `packages/core/migrations/v1-to-v2.md` per the `fs-migration-guide-authoring` meta-spec (seven sections, imperative prose, four canonical edge cases, fixed commit message). Update `packages/core/migrations/README.md` if the project-listing table needs the new row.
- Update mock data: `mv mock/<each>/JOURNAL.md mock/<each>/docs/journal.md` (mkdir docs as needed) and same for hypotheses. Tests that read these paths SHALL be updated to the new paths.
- Update every skill (`packages/skills/*/SKILL.md`) and every code path that writes/reads these two files. The full list is in `## Impact`.
- The CLI, web runtime caches, and API routes that pre-compute `hypothesesPath()` / `journalPath()` SHALL emit the new paths.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `journal`: `journal.md` location requirement changes (path + casing).
- `hypotheses`: `hypotheses.md` location requirement changes (path + casing).
- `memon-skills`: every requirement that names `JOURNAL.md` / `HYPOTHESES.md` as a contract (digest-mark write target, preflight scope) SHALL reference the v2 paths.
- `web-layout`: descriptive prose pinning the on-disk file names SHALL reference the v2 paths.

Note: `fs-version-tracking` is intentionally NOT deltaed. Its requirements pin the export contract and the bump-requires-breaking-change rule, both still true. Its "Initial value is 1" scenario is a historical statement ("when this change is first archived") that is not invalidated by future bumps. The live constant value is verified at runtime via the migration guide's existence requirement, which the meta-spec `fs-migration-guide-authoring` already enforces.

## Impact

- **FS schema**: BREAKING for any project initialised under v1. Existing projects MUST run `memon-migrate-fs` (which reads `packages/core/migrations/v1-to-v2.md`) to upgrade. Detection scenarios in `fs-migration-runtime` already cover the v1→v2 case mechanically; no new runtime behaviour.

- **Code (move + rename, but no logic change)**:
  - `packages/core/src/version.ts` (constant)
  - `packages/core/src/journal/parse.ts`, `journal/append.ts`, `journal/append.test.ts`, `time.ts`
  - `packages/core/src/hypotheses/parse.ts` (and any sibling tests)
  - `packages/core/src/cli/scan.ts`, `cli/doctor.ts`
  - `packages/cli/src/commands/{journal,hypo,hypotheses,experiment,warning}.ts` and their tests, `packages/cli/src/index.ts`
  - `apps/web/lib/runtime.ts` (`hypothesesPath` / `journalPath` helpers and the cache initialiser)
  - `apps/web/lib/runtime/file-cache.ts` (path strings if any)
  - `apps/web/lib/server/data.ts`, `apps/web/lib/agent-prompt.ts`, `apps/web/lib/agent-prompt.test.ts`, `apps/web/lib/warnings.ts`
  - `apps/web/app/api/{hypotheses,journal,journal/append,readme}/route.ts`, `apps/web/app/api/experiments/[id]/{status,warnings}/route.ts`, plus `route.test.ts` siblings
  - `apps/web/components/{hypothesis-view,inbox-shell,warnings-card}.tsx`

- **Skill text**: `packages/skills/{memon-write-script,memon-digest-journal,memon-run-experiment,memon-write-report,memon-append-warning,memon-propose,memon-append-journal}/SKILL.md` and `packages/skills/README.md` — every uppercase reference SHALL be replaced with the new path. Skills are agent-targeted markdown; precision matters.

- **Mock data**: `mock/project-a/JOURNAL.md` and `HYPOTHESES.md` move to `mock/project-a/docs/`; same for `mock/project-b/` (mkdir `mock/project-b/docs/` first). Real on-disk projects (`sparse-fsdp` and any user repos) are NOT touched by this change — they migrate via `memon-migrate-fs`.

- **Migration guide**: `packages/core/migrations/v1-to-v2.md` is authored to the meta-spec. The guide drives `memon-migrate-fs` for every existing v1 project root; without it, the runtime's "missing guide aborts" requirement (per `fs-migration-runtime`) will refuse to migrate.

- **Spec deltas**: `journal`, `hypotheses`, `fs-version-tracking`. No spec-level change to `fs-migration-guide-authoring` or `fs-migration-runtime` — the new guide is data they consume, not a contract change.

- **Verification per CLAUDE.md**: in addition to typecheck + tests, the migration guide's own `## Verification` block runs against a v1 fixture to prove the migration produces v2 byte-for-byte.
