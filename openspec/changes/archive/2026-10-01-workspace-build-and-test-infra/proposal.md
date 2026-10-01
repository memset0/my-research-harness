## Why

The workspace typecheck (`pnpm -r typecheck`) resolves `@memon/core`,
`@memon/skills` and `@memon/backend` through each package's `dist/*.d.ts`, so
after a core API change it silently checks dependents against the last build:
a broken caller stays green until someone rebuilds. There are no TypeScript
project references to make the dependency graph explicit. On the test side the
same fixtures are re-implemented file by file (backend `request` / `actorHeader`
/ `startBackend` / `git`, CLI `spyExit`, Web `paramsFor`, ad-hoc temp
directories), and each package configures vitest differently (backend and
skills have no `vitest.config.ts`, only the CLI raises `testTimeout`, the Web
`server-only` stub lives in one app), which makes new tests copy-paste and
makes suite-wide settings drift.

## What Changes

- Adopt TypeScript project references for the workspace typecheck. `core`,
  `skills`, `backend` and `cli` become composite projects whose typecheck config
  references their workspace dependencies (backend→core, skills→core,
  cli→core+skills) and maps workspace imports to source, emitting declarations
  only into a package-local cache under `node_modules/.cache/tsbuild`, never
  into `dist/`. A root `tsconfig.json` aggregates all projects, including a
  new `apps/web/tsconfig.typecheck.json` that reads core and backend source
  types. The root `pnpm typecheck` becomes one `tsc -b`; each package's
  `typecheck` script becomes `tsc -b` on its typecheck config.
- Keep `pnpm build` authoritative and unchanged in output: each package's
  `tsconfig.build.json` becomes a standalone config (no composite, no
  references, no source mapping) producing the same `dist/` as today, and
  `scripts/clean-package-dist.mjs` is untouched. `memon update`'s
  install-and-build sequence (`--filter @memon/cli...`, build core, build cli)
  keeps working.
- The lefthook pre-commit typecheck runs the root `pnpm typecheck`.
- Add a private workspace package `@memon/test-utils` (test-only,
  consumed as TypeScript source, no build step, outside the CLI install
  closure) exporting temp-directory and temp-project fixtures, a fixed clock,
  backend HTTP request / actor-header / server-start helpers, Next route
  `paramsFor`, CLI `spyExit`, and a git repository fixture.
- Replace the semantically identical duplicated helpers in backend, CLI and
  Web tests with the shared ones; helpers whose behavior differs stay local.
  Core tests are not changed by this change.
- Add a root `vitest.shared.ts` preset (test timeout, reporter, `server-only`
  stub, source alias helper) that every package's `vitest.config.ts` extends,
  adding `vitest.config.ts` to backend and skills. Web keeps jsdom as its
  default environment; pure-logic Web tests that do not touch the DOM declare
  `// @vitest-environment node`.
- Document the Web test-location convention (component tests beside source,
  integration tests under `test/`) without moving any files.
- Not in scope (Future): vitest, jsdom or TypeScript major upgrades; moving Web
  tests; adopting test-utils in core tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `test-suite`: the workspace typecheck is source-based through project
  references and the pre-commit gate runs it; packages share one test-utilities
  package and one vitest preset.

## Impact

- Config: every `tsconfig*.json`, new root `tsconfig.json`,
  `apps/web/tsconfig.typecheck.json`, `vitest.config.ts` files plus root
  `vitest.shared.ts`, root and package `package.json` scripts,
  `pnpm-lock.yaml`, `lefthook.yml`, `AGENTS.md` typecheck/test command wording.
- New package `packages/test-utils/`.
- Test files in `packages/backend/src`, `packages/cli/src`, `apps/web`.
- No runtime, wire, CLI-behavior or on-disk change. The CLI package's tsconfig
  files change, so the release that ships this treats the CLI as a changed
  distributed surface; bundled skills content does not change.
