## 1. Core: types, schema, regex, helpers

- [x] 1.1 Add `CODE_REVIEW_FILENAME_REGEX = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/` to `packages/core/src/types.ts`.
- [x] 1.2 Add `CodeReviewFrontMatterRawSchema` (snake_case zod, lenient defaults: `reviewed`/`done` default false, `description` default '') to `packages/core/src/schemas.ts`.
- [x] 1.3 Add camelCase types to `types.ts`: `CodeReviewCommit`, `CodeReviewTodo`, `CodeReviewFrontMatter`, `CodeReviewCompletion`, `CodeReviewSummary` (list metadata: id, scope, experiment, title, createdAt, updatedAt, path, mtime, completion), `CodeReview` (detail: + frontmatter, body, hash).
- [x] 1.4 Add `packages/core/src/code-review/parse.ts`: `parseCodeReview(content)` (gray-matter + shared `yaml-engine` + zod) → `{ frontmatter, body }`; `deriveCompletion(fm)` → `CodeReviewCompletion` (empty review ⇒ not complete).
- [x] 1.5 Add `toggleCommitReviewed(content, sha, reviewed, now)` and `toggleTodoDone(content, index, done, now)` to the same module: re-serialize frontmatter only (bump `updated_at`, body byte-preserved) → new content; return `null` on unknown sha / out-of-range index.
- [x] 1.6 Export all new symbols from `packages/core/src/index.ts`.
- [x] 1.7 Unit tests (`packages/core`): regex match/reject; parse with missing-boolean defaults; `deriveCompletion` incl. empty-not-complete + all-checked-complete; toggle flips the flag, bumps `updated_at`, leaves body identical; toggle on bad sha / OOB index returns null.

## 2. DirCache: dynamic dirs

- [x] 2.1 Add `addDir(dir, poller?)` and `removeDir(dir)` to `apps/web/lib/runtime/dir-cache.ts` (add: register state + scan + watch; remove: drop state + knownPaths). Keep existing API/behavior intact.
- [x] 2.2 Unit-test `addDir`/`removeDir` against a temp fixture tree (add a dir → list reflects its files + paths registered; remove → entries gone).

## 3. Runtime integration

- [x] 3.1 In `apps/web/lib/runtime.ts`: instantiate `codeReviewsCache: DirCache<CodeReviewSummary>`. Static dirs = `<root>/docs/code-review` per project. Nested dirs = seeded by scanning each discovered experiment folder for a `code-review/` subdir. `parseFile` closure parses frontmatter, derives completion, and computes `id` (docs-relative path minus `.md`), `scope`, `experiment`. `onUpdate(dir)` emits `code-reviews-change` for the resolved project (resolver matches nested `code-review/` dirs too).
- [x] 3.2 Add Runtime accessors `getCodeReviewsList(project)` (aggregate across the project's flat + nested dirs, sort date desc) and `getCodeReviewContent(project, id)`.
- [x] 3.3 Warmup: `await codeReviewsCache.warmup()`; register every `dirs()` + `paths()` entry with the Poller.
- [x] 3.4 Poller dispatch: try `codeReviewsCache.handlePollChange(path, poller)`. Extend the `docs/experiments/` dir branch to reconcile `E*/code-review/` dirs via `addDir`/`removeDir`, and register each experiment folder's mtime. Add a branch: an experiment **folder** mtime advance → if `<exp>/code-review/` exists and is not yet watched, `addDir` it.
- [x] 3.5 SSE: thread `code-reviews-change` through the client event bridge (`apps/web/lib/events-client.ts` or equivalent) → invalidate `['code-reviews', project]` and `['code-review', project, id]`.

## 4. API routes

- [x] 4.1 `apps/web/app/api/code-reviews/route.ts` — GET list → `{ codeReviews: CodeReviewSummary[] }` sorted by date desc.
- [x] 4.2 `apps/web/app/api/code-reviews/[...id]/route.ts`:
  - GET: reconstruct path, validate id shape + `assertWithinProjectRoots()`; return `{ id, scope, experiment, frontmatter, body, mtime, hash }`; 400 / 403 / 404.
  - PATCH: body `{ op: 'commit'|'todo', ... , expectedMtime, expectedHash }`; lock-check; apply core toggle; write via `cache.putContent`; return `{ ok, mtime, hash, completion }`; 400 / 403 / 404 / 409.
- [x] 4.3 Route tests: list (flat + nested, empty, sort); GET (project + experiment scope, bad id 400, traversal 403, missing 404); PATCH (commit + todo success, 409 stale mtime, bad sha / OOB index 400, traversal 403).

## 5. Data + client

- [x] 5.1 `apps/web/lib/server/data.ts`: `getCodeReviewsList(project)`, `getCodeReview(project, id)` from the runtime cache.
- [x] 5.2 `apps/web/lib/api.ts`: client `fetchCodeReviews(project)`, `fetchCodeReview(project, id)`, `patchCodeReviewProgress(project, id, body)`; types `CodeReviewSummary` / `CodeReview` / `CodeReviewCompletion`; query keys `['code-reviews', project]`, `['code-review', project, id]`.

## 6. Frontend

- [x] 6.1 `apps/web/app/p/[project]/code-review/page.tsx` — list landing; SSR-prefetch `['code-reviews', project]`.
- [x] 6.2 `apps/web/app/p/[project]/code-review/[...id]/page.tsx` — detail; SSR-prefetch list + `['code-review', project, id]`.
- [x] 6.3 `apps/web/components/code-review-list.tsx` — rows grouped Project-wide + per-experiment; completion badge; links.
- [x] 6.4 `apps/web/components/code-review-detail.tsx` — `<Markdown>` body + commit checklist + review todolist + completion; optimistic PATCH with 409 reload toast; live via SSE.
- [x] 6.5 `apps/web/components/code-review-commit-checklist.tsx` + `code-review-todolist.tsx` (shadcn `Checkbox`, `lucide-react` external-link icon).
- [x] 6.6 Add a "Code review" entry to the per-project navigation, active under `/p/<project>/code-review`.

## 7. Experiment page integration

- [x] 7.1 In `apps/web/components/experiment-detail.tsx`: associated-code-reviews panel filtering `['code-reviews', project]` by `experiment === id`, with completion badges + links to detail.

## 8. Mock fixtures

- [x] 8.1 `mock/project-a/docs/code-review/2026-05-24-<slug>.md` — project-wide; ≥1 commit + ≥2 todos; include a `$$…$$` block to exercise KaTeX.
- [x] 8.2 `mock/project-a/docs/experiments/E<NNNN>-<slug>/code-review/2026-05-24-<slug>.md` — experiment-scoped; frontmatter `experiment` matching the folder.

## 9. Verification

- [x] 9.1 `pnpm --filter @memon/core test` and `pnpm --filter @memon/web test` clean.
- [x] 9.2 `pnpm --filter @memon/core typecheck` and `pnpm --filter @memon/web typecheck` clean.
- [x] 9.3 Curl the APIs against a running server: `GET /api/code-reviews?project=project-a` (lists flat + nested); `GET` each scope's `[...id]`; `PATCH` a commit + a todo (200 + recomputed completion); `PATCH` with a stale mtime (409).
- [x] 9.4 UI verify per CLAUDE.md: fetch `/p/project-a/code-review` HTML and grep for the list rows/components; fetch a detail page and grep for the checklist markup + a KaTeX-rendered span; confirm referenced CSS tokens are defined; confirm the experiment detail page shows the associated-reviews panel.
- [x] 9.5 `openspec validate add-code-review-docs --type change` clean.
