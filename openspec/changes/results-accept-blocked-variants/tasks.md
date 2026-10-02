## 1. Core: status vocabulary and env normalization

- [ ] 1.1 Add `VARIANT_STATUS_VALUES` (lifecycle order including `BLOCKED`) to `packages/core/src/types.ts`, derive `VariantStatus` from it and export it from the package index; verify with a unit test that pins the exact ordered list
- [ ] 1.2 Use `VARIANT_STATUS_VALUES` in the Results Zod schema and in `BackendResultsDocumentSchema`; verify with core tests that a `BLOCKED` Variant parses and lints without errors, that `status: WAITING` fails with an `INVALID_RESULTS_SCHEMA` error listing the seven statuses, and that the protocol schema accepts `BLOCKED`
- [ ] 1.3 Accept number and boolean `provenance.env` values, normalize them with `String(value)` and report `RESULTS_ENV_VALUE_COERCED` parse warnings through a warnings sink in `parseYamlDocument`; verify with core tests for a number, a boolean, a `null` (still an error), the warning's field path, `validateExperimentManagedDocuments` reporting it as a warning only, and a serialize → parse round-trip that writes a quoted string and reads back without a warning

## 2. Backend: document-sized response bound

- [ ] 2.1 Add `MAX_BACKEND_EXPERIMENT_DOCUMENT_JSON_BYTES` (16 MiB) and pass it from the Experiment detail and Results snapshot reads through an optional `maxBytes` on `projectRead`; verify with Backend route tests that a Results snapshot and a detail larger than 1 MiB answer `200`, that a detail larger than 16 MiB answers `500 PAYLOAD_TOO_LARGE`, and that the Run list keeps the 1 MiB bound
- [ ] 2.2 Verify with a Backend project-service test that `getExperimentResults` and `getExperiment` serve a `BLOCKED` Variant and a coerced env value (string in the document, warning in `warnings` / diagnostics)

## 3. Web: status badge and lifecycle sorting

- [ ] 3.1 Add `apps/web/components/variant-status-badge.tsx` (`VariantStatusBadge` composing the shadcn `Badge` with per-status classes, `BLOCKED` orange with a dashed outline, `data-status`) and make `StatusCell` delegate to it; verify with a component test that every status renders its name and that `BLOCKED` carries its distinct classes
- [ ] 3.2 Add `apps/web/lib/experiment-results/status.ts` (lifecycle rank typed as `Record<VariantStatus, number>`), an optional `getSortValue` on `ResultTableColumn` used by `sortVariants`, and the rank as the Status column's sort key; verify with sorting tests for ascending and descending lifecycle order and a filter test showing Status filters still compare text
- [ ] 3.3 Verify with the standalone Results snapshot route test that a document with a `BLOCKED` Variant and a numeric env value answers `200` with the normalized document and the coercion warning

## 4. CLI

- [ ] 4.1 Add CLI tests: `memon experiment results table --status blocked` returns only the `BLOCKED` row with `meta.filters.statuses` `["blocked"]`; `results table` and `results summary` succeed on a document with a numeric env value; `experiment doc lint` reports the coercion as a warning and exits 0

## 5. Verification

- [ ] 5.1 Run the change-relevant test files (core documents and protocol, Backend routes and project service, Web Results table, sorting and route, CLI experiment results) plus root `pnpm typecheck` and `pnpm exec biome check .`, all with 0 errors
- [ ] 5.2 Parse the motivating operator bundle read-only with the built core and confirm zero parse errors and that its Backend responses fit the new bound; record the numbers in the Git-ignored `LOCAL.md`, not in tracked files
- [ ] 5.3 Run `openspec validate results-accept-blocked-variants --type change --strict` and confirm the planning artifacts describe what was implemented
