## Why

Every Experiment and Run write exists twice: once in the CLI command modules
(`packages/cli`) and once in the Backend `FilesystemMutationService`
(`packages/backend`, which central Web and standalone Web both call). The two
copies have already drifted — Experiment ids are allocated differently
(README `wx` versus atomic directory creation), `--from-run` Variants carry
different prose, Run status writes maintain `updated_at`/`finished_at` on one
surface only, and the archived-Run `RUNNING` guard exists only on the Web.
Every fix has to be made twice and the drift is invisible until a user sees
two surfaces disagree. Two small Web route defects (a malformed Run id
answering `500`, an invalid `results.yaml` answering `422` in standalone but
`400` in central) belong to the same write/read boundary and are fixed here.

## What Changes

- `@memon/core` gains one set of Experiment/Run mutation primitives behind a
  minimal filesystem port. CLI, Backend and standalone Web become thin
  adapters (argument parsing / journal receipts / exit codes; actor context /
  HTTP mapping / `projectFs`; auth / response shapes).
- Experiment creation converges on atomic directory allocation of
  `E<NNNN>-<slug>/`, the canonical README heading list as the single section
  source, and the CLI's `--from-run` Variant prose on every surface. The same
  inputs and clock produce byte-identical bundles from the CLI and from the
  Backend.
- Run status writes converge on the Backend semantics on every surface: they
  bump `updated_at`, set `finished_at` on `FINISHED`/`FAILED`, clear it on
  `RUNNING`/`PENDING`, and refuse `RUNNING` on an archived Run. **BREAKING**
  (CLI only): `memon run status set <archived-run> --to RUNNING` now exits 2
  instead of writing.
- `memon experiment status set` with an unchanged status no longer rewrites
  the README (it reports the current mtime and `journalAppended: false`),
  matching the Web.
- Experiment delete removes the bundle by first renaming it to a quarantine
  name on every surface; link keeps unrelated `runs[]` entries verbatim on
  every surface.
- Next `/api/runs/:id/**` routes reject an id that is neither a Run directory
  name nor a project-relative Run path with `400`
  `{error:{code:'INVALID_RESOURCE'}}` instead of `500`.
- Standalone `GET /api/experiments/:id/results` reports an invalid
  `results.yaml` with `400` (code still `INVALID_RESULTS`, diagnostics body
  unchanged) instead of `422`, matching central.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `experiment-edit`: create allocation/sections/Variant prose converge and
  are surface-independent; unchanged-status `status set` does not rewrite;
  writes share one implementation across surfaces.
- `run-edit`: Run status writes maintain timestamps and the archived-RUNNING
  guard on every surface.
- `experiment-run-path-resolution`: Run route ids are shape-validated before
  any lookup.
- `cluster-backend-api`: the standalone Results snapshot maps an invalid
  `results.yaml` to the same `400` status central uses.

## Impact

- Code: `packages/core/src/experiments/mutations.ts` (new),
  `packages/core/src/runs/mutations.ts` (new); CLI `experiment-doc.ts`,
  `experiment.ts`, `run-rename.ts`, `warning.ts`; Backend
  `mutation-service.ts`; Web `lib/server/standalone-*.ts` and
  `app/api/runs/**`, `app/api/experiments/[id]/results`.
- Wire shapes and CLI JSON output keys are unchanged; the observable
  differences are listed in `design.md`.
- Release surfaces: CLI and central Web (no filesystem convention change).
