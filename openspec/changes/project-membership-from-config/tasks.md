## 1. Core type + discovery changes

- [ ] 1.1 Add `project: string` as a required top-level field on the `Experiment` interface in `packages/core/src/types.ts`. Document with a one-line comment that the value is the `name` of the `config.yml` project whose discovery surfaced this directory.
- [ ] 1.2 Update `readExperimentDir(dirPath, projectName)` in `packages/core/src/discovery/read.ts` to set `project: projectName` on the returned `Experiment`.
- [ ] 1.3 Remove the front-matter backfill at `read.ts:46-47` (`if (parsed.frontMatter.project === '') parsed.frontMatter.project = projectName`). Front-matter `project:` is now preserved verbatim, including empty.
- [ ] 1.4 Update `ExperimentIndex.list({ project })` filter in `packages/core/src/discovery/index.ts` to match against `e.project` (top-level) instead of `e.frontMatter.project`.
- [ ] 1.5 Update `matchesQuery` in the same file: add `e.project` to the haystack list (alongside `e.frontMatter.project`, which stays as a sub-project haystack).
- [ ] 1.6 Update `packages/core/src/readme/parse.ts` so that an absent or empty `project:` front-matter field does NOT produce a missing-required-field warning. Other required-field warnings unchanged.

## 2. Core tests

- [ ] 2.1 Update / add unit tests in `packages/core/src/discovery/index.test.ts` (or wherever `list` is exercised) for: (a) `list({ project })` matches by top-level field, (b) does NOT match by front-matter project, (c) search hits both fields.
- [ ] 2.2 Update / add unit tests in `packages/core/src/discovery/read.test.ts` (or equivalent) verifying: (a) top-level `project` is set from the second arg, (b) front-matter `project:` stays empty when README omits it (no backfill), (c) front-matter `project:` is preserved verbatim when README sets it to a divergent value.
- [ ] 2.3 Update parser tests so they no longer expect a missing-required-field warning for `project:`.
- [ ] 2.4 `pnpm --filter @memon/core test` clean.

## 3. Web app: API surface + types

- [ ] 3.1 Extend `apps/web/lib/api.ts` types (`IndexedExperiment`, `FullExperiment`) to expose the new top-level `project` field. The front-matter shape continues to expose `project` as a sub-project label.
- [ ] 3.2 Update `apps/web/lib/server/data.ts:getExperimentsData` and `getExperimentData` so the JSON payload includes the top-level `project` field on every experiment record. Mirror in any other API route that returns experiment JSON.
- [ ] 3.3 Update `apps/web/app/api/experiments/route.ts` (and any related route) so the returned shape matches the extended `IndexedExperiment` type.
- [ ] 3.4 Hit `/api/experiments?project=sparse-fsdp` against the local dev server and confirm 71 records come back (vs. 0 today).

## 4. Web UI: sub-project tag and detail label

- [ ] 4.1 In `apps/web/components/experiment-list.tsx`, render a small sub-project badge per row when `exp.frontMatter.project` is non-empty AND differs from `exp.project` (top-level). Hidden when empty or equal. Reuse the existing `Badge` primitive (variant `outline` or `secondary`).
- [ ] 4.2 In `apps/web/components/experiment-detail.tsx`, render the membership project (top-level) as a "Project" row in the front-matter panel. When `frontMatter.project` is non-empty AND differs from the top-level `project`, render an additional "Sub-project" row immediately below; otherwise omit.
- [ ] 4.3 Manual smoke: open `/p/sparse-fsdp` (recipe badges visible), `/p/project-a` (no badges), and one experiment detail in each (sub-project row present iff diverges).

## 5. CLI

- [ ] 5.1 Audit `packages/cli/...` for any place that filters or groups experiments by `frontMatter.project`. Switch to top-level `project`. The natural inheritor of these changes is `ExperimentIndex.list({ project })`, which is already updated; CLI commands that delegate to it pick up the fix automatically.
- [ ] 5.2 `memon list --project <name>` smoke: in the local dev cluster's `sparse-fsdp` project, `memon list --project sparse-fsdp` returns 71 rows; `memon list --project predictive-skip-validation` returns 0 (the latter is not a configured project — by design).
- [ ] 5.3 `memon search predictive-skip-validation` smoke: returns the 21 experiments whose `frontMatter.project` matches.
- [ ] 5.4 `memon new <name>` template still emits `project: <projectName>` as the default sub-project hint.

## 6. Mock data + integration sanity

- [ ] 6.1 Confirm `mock/project-a` and `mock/project-b` experiments still render as before (no badge — frontmatter project equals top-level project). No mock edits expected.
- [ ] 6.2 Add a tiny mock fixture in `mock/` (or update an existing one) where `frontmatter.project` differs from the enclosing project's name, so the sub-project badge code-path has a regression test in the web suite.
- [ ] 6.3 `pnpm --filter @memon/web test` clean.
- [ ] 6.4 `pnpm --filter @memon/cli test` clean (if the CLI package has a test script).

## 7. Verification

- [ ] 7.1 `pnpm --filter @memon/core typecheck` clean.
- [ ] 7.2 `pnpm --filter @memon/web typecheck` clean.
- [ ] 7.3 Open `https://memon-m2.dev.mem.ac/p/sparse-fsdp` (or the local equivalent at `http://localhost:3737/p/sparse-fsdp`) and confirm 71 experiments are listed with recipe badges.
- [ ] 7.4 `openspec validate project-membership-from-config --type change` clean.
- [ ] 7.5 Commit with a body that quantifies the user-visible change (sparse-fsdp 0 → 71, project-a/b unchanged).
