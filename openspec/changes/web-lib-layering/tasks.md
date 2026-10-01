## 1. Server/client layering (D1)

- [x] 1.1 `git mv` the server-only modules (`auth/`, `central/`, `runtime/`, `slurm/`, server half of `translation/`, `runtime.ts`, `runtime-config-path.ts`, `server-core.ts`, `route-prewarm.ts`, `path-safety.ts`) under `apps/web/lib/server/`, rewrite every import / `vi.mock` / dynamic-import specifier, and verify no reference to an old path remains (`grep`) and `pnpm --filter @memon/web typecheck` passes
- [x] 1.2 Delete `apps/web/lib/warnings.ts` after confirming it has no non-test importer (and `lib/experiments.ts` is absent)
- [x] 1.3 Add `import 'server-only'` to every non-test `lib/server` module not reachable from `server.ts`, alias `server-only` to an empty stub in `vitest.config.ts`, and add a layering test that derives the entry graph and enforces both directions; verify the test passes and fails on a deliberately unmarked module
- [x] 1.4 Update `DIRECT_RUNTIME_SURFACES` and the manifest test's Runtime-module exemption for the new paths and verify `api-route-manifest.test.ts` passes
- [x] 1.5 Run `pnpm -r typecheck`, `pnpm exec biome check .`, `pnpm --filter @memon/web test` and a checkout `pnpm --filter @memon/web build` (after confirming the live host does not serve this checkout's `.next`), and verify all pass

## 2. Query key factory (D2)

- [x] 2.1 Add `apps/web/lib/query-keys.ts` with one `as const` constructor per surveyed key root/shape and an inline-snapshot test per constructor (string and Host-qualified targets); verify the test passes
- [x] 2.2 Replace every `queryKey` literal, `invalidateQueries` / `setQueryData` / `getQueryData` / `cancelQueries` / `prefetchQuery` key and manual-refresh key in `app/` and `components/` with factory calls, keeping runtime shapes byte-identical; verify `grep` finds no remaining key literal outside `lib/query-keys.ts` and the web suite passes

## 3. Shared response DTOs (D3)

- [ ] 3.1 Move the response types from `lib/api.ts` (and component-local response types such as share rows) into `apps/web/lib/dto/<domain>.ts`, re-export them from `lib/api.ts`, and verify DTO files import no server module
- [ ] 3.2 Annotate the JSON bodies built in the matching `app/api/**/route.ts` handlers with `satisfies <Dto>`; correct each DTO that disagrees with its route's actual output (never the route) and record every disagreement; verify typecheck, biome, the web suite and the checkout build pass

## 4. Close-out

- [ ] 4.1 Align proposal/design/specs with what was implemented and verify `openspec validate web-lib-layering --type change --strict` passes
