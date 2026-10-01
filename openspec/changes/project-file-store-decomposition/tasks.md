## 1. Tests before the split (D1)

- [x] 1.1 Add `project-file-store.scheduling.test.ts` covering queue saturation (a), promotion and aging (b), success/failure backoff and reset (c), storage loss and recovery (d), and caller abort on an isolated read; verify `pnpm --filter @memon/core exec vitest run src/project-file-store.scheduling.test.ts` passes deterministically in < 10 s with no production edits
- [x] 1.2 Add `project-io.test.ts` covering worker crash and respawn, full channel, start failure, shutdown of pending work, errno revival, non-cloneable mutate fallback and pool sizing (e); verify it passes in < 10 s
- [x] 1.3 Record the coverage snapshot (public methods reached by 1.1/1.2) and any bugs found in design.md; verify `pnpm --filter @memon/core test` passes

## 2. Split metrics, errors and observation

- [x] 2.1 Move `monotonic`, the public contract, rolling metrics, errno builders, observation values/constructors and containment helpers into `project-file-store/{clock,contract,metrics,errors,observation,containment}.ts`; verify `pnpm --filter @memon/core test` and `pnpm --filter @memon/core typecheck` pass

## 3. Extract the scheduler

- [x] 3.1 Move the shared state shapes to `project-file-store/state.ts` and the queue, promotion, aging, dispatch, write-slot and backoff logic to `project-file-store/scheduler.ts`; verify the core suite and typecheck pass

## 4. Extract the facade and keep a re-export

- [x] 4.1 Move the persistence bridge, mount guard, store class, runtime singleton and `projectFs` facade into `project-file-store/{persistence,mount-guard,store,runtime,fs-facade,index}.ts`, leave `project-file-store.ts` as a thin re-export; verify every module is <= 700 lines, the runtime export list of `index.ts` is unchanged, and the core suite plus `pnpm -r typecheck` pass

## 5. DAG guard and final verification

- [x] 5.1 Add an import-graph test asserting `project-file-store/*` is acyclic, never reaches `git/**`, and `git/command.ts` never reaches it; verify the test passes and fails when a cycle is introduced locally
- [ ] 5.2 Run `pnpm --filter @memon/backend test`, the web `lib/server` file-access tests, `pnpm -r typecheck` and `biome check .`; verify 0 failures and 0 Biome errors, then `openspec validate project-file-store-decomposition --strict`
