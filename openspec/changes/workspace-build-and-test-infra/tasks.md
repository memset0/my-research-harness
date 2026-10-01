## 1. Project references (D1, D2, D6)

- [x] 1.1 Convert core, skills, backend, cli `tsconfig.json` to composite typecheck projects (declaration cache, `paths`, `references`) and make each `tsconfig.build.json` standalone; verify `dist/` built with old and new configs is identical
- [x] 1.2 Add root solution `tsconfig.json` and `apps/web/tsconfig.typecheck.json`; switch root/package `typecheck` scripts to `tsc -b` and package `dev` scripts to `tsconfig.build.json`; verify `pnpm typecheck` and `pnpm -r typecheck` are green
- [x] 1.3 Verify acceptance: with `dist/` absent, typecheck is green and creates no `dist/`; after changing a core export signature without building, typecheck reports backend and cli errors; record cold/warm timings against the 12-14 s baseline
- [x] 1.4 Point the lefthook pre-commit typecheck at `pnpm typecheck` and update the AGENTS.md typecheck/test command wording; verify by timing a real commit hook
- [x] 1.5 Verify `memon update`'s path: run `update.test.ts`, and in a `git archive` export run `pnpm install --frozen-lockfile --filter @memon/cli...`, build core and cli, and run the built `memon --version`

## 2. Shared test utilities (D3)

- [x] 2.1 Create `packages/test-utils` (private, source-only, composite typecheck project) with the fixtures and helpers listed in design.md, update `pnpm-lock.yaml`, reference it from the typecheck configs, and verify typecheck plus a self-test of the package
- [x] 2.2 Verify `pnpm install --frozen-lockfile --filter @memon/cli...` in an export does not link `@memon/test-utils`
- [ ] 2.3 Replace identical backend helpers (`request`, `actorHeader`, `startBackend`, `git`) and verify the backend suite passes
- [ ] 2.4 Replace identical CLI helpers (`spyExit`/`ExitCalled`) and verify the CLI suite passes
- [ ] 2.5 Replace identical Web helpers (`paramsFor`) and verify the affected Web tests pass

## 3. Vitest preset (D4, D5)

- [x] 3.1 Add `packages/test-utils/src/vitest-preset.ts` (timeout, reporter, `server-only` stub, aliases) and make every package's `vitest.config.ts` extend it, adding configs for backend and skills; verify each package suite runs
- [x] 3.2 Mark Web tests that need no DOM with `// @vitest-environment node`, keeping only files that pass under node; verify the Web suite passes
- [ ] 3.3 Run root `pnpm test` under Node 22.19.0, `biome check .`, the root typecheck, and `openspec validate workspace-build-and-test-infra --type change --strict`; all green
