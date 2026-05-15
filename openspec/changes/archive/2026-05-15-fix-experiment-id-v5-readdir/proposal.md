## Why

`packages/core/src/experiments/id.ts` exposes two helpers used by both
the CLI (`memon experiment create`, `memon experiment delete`, etc.) and
the web layer (`POST /api/experiments`): `nextExperimentId(projectRoot)`
and `resolveExperimentId(projectRoot, needle)`. The v4 → v5 migration
moved every experiment from `docs/experiments/E<NNNN>-<slug>.md` (a
single file) into `docs/experiments/E<NNNN>-<slug>/README.md` (a folder
with a README inside). The migration updated `discoverExperiments` and
the parser to walk folders, but **`id.ts` was missed**: both functions
still `readdir(docs/experiments/)` and match each entry against
`EXPERIMENT_FILENAME_REGEX` (`^E(\d{4})-([a-z0-9][a-z0-9-]*)\.md$`).
Against a real v5 project root, `readdir` returns folder names like
`E0001-vpred-convergence` (no `.md` suffix), so the regex never
matches.

Consequences on a v5 project root with existing experiments:

- `nextExperimentId` always returns `'E0001'` (the "empty directory"
  fallback fires), because no entry has a `.md` suffix. The follow-up
  `mkdir docs/experiments/E0001-<new-slug>/` then collides with the
  existing `E0001-…` folder and the CLI / web create fails with
  `EEXIST` — but only after burning the slug-uniqueness checks. **The
  monotonic-allocation invariant the rest of the system depends on is
  silently violated.**
- `resolveExperimentId(needle)` returns `null` for every slug-form
  lookup. Only the canonical-id form happens to work (and even that
  was using `entries.includes('${id}.md')` until this fix). This
  breaks `memon experiment delete some-slug`, `memon experiment show
  some-slug`, and any other CLI/web call that accepts a bare slug.

The existing `id.test.ts` is green only because the fixtures still
seed v4-shape `.md` files into the temp dir, so the tests verify v4
behavior against v4 fixtures.

Other v5-layout downstream consumers (`discoverExperiments`,
`readExperimentDoc`, `serializeExperimentReadme`, `parseReadme`) were
correctly migrated and do not need changes here.

## What Changes

### Core: rewrite `id.ts` for v5 folder layout

- `nextExperimentId(projectRoot)` SHALL walk `readdir(docs/experiments/)`
  and consider an entry a candidate **iff** the entry name matches
  `EXPERIMENT_DIR_REGEX` (`^E(\d{4})-([a-z0-9][a-z0-9-]*)$`) **and** the
  entry is a directory containing a `README.md` (best-effort; we accept
  a missing README as "still counts toward NNNN allocation" so a
  mid-create partial state doesn't allow a duplicate NNNN). For the
  v4 → v5 migration window, the function SHALL also count legacy
  top-level `E<NNNN>-<slug>.md` files (matching
  `EXPERIMENT_FILENAME_REGEX`) toward `max`. Both id forms feed the
  same `max+1` allocation.
- `resolveExperimentId(projectRoot, needle)` SHALL similarly walk
  `readdir(docs/experiments/)` and consider entries matching
  `EXPERIMENT_DIR_REGEX` OR `EXPERIMENT_FILENAME_REGEX`. For each
  matching entry, the canonical id is `E<NNNN>-<slug>` (stripped of
  any `.md` suffix on the legacy-file form). Resolution rules are
  unchanged: a needle starting with `E\d{4}-` is treated as a full id
  and returns the canonical id only when a matching entry exists; a
  bare slug returns the canonical id when exactly one matching entry
  exists, else `null`.
- The implementation SHALL NOT use a `lstat` / `stat` per entry by
  default (`readdir` alone is sufficient because the entry name carries
  the id). The optional "directory contains README.md" check applies
  only to disambiguating an `E<NNNN>-<slug>/` folder from an
  `E<NNNN>-<slug>` accidental file — in practice the folder/file
  distinction matters only when both shapes coexist for the same id
  (a `MIGRATION_COLLISION` already surfaced by `discoverExperiments`),
  so the simpler approach is acceptable.

### Tests: rewrite `id.test.ts` fixtures for v5

- Existing tests seed `.md` files. The rewritten suite SHALL seed
  v5-shape folders (`mkdir E0001-foo/ && writeFile E0001-foo/README.md`)
  and assert the same observable behavior. The "ignores non-canonical
  filenames" scenario stays as-is in spirit but is renamed/rewritten to
  assert that bare files in the v5 layout (no `README.md` inside) and
  non-`E\d{4}-` names are silently skipped.
- ADD a new test scenario covering the legacy-fallback path: a temp
  dir mixing v5 folders AND legacy `.md` files (mid-migration) SHALL
  allocate `max+1` over the combined set, and slug resolution SHALL
  succeed against either form.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities

- `experiment-edit`: tighten the "memon experiment create allocates
  next E ID" requirement so the scan step explicitly addresses the v5
  folder layout (and the v4 legacy fallback), and the write step uses
  the v5 folder/README path. The existing v4 wording is retained as
  the migration-tolerant fallback.

## Impact

- `packages/core/src/experiments/id.ts` — rewrite both functions.
- `packages/core/src/experiments/id.test.ts` — rewrite fixtures + add
  mixed v4/v5 scenario.
- `openspec/specs/experiment-edit/spec.md` — MODIFIED requirement
  delta in this change's `specs/experiment-edit/spec.md`.
- No CLI or web-side code changes are required — they call through
  `nextExperimentId` / `resolveExperimentId` and pick up the fix
  automatically.
- No skill changes are required — the agent-facing surface
  (`memon experiment create <slug>`) is unchanged in CLI shape and
  output.
