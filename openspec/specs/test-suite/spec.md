# test-suite Specification

## Purpose
Defines memon's automated test expectations: the `apps/web` vitest + jsdom environment run from the root `pnpm test`, component and route tests against real fixtures, read-flow and migration regression tests over `./mock/`, browser-level UI regression coverage, and green local pre-commit gates. It serves contributors and agents verifying a change before commit and archive. Tests live beside the code in each package, and the pre-commit gates are configured in `lefthook.yml`.

## Requirements

### Requirement: Web app vitest + jsdom test infrastructure

The `apps/web` package SHALL provide a runnable vitest test environment configured with `jsdom` + `@testing-library/react`. `pnpm test` at the monorepo root SHALL execute both `packages/core` (already wired) and `apps/web` test suites and report a unified pass/fail.

#### Scenario: Root `pnpm test` runs everything
- **WHEN** `pnpm test` is invoked at the monorepo root
- **THEN** vitest discovers `packages/core/**/*.test.ts` AND `apps/web/**/*.test.tsx?` and reports both suites' results

#### Scenario: A component test imports a shadcn primitive
- **WHEN** an `apps/web/components/*.test.tsx` file imports `Button` from `@/components/ui/button`
- **THEN** the import resolves under jsdom; the rendered DOM is queryable via Testing Library helpers

### Requirement: Component test coverage for stateful UI components

The web app SHALL include vitest + RTL component tests for the user-facing stateful components introduced through `add-memon-mvp` / `add-write-flow` / `add-sidebar-and-log-tools`: `ReadmeEditor` (load / debounced draft / save / 409 conflict / recovery prompt), `LogViewer` (search / follow / line selection / SSE append), `AppSidebar` (collapse + localStorage persistence), `AgentHandoffDialog` (prompt assembly + clipboard toast), `StatusEdit` (PATCH success + 409 conflict), `NewExperimentModal` (name validation + create + collision).

#### Scenario: ReadmeEditor 409 conflict path tested
- **WHEN** the test mocks `PUT /api/readme` to return 409 with current content
- **THEN** the editor transitions to diff view; clicking "Keep mine" re-issues PUT with the new mtime; clicking "Discard mine" replaces editor content with disk content

#### Scenario: AppSidebar persistence tested
- **WHEN** the test toggles a project group expansion and reads `localStorage.getItem('memon:sidebar:expanded')`
- **THEN** the stored JSON array reflects the toggle; reloading restores the same expansion state

### Requirement: Backend route integration tests against real fixtures

The web app SHALL include integration tests for the API route handlers (`/api/experiments`, `/api/hypotheses`, `/api/journal/append`, `/api/readme`, `/api/log`, `/api/log/stream`) loaded against the existing `mock/` fixtures. Both success and error paths (404 / 403 / 409) SHALL be covered.

#### Scenario: PUT /api/readme 409 mtime conflict tested
- **WHEN** an integration test sends `PUT /api/readme` with `expectedMtime` not matching the current file mtime
- **THEN** the response is 409 with the current `content` + `mtime` in the body and the file on disk is unchanged

#### Scenario: Path-confinement 403 tested
- **WHEN** an integration test sends `PUT /api/readme` for a path outside any configured project root
- **THEN** the response is 403 and the file outside the root is unchanged

### Requirement: v3 read-flow integration tests against mock fixtures

The web app SHALL include integration tests that drive the v3 read flow
end-to-end against the existing `mock/project-{a,b}` fixtures. Both
CLI and HTTP surfaces SHALL be exercised:

- CLI: `memon list` (run dirs), `memon show <run-id>`,
  `memon experiment ls`, `memon experiment show <exp-id-or-slug>`
- Web GET: `/api/experiments`, `/api/experiments/:id`,
  `/api/experiments/:id/warnings`, `/api/runs`, `/api/runs/:id`,
  `/api/runs/:id/warnings`, `/api/anomalies?project=…`

The tests SHALL invoke the API route handlers directly (no live
server), to avoid coupling the integration suite to a port-bound
server. The mock fixtures SHALL NOT be mutated by the test run.

#### Scenario: Exp doc list returns effective times
- **WHEN** the integration test invokes `GET /api/experiments?project=project-a`
  via the route handler
- **THEN** the response is 200 with at least one exp doc, and every
  entry includes `effectiveCreatedAt` + `effectiveUpdatedAt`
  computed from member-run times (both fields are non-empty ISO8601)

#### Scenario: Anomaly endpoint surfaces slug-uniqueness anomalies
- **GIVEN** the mock fixture intentionally contains two exp docs whose
  slugs collide on prefix (e.g. `fsdp` and `fsdp-collective`)
- **WHEN** the integration test invokes `GET /api/anomalies?project=project-a`
- **THEN** the response includes at least one `EXPERIMENT_SLUG_PREFIX_COLLISION`
  record naming both exp doc ids

#### Scenario: CLI experiment show is bidirectional with HTTP detail
- **WHEN** the integration test runs `memon experiment show <exp-id>
  --format json` and parses the result; then runs the same against
  `GET /api/experiments/<exp-id>`
- **THEN** the two responses agree on `id`, `frontMatter.runs`,
  `sections.motivation`, and `effectiveCreatedAt`
  (the HTTP response carries extra fields like `memberRuns[]` not
  present in the CLI; the CLI is a strict subset)

### Requirement: v2→v3 migration regression test

The core package SHALL include a snapshot regression test that walks
the v2-to-v3 migration recipe (`packages/core/migrations/v2-to-v3.md`)
against a hand-written v2 fixture and asserts byte-for-byte equality
with the post-migration `mock/project-a/` layout (modulo timestamps
and ordering-equivalent diffs).

The fixture SHALL live at `packages/core/test-fixtures/v2-mock/` and
SHALL be a literal v2 layout (run dirs with v2 frontmatter shape, no
`docs/experiments/` directory, hypotheses with `Experiments:` carrying
run-dir names).

#### Scenario: Migration produces stable v3 output
- **GIVEN** the v2 fixture under `test-fixtures/v2-mock/`
- **WHEN** the test programmatically applies each step from
  `v2-to-v3.md` (in order) to a temp copy
- **THEN** the resulting tree's file set, frontmatter shapes, body
  sections, and warnings tables match `mock/project-a/` byte-for-byte;
  any line-level diff fails the test with a unified diff hint

#### Scenario: Migration is idempotent
- **WHEN** the test re-applies the migration recipe to the
  already-migrated tree
- **THEN** no files change; the recipe SHALL detect "already at v3"
  via `.memon/version.json` and exit cleanly

### Requirement: Browser-level UI regression coverage

The web app SHALL include browser-grade regression tests for v3 UI
flows that vitest + jsdom cannot exercise truthfully. The tests MAY
use Playwright (preferred for genuine browser flows) or vitest +
@testing-library/react when the flow is purely component-state.
The decision per scenario is captured in the implementation tasks.

#### Scenario: Project list grid renders v3 exp docs
- **GIVEN** `mock/project-a` is configured
- **WHEN** the user navigates to `/p/project-a`
- **THEN** the list grid renders one card per v3 exp doc, each card
  showing the exp id, title, run count, and one StatusPill aggregating
  the status of member runs

#### Scenario: Anomaly banner copy-all writes the structured payload
- **GIVEN** `/api/anomalies?project=project-a` returns ≥1 record
- **WHEN** the user clicks the banner's `Copy all` button
- **THEN** the clipboard contains a structured text payload listing
  each anomaly with code, project, runId, experimentId, message, and
  detectedAt; a toast confirms the copy

#### Scenario: Run-panel expand persists across reload
- **GIVEN** the user is on `/p/project-a/e/<exp-id>` with all run
  panels closed
- **WHEN** the user expands one panel and refreshes the page
- **THEN** the same panel is open after reload (state persisted in
  `localStorage` keyed on `memon:exp-page:<exp>:<run>:open`)

#### Scenario: /r/<run-id> redirects to /e/<exp>?run=<run-id>
- **GIVEN** a run dir `foo-260501-100000` bound to exp `E0001-foo`
- **WHEN** the user navigates to `/p/project-a/r/foo-260501-100000`
- **THEN** the response is a 308 redirect to
  `/p/project-a/e/E0001-foo?run=foo-260501-100000`; the destination
  page renders with that run's panel auto-expanded

### Requirement: Local pre-commit gates are installed and green

A development checkout SHALL install the repository's pre-commit hooks during `pnpm install`. The hook SHALL run the workspace typecheck (the root `pnpm typecheck`) and a Biome check of the staged files. On the main branch, the root `pnpm typecheck`, `pnpm -r typecheck` and `biome check .` SHALL report zero errors. Hook installation SHALL be a silent no-op, exiting 0 with a one-line skip notice, when the install directory is not a Git checkout (for example an exported release tree) or when the hook tool is not installed (for example a CLI-only filtered install), so those installs never fail because of it.

Generated shadcn primitives under `apps/web/components/ui/` SHALL be excluded from Biome lint and format so the CLI can overwrite them verbatim. A package's tests and sources SHALL NOT import another workspace package's source files through relative paths; a cross-package parity test lives in the package that can depend on both sides.

#### Scenario: Fresh checkout installs hooks
- **WHEN** a developer runs `pnpm install` in a Git checkout
- **THEN** `.git/hooks/pre-commit` exists and invokes lefthook

#### Scenario: Exported release tree skips hook installation
- **WHEN** the install script runs in a directory without `.git`
- **THEN** it prints one skip line, exits 0 and creates no files

#### Scenario: Core typecheck stands alone
- **WHEN** `pnpm --filter @memon/core typecheck` runs
- **THEN** it succeeds without reading any file under `apps/web`

#### Scenario: Pre-commit runs the workspace typecheck
- **WHEN** a commit is attempted in a checkout with hooks installed
- **THEN** the hook runs the root `pnpm typecheck` and blocks the commit when it reports an error

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

### Requirement: Workspace typecheck reads current workspace source

The workspace typecheck SHALL check every TypeScript package against the current source of the workspace packages it imports, never against their built `dist/` output. The TypeScript packages (`@memon/core`, `@memon/skills`, `@memon/backend`, `@memon/cli`, `@memon/test-utils`) SHALL declare their workspace dependencies as TypeScript project references, and a root project SHALL aggregate them together with the `apps/web` typecheck project so one root `pnpm typecheck` checks the whole workspace incrementally. Typecheck SHALL NOT write into, delete or depend on any package's `dist/`; `pnpm build` SHALL remain the only producer of `dist/` and SHALL produce the same output as before project references were adopted. The CLI-only install-and-build sequence used by `memon update` SHALL keep building `@memon/core` and `@memon/cli` without needing the typecheck projects.

#### Scenario: Core API change is caught without a build
- **GIVEN** `packages/*/dist` built from an older revision (or absent)
- **WHEN** an exported `@memon/core` function signature changes in source and the root `pnpm typecheck` runs without any build
- **THEN** it reports type errors in the `@memon/backend` and `@memon/cli` callers that no longer match

#### Scenario: Typecheck succeeds with no built output
- **GIVEN** a checkout with no `dist/` directory in any package
- **WHEN** the root `pnpm typecheck` runs
- **THEN** it reports zero errors and creates no `dist/` directory

#### Scenario: Build output is unchanged
- **WHEN** `pnpm --filter <package> build` runs for core, skills, backend or cli
- **THEN** the emitted `dist/` tree is identical to the one produced before project references were adopted

#### Scenario: CLI-only update build still works
- **GIVEN** an exported source tree
- **WHEN** `pnpm install --frozen-lockfile --filter @memon/cli...` is followed by building `@memon/core` and `@memon/cli`
- **THEN** both builds succeed and the built `memon --version` runs

### Requirement: Shared test utilities package

The workspace SHALL provide a private `@memon/test-utils` package that test suites consume from TypeScript source through the shared test configuration, with no build step and without declaring it as a dependency of any other package. It SHALL provide temporary directory and temporary project fixtures that clean up after the test, a fixed clock, backend HTTP request and actor-header helpers, a loopback server start helper, a Next.js route `params` helper, a `process.exit` spy for CLI command tests, and a git repository fixture. It SHALL NOT be a runtime dependency of any package and SHALL NOT be installed by the CLI-only dependency install (`--filter @memon/cli...`). Backend, CLI and Web tests SHALL use the shared helper instead of a local copy wherever the local helper has the same behavior.

#### Scenario: Temporary project fixture cleans up
- **WHEN** a test creates a temporary project with runs, experiments and wiki pages through the shared fixture and the test finishes
- **THEN** the listed files existed under the project root during the test and the directory is removed afterward

#### Scenario: CLI-only install excludes test utilities
- **WHEN** `pnpm install --frozen-lockfile --filter @memon/cli...` runs in an exported source tree
- **THEN** `@memon/test-utils` is not linked into any installed package

### Requirement: One vitest preset for all packages

Every workspace package with tests SHALL have a `vitest.config.ts` that extends one shared preset defining the test timeout, reporter, the `server-only` test stub and the workspace source alias helper. Package configs SHALL only add what is specific to the package (environment, include globs, setup files, aliases). The Web package SHALL keep `jsdom` as its default environment, and Web test files that do not need a DOM SHALL declare the `node` environment.

#### Scenario: Backend and skills have explicit configs
- **WHEN** `pnpm --filter @memon/backend test` or `pnpm --filter @memon/skills test` runs
- **THEN** vitest loads that package's `vitest.config.ts`, which extends the shared preset

#### Scenario: Timeout is uniform
- **WHEN** a test in any package runs longer than the default vitest timeout but within the preset timeout
- **THEN** it is not failed for timing out, in every package alike
