## Context

Agent sessions land multi-commit changes (feature + fix + refactor, often
across the main repo and submodules). There is no human-facing artifact that
maps the work for a reviewer, and no dashboard surface to track review
progress. This change adds the **code-review doc** family and the runtime +
viewer for it. It is deliberately modeled on the `reports-store` /
`inbox-viewer` pair (archived change `inbox-reports-and-digests`): a
directory-shaped artifact, a `DirCache`, Poller-driven liveness, SSE
invalidation, optimistic-locked writes, and a per-project dashboard surface.

Three things make code-review docs different from reports/digests, and they
drive every decision below:

1. **Structured frontmatter is the contract.** Reports are plain markdown
   (title from first H1). Code-review docs carry machine-read frontmatter
   (`commits[]`, `review_todolist[]`, `experiment`, times) that the viewer
   both reads *and mutates* (checking boxes).
2. **Two locations, one flat + one nested.** Project-wide docs live in the
   flat `docs/code-review/`; experiment-scoped docs live nested in
   `docs/experiments/E<NNNN>-<slug>/code-review/` — one level deeper than the
   flat `docs/reports/` the existing `DirCache` was built for, and the set of
   experiment subdirs changes at runtime as experiments are created.
3. **Progress write, not content write.** The viewer's mutation is a single
   boolean toggle inside frontmatter, not a free-form body edit. The body is
   authored by the (future) skill and is preserved byte-for-byte by the
   runtime.

Existing pieces reused verbatim: `DirCache` (`apps/web/lib/runtime/dir-cache.ts`),
its `putContent()` mtime+hash optimistic-lock + atomic `.tmp.<rand>`+rename,
`assertWithinProjectRoots()`, the shared `Poller`, the SSE `events` bus, the
`<Markdown>` component (already wires `remark-math` + `rehype-katex` + GFM, so
math in `Design Decisions` renders for free), and core's `gray-matter` +
shared `yaml-engine` for frontmatter round-tripping.

## Goals / Non-Goals

**Goals**

- Define the on-disk code-review doc (frontmatter schema + `<date>-<slug>`
  naming + the two scope locations) as a parsed, validated contract.
- Discover + serve docs from BOTH the flat project dir and the nested
  per-experiment dirs, live (Poller, no `fs.watch`), with the experiment
  subdir set tracked as experiments come and go.
- A list API + a single-doc API + a **progress-toggle PATCH** with the same
  mtime+hash optimistic-lock guarantees as the README/report write flow.
- A viewer (list + detail) that renders the body (KaTeX/GFM) and exposes the
  commit checklist + review todolist as live checkboxes, with a derived
  completion state; plus an associated-reviews panel on the experiment page.

**Non-Goals**

- **Authoring.** Creating/editing the doc body is the future
  `memon-write-code-review` skill's job; the viewer is read + progress-toggle
  only. No "new review" button, no Monaco body editor in v1.
- **Building GitHub URLs.** The store records and renders already-resolved
  `url`s; deriving commit/permalink URLs from git remotes (with submodule
  awareness) is a skill/CLI concern in the follow-up change.
- **Body structure enforcement.** The recommended sections
  (Requirement/Changes/Verification/Notes, the per-change subsections,
  conventional-commit titles, line permalinks) are an authoring convention,
  NOT parsed or warned on. Agents may extend freely.
- Cross-linking review mentions, search, tag filtering, FS-version bump.

## Decisions

### D1. Scope = where it lives; `experiment` frontmatter is the canonical association

A doc is **project-wide** when it lives in `docs/code-review/`, and
**experiment-scoped** when it lives in
`docs/experiments/E<NNNN>-<slug>/code-review/`. The frontmatter `experiment`
field SHALL equal the enclosing `E<NNNN>-<slug>` for experiment-scoped docs
and be `null`/absent for project-wide docs; the authoring skill keeps them in
sync.

For grouping and the experiment-page panel the runtime keys off the
**frontmatter `experiment` field** (explicit, queryable without path
parsing), not the path. The path determines only *where the file is found*.
If the two disagree (hand-edited file), frontmatter wins; no warning in v1.

### D2. Discovery: a flat dir + a runtime-tracked set of nested dirs

`codeReviewsCache` is a `DirCache<CodeReviewSummary>`. Its watched dirs are:

- the flat `<root>/docs/code-review/` for every project (static), plus
- every existing `<root>/docs/experiments/E<NNNN>-<slug>/code-review/`
  (dynamic — recomputed as experiments and their `code-review/` subdirs come
  and go).

`DirCache` currently takes a static `dirs[]`. We extend it with `addDir(dir,
poller?)` (register + scan + watch a new content dir) and `removeDir(dir)`
(drop a dir's cache state). The nested set is reconciled in two places in the
runtime's Poller dispatch:

- The existing `docs/experiments/` dir-mtime branch (runtime.ts ~286) already
  fires when an experiment folder is **created/removed**. We extend it to
  also `addDir`/`removeDir` the corresponding `E*/code-review/` dirs and to
  register each experiment **folder** with the Poller.
- A new branch handles an **experiment folder's** own mtime advancing (which
  is what happens when a `code-review/` subdir is first created inside an
  *existing* experiment): if `<expFolder>/code-review/` now exists and isn't
  watched, `addDir` it.

Warmup seeds the nested set by scanning each discovered experiment for a
`code-review/` subdir. This keeps "no `fs.watch`, polling only" intact while
catching both "new experiment" and "first review inside an old experiment".

Rejected alternative: fold code-review scanning into `discoverExperiments`
and hang the list off the `Experiment` record. Rejected because project-wide
docs have no experiment to hang off, and it would couple two caches with
different lifecycles; a single `codeReviewsCache` covering both scopes is
simpler to reason about.

### D3. Addressing: catch-all `[...id]`, id = docs-relative path minus `.md`

A code-review's `id` is its path **relative to `<root>/docs/`, without the
`.md`** — e.g. `code-review/2026-05-24-bf16-fix` or
`experiments/E0042-attn/code-review/2026-05-24-bf16-fix`. Because it contains
slashes, both the API route and the page route are **catch-all** segments
(`[...id]`). This is naturally reversible (`join(root, 'docs', ...id) + '.md'`)
and needs no delimiter encoding.

Validation on every request: reconstruct the absolute path, run it through
`assertWithinProjectRoots()` (→ 403 on escape), and require the reconstructed
relative path to match exactly one of:
- `^code-review/<date>-<slug>$`
- `^experiments/E\d{4}-[a-z0-9-]+/code-review/<date>-<slug>$`

Anything else → 400 BAD_REQUEST. A well-formed id with no file → 404.

### D4. Frontmatter schema (zod, lenient) + opaque body

`packages/core/src/schemas.ts` gains `CodeReviewFrontMatterRawSchema` (raw
snake_case, validated with sensible defaults so hand-edits degrade
gracefully), and `types.ts` gains the camelCase `CodeReviewFrontMatter`,
`CodeReviewSummary` (list metadata), and `CodeReview` (detail) types.

```
title:           string                       (required)
description:     string                       (default '')
experiment:      string | null                (E-id or null)
created_at:      string (ISO8601 + offset)    (required)
updated_at:      string (ISO8601 + offset)    (required)
commits:         Array<{ repo: string; sha: string; url: string;
                         subject?: string; reviewed: boolean (default false) }>
review_todolist: Array<{ item: string; done: boolean (default false) }>
```

The body below the frontmatter is opaque markdown, never parsed for
structure, never warned on, preserved verbatim on write. Parsing uses core's
`gray-matter` + shared `yaml-engine` (so on-write serialization matches the
rest of the repo).

### D5. Completion is derived, not stored

```
totalCommits   = commits.length
reviewedCommits= commits.filter(reviewed).length
totalTodos     = review_todolist.length
doneTodos      = review_todolist.filter(done).length
isComplete     = (totalCommits + totalTodos > 0)
                 && reviewedCommits === totalCommits
                 && doneTodos === totalTodos
```

An empty review (no commits, no todos) is **not** complete — there is nothing
to have reviewed. No `status` field; the checkboxes are the single source of
truth. The completion summary rides on both the list item and the detail
payload, and the recomputed value is returned by the progress PATCH.

### D6. Progress write = single-toggle PATCH, reusing `putContent`

`PATCH /api/code-reviews/[...id]?project=NAME` body is one of:
- `{ op: 'commit', sha, reviewed, expectedMtime, expectedHash }`
- `{ op: 'todo', index, done, expectedMtime, expectedHash }`

Handler: read fresh via `cache.getContent()`; if `mtime`/`hash` mismatch
`expected*` → 409 CONFLICT (with current state). Else `gray-matter`-parse,
flip the addressed `commits[].reviewed` / `review_todolist[index].done`, bump
`updated_at` to now (ISO8601 + offset), `gray-matter`-stringify with the
shared engine (**body string passed through untouched**), and write the full
new content via `cache.putContent(absPath, newContent, expectedMtime,
expectedHash)` — which re-checks the lock and does the atomic rename. Return
`{ ok, mtime, hash, completion }`.

Reusing `putContent` means no second write primitive and identical
optimistic-lock semantics to reports/READMEs. We deliberately do NOT expose a
full-content PUT in v1 (body editing is the skill's job).

### D7. Viewer: reuse `<Markdown>`; detail = body + checklists + completion

- List route `/p/[project]/code-review`: rows grouped into "Project-wide" and
  one group per experiment (by frontmatter `experiment`), each row showing
  title, date, scope, and a completion badge (`3/5 · 2/4` or ✓ Complete).
- Detail route `/p/[project]/code-review/[...id]`: renders `<Markdown>{body}`
  (math + GFM already supported), a **commit checklist** (per commit: subject,
  `repo`, an external-link to `url`, a checkbox bound to `reviewed`), the
  **review todolist** (checkbox per item), and the derived completion state.
  Toggling a box fires the PATCH (optimistic UI + rollback on 409 with a
  "stale snapshot — reload" toast, matching `<EditReadmeButton>`), and SSE
  `code-reviews-change` keeps it live.
- Checkboxes use the shadcn `Checkbox` primitive; external links use
  `lucide-react`'s external-link icon. No new deps.

### D8. Experiment page integration via the existing list query

`apps/web/components/experiment-detail.tsx` gains a panel that consumes the
already-cached `['code-reviews', project]` list, filters to
`frontmatter.experiment === <this experiment id>`, and renders each with its
completion badge linking to the detail route. No change to
`GET /api/experiments/[id]`; the panel is a pure client-side filter over data
the viewer already fetches, so it stays in sync via the same SSE topic.

### D9. SSE + query keys

`onUpdate(dir)` emits `code-reviews-change` with the dir's project (resolved
by a prefix check that also matches nested `code-review/` dirs). The client
invalidates `['code-reviews', project]` and `['code-review', project, id]`,
mirroring the reports topic wiring.

## Risks / Trade-offs

- **Dynamic nested-dir tracking is the main new complexity.** Two reconcile
  points (experiments-dir change, experiment-folder change) plus warmup
  seeding. → Mitigation: unit-test `addDir`/`removeDir` and the reconcile
  logic against a temp fixture tree (new experiment, new `code-review/` in an
  old experiment, removed experiment).
- **Catch-all id is a path-injection surface.** → Mitigation: reconstruct,
  `assertWithinProjectRoots()`, AND match the two strict shape regexes before
  any FS access.
- **Frontmatter round-trip formatting.** `gray-matter` re-emit may reorder
  keys / drop comments. → Acceptable: files are machine-authored; the body
  (the human-meaningful part) is preserved byte-for-byte; only frontmatter
  YAML is regenerated.
- **Optimistic lock vs. a skill rewriting the doc mid-review.** Surfaces as a
  409 at toggle time with a reload affordance — same UX as README editing.
- **Backward compat:** none required. New doc family, new endpoints, new
  routes, additive cache. No FS-convention bump (mirrors how reports/digests
  were added at v5).

## Migration Plan

1. Core: `CodeReviewFrontMatterRawSchema` + types + `CODE_REVIEW_FILENAME_REGEX`
   + a `deriveCompletion()` helper + exports; unit tests.
2. `DirCache`: add `addDir`/`removeDir`; unit-test.
3. Runtime: `codeReviewsCache` (flat dirs static + nested seeded at warmup),
   Poller registration, the two reconcile branches, `code-reviews-change`
   SSE. Verify by curl against a fixture.
4. API: `/api/code-reviews/route.ts` (list) + `[...id]/route.ts` (GET, PATCH);
   route tests (success, 409, 400, 403, 404; flat + nested).
5. Data: `server/data.ts` SSR fetchers + `lib/api.ts` client fetchers/types +
   the progress-PATCH wrapper.
6. UI: list + detail routes, commit-checklist, review-todolist, completion
   badge, nav tab. Verify per CLAUDE.md (served HTML contains the components;
   CSS tokens present).
7. Experiment-detail panel.
8. Mock fixtures (1 project-wide + 1 experiment-scoped).
9. Update specs; `openspec validate add-code-review-docs --type change` clean.

Rollback: one revert per commit. New endpoints disappear, routes 404, tab
gone, cache no longer instantiated. No on-disk state to undo.

## Open Questions

1. **Project-wide doc that sets `experiment`.** Per D1 frontmatter wins, so
   such a doc would associate to that experiment despite living in the flat
   dir. Allowed and harmless (flexible); the skill won't do it. Left as-is.
2. **Pagination of the list.** Not needed at current scale (tens of docs).
   The list is served from cache; revisit only if a project accumulates
   hundreds.
