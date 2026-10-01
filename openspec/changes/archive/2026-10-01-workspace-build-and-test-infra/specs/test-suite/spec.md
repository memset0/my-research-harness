## MODIFIED Requirements

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

## ADDED Requirements

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
