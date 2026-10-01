## ADDED Requirements

### Requirement: The full test entry tests current workspace package code

The root `pnpm test` SHALL be the single entry for full and archive test gates.
Before running any package suite it SHALL rebuild the `dist/` of every
workspace package whose built output other packages' tests import
(`@memon/core` and `@memon/backend`), so no suite runs against a stale build.
The `apps/web` test configuration SHALL additionally resolve `@memon/backend`
to its TypeScript source, so Web route tests exercise current backend code
even when run on their own. A full or archive gate SHALL NOT be reported from
`pnpm -r test` alone.

#### Scenario: Backend change with a stale backend build
- **GIVEN** a source change in `packages/backend/src/` and a `packages/backend/dist/`
  built before that change
- **WHEN** the root `pnpm test` runs
- **THEN** the backend and core builds are refreshed first and the Web suite's
  route tests observe the changed backend behavior

#### Scenario: Web route test run on its own
- **GIVEN** a stale or absent `packages/backend/dist/`
- **WHEN** a single Web route test that imports `@memon/backend` is run with
  `pnpm --filter @memon/web exec vitest run <file>`
- **THEN** the test imports the backend TypeScript source, not the stale build
