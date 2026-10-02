## Why

A real operator Experiment's `results.yaml` (about 400 Variants and 70 columns,
1.4 MB of YAML) can no longer be read: its Results snapshot answers `400` and
its detail page shows no Results, because three Variants use the status
`BLOCKED` and one `provenance.env` value is a bare YAML number. Both are
legitimate authoring choices — a planned Variant that waits on a prerequisite,
and an environment value written without quotes — yet one row rejects the
whole document. A read-only reproduction also showed that once the document
parses, its Results snapshot (≈1.19 MB of JSON) and Experiment detail
(≈2.25 MB) exceed the Backend's 1 MiB control-response bound, so central would
answer `500 PAYLOAD_TOO_LARGE` instead of `200`.

## What Changes

- The Variant status vocabulary gains `BLOCKED`: a declared Variant that cannot
  be launched (or relaunched) until a named prerequisite is met. It is pre-run
  and non-terminal like `PLANNED`, may have zero `runs`, and moves to `PLANNED`
  or `RUNNING` when unblocked or to `DROPPED` when abandoned. No new lint rule
  applies to it. The canonical order becomes `PLANNED`, `BLOCKED`, `RUNNING`,
  `COMPLETED`, `FAILED`, `INCONCLUSIVE`, `DROPPED`.
- `provenance.env` values stay strings on disk and in the normalized model. A
  reader now accepts a YAML number or boolean env value, normalizes it to its
  canonical string (`0.000008` → `"0.000008"`, `true` → `"true"`) and reports a
  `RESULTS_ENV_VALUE_COERCED` warning instead of rejecting the document. `null`,
  lists and mappings stay schema errors. memon writers keep emitting strings.
- The Backend protocol's Results document accepts `BLOCKED`.
- Central Experiment detail and Results snapshot reads are bounded by a 16 MiB
  document response limit instead of the 1 MiB control-response limit; other
  Project data reads keep their limits.
- The Web Results table renders `BLOCKED` with a dedicated badge (orange,
  dashed outline) through a shadcn `Badge` wrapper, and the Status column sorts
  by the canonical lifecycle order instead of alphabetically.
- `memon experiment results table --status` documents `BLOCKED` among the
  accepted values (the filter already passes any status through).
- No `FS_CONVENTION_VERSION` or Results `schema_version` change: readers only
  become more tolerant.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `structured-experiment-sections`: the Variant status requirement adds
  `BLOCKED` with its lifecycle relationships; a new requirement defines string
  `provenance.env` values and read-time normalization of numbers/booleans.
- `cluster-backend-api`: Experiment detail and Results snapshot responses get
  a document-sized response bound.
- `web-dashboard`: the Results Status column's badges and sort order are
  specified, including `BLOCKED`.
- `memon-cli`: `memon experiment results table --status` lists `BLOCKED`.

## Impact

- `@memon/core`: `experiments/documents.ts` (Results schema, normalization,
  parse warnings), `types.ts` (`VariantStatus`, `VARIANT_STATUS_VALUES`),
  `backend-protocol.ts` (Results document status enum).
- `@memon/backend`: `http/paths.ts` (new limit), `routes/runs-experiments.ts`
  (detail and Results snapshot reads use it).
- `@memon/web`: new `components/variant-status-badge.tsx`,
  `components/results-table/cells.tsx`, `lib/experiment-results/`
  (`columns.ts`, `sorting.ts`, `types.ts`, new `status.ts`).
- `@memon/cli`: no code change; tests cover `--status BLOCKED` and numeric env.
- Skills are unchanged; their Variant status lists still name six values and
  are left for a separate skills release.
- Release: changes the CLI (through core) and central → MINOR (`8.2.0`).
