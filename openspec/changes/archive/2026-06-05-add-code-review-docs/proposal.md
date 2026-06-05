## Why

Agents in this harness routinely produce large, multi-commit changes — a
session often lands a feature, a bug fix, and a refactor all at once,
sometimes spanning the main repo and one or more submodules. When a human
wants to review that work there is no curated entry point: they read raw
`git` diffs with no map of *what changed, why, how it was verified, or what
to check*. Nothing lets an agent leave behind a review guide, and the
dashboard has nowhere to track how far a human has gotten reviewing it.

This change introduces **code-review documents** — a new on-disk artifact
family plus the dashboard runtime + UI to read them and track per-commit and
per-todo review progress to completion. A code-review doc is human-facing
memory: an agent-authored guide to one session's worth of change, anchored
to the exact commits (with openable GitHub links) and the exact lines they
touched.

Per the established runtime-first convention, this change delivers the
**runtime + viewer** (which defines, parses, displays, and tracks the doc).
The agent-facing **authoring skill** (`memon-write-code-review`) that writes
these docs ships as a separate follow-up change once this is verified.

## What Changes

### On-disk artifact — the contract

- **New doc family at two locations** (scope = where it lives):
  - project-wide: `<projectRoot>/docs/code-review/<YYYY-MM-DD>-<slug>.md`
  - experiment-scoped: `<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md`
  - Filename = ISO date + kebab `<slug>` (`[a-z0-9][a-z0-9-]*`). One doc
    represents one reviewable unit (typically one session / one large
    change); it may span many commits.
- **Frontmatter is the structured, machine-read contract** — parsed +
  validated by the runtime, and the *only* part the viewer mutates:
  - `title`, `description`
  - `experiment` — `E<NNNN>-<slug>` for experiment-scoped, `null`/absent for
    project-wide (agrees with the file's location)
  - `created_at`, `updated_at` — ISO8601 with timezone offset
  - `commits[]` — each `{ repo, sha, url, subject?, reviewed }`. `repo` is the
    path relative to project root (`.` = main repo, otherwise the submodule
    path) so every commit self-identifies its repo; `url` is the **resolved,
    directly-openable** GitHub commit permalink; `reviewed` is the per-commit
    review checkbox.
  - `review_todolist[]` — each `{ item, done }`; the human's checkable review
    checklist, authored by the agent.
- **Body is opaque markdown**, rendered as-is (math + GFM). The recommended
  section scaffolding (Requirement / Changes / Verification / Notes, the
  per-change subsections, conventional-commit change titles, line-level
  permalinks) is an **authoring convention owned by the future skill**, NOT
  enforced by the parser — no `UNKNOWN_H2_SECTION`-style warnings; agents may
  extend the structure freely.
- **Completion is derived**, not stored: a review is complete iff every
  `commits[].reviewed` and every `review_todolist[].done` is `true`. No
  separate status field.
- **FS convention: additive, no version bump** (mirrors how reports/digests
  were introduced at v5).

### Backend — read + progress-write

- `GET /api/code-reviews?project=<name>` — list all reviews (both scopes),
  each with id, scope, `experiment`, `title`, times, and a **completion
  summary** (`reviewedCommits/totalCommits`, `doneTodos/totalTodos`,
  `isComplete`). Sorted by date desc.
- `GET /api/code-reviews/[id]?project=<name>` — one review: parsed
  frontmatter + raw body + `mtime` + `hash`.
- `PATCH /api/code-reviews/[id]?project=<name>` — **progress write**: toggle a
  single `commits[].reviewed` (by `sha`) or `review_todolist[].done` (by
  index) with mtime+hash optimistic locking. Re-serializes frontmatter, bumps
  `updated_at`, leaves the body byte-for-byte untouched; atomic
  `.tmp.<rand>` + rename. Returns new `mtime`/`hash` + recomputed completion.
  Stale write → 409 CONFLICT with current state.
- **Path safety**: every constructed path goes through
  `assertWithinProjectRoots()`; the `[id]` is validated against the
  `<date>-<slug>` shape; non-matching → 400 BAD_REQUEST.

### Runtime cache + live updates

- New `codeReviewsCache` (the existing `DirCache` pattern), warmed at startup,
  watching per project: `docs/code-review/` **and** every
  `docs/experiments/E*/code-review/`. The experiment-subdir set is
  recomputed when `docs/experiments/` changes (handles experiments created at
  runtime). Poller-driven; **no `fs.watch`**. On change it emits a
  `code-reviews-change` SSE event → invalidates `['code-reviews', project]`
  and `['code-review', project, id]`.

### Frontend

- New per-project tab + route `/p/[project]/code-review` — list grouped into
  project-wide + per-experiment, each row showing title, date, scope, and a
  completion badge.
- Detail route `/p/[project]/code-review/[id]` — renders the body markdown
  (reusing `<Markdown>`: remark-math/KaTeX + GFM) plus an interactive
  **commit checklist** (each commit: subject, repo, openable GitHub link, a
  checkbox) and the **review todolist** (checkable), with a derived
  completion state. Toggling a checkbox issues the progress PATCH
  (optimistic-locked) and live-updates via SSE.
- **Experiment detail page** gains a panel listing that experiment's
  associated code-reviews + their completion status, linking through to the
  detail view.

## Capabilities

### New Capabilities

- `code-review-store`: the on-disk shape (frontmatter schema, `<date>-<slug>`
  naming, the project + experiment locations), parse + completion-derivation
  rules, the list / get / progress-PATCH API contract, and discovery +
  polling semantics — including the nested `docs/experiments/E*/code-review/`
  scan that is one level deeper than the flat reports/digests dirs.
- `code-review-viewer`: the dashboard surface — list + detail, the commit
  checklist with openable per-repo GitHub links, the review todolist, the
  derived-completion display, the progress-toggle interaction, and the
  experiment-detail-page integration.

### Modified Capabilities

- `runtime-cache`: add `codeReviewsCache` to warmup + Poller registration +
  SSE emission, including the dynamic re-scan of `docs/experiments/*/code-review/`.
- `web-dashboard`: add the code-review project tab + routes alongside the
  existing experiments / hypotheses / journal / reports / digests surfaces.

## Impact

- **Code:**
  - `packages/core/src/`: `CodeReviewFrontMatter` zod schema (+ camelCase
    types), `CodeReviewSummary` / `CodeReview` types, `CODE_REVIEW_FILENAME_REGEX`,
    a completion-derivation helper, and discovery for the two locations.
  - `apps/web/lib/runtime.ts` (+ a `runtime/dir-cache.ts` extension for a
    dynamic / recomputed dir set): `codeReviewsCache` warmup, Poller
    registration, SSE emit.
  - `apps/web/app/api/code-reviews/route.ts` + `[id]/route.ts`.
  - `apps/web/lib/server/data.ts` (SSR fetchers) + `apps/web/lib/api.ts`
    (client fetchers + types, incl. the progress-PATCH wrapper).
  - `apps/web/app/p/[project]/code-review/page.tsx` + `[id]/page.tsx`;
    `apps/web/components/` for the list, detail, commit-checklist, and
    todolist; project nav entry.
  - `apps/web/components/experiment-detail.tsx`: associated-reviews panel.
- **Specs:** new `code-review-store`, `code-review-viewer`; modified
  `runtime-cache`, `web-dashboard`.
- **Tests:** API route tests (list; get; progress-PATCH success + 409
  conflict + 400 bad id + 403 path-safety; nested-vs-flat discovery); a
  parse + completion-derivation unit test; a render test for the detail
  view's checklist + completion states.
- **Mock fixtures:** add 1 project-wide + 1 experiment-scoped code-review
  under `mock/project-a/docs/` so the viewer is non-empty in dev.
- **Reuse:** `<Markdown>` (already wires remark-math + rehype-katex + GFM,
  so math rendering is free), the mtime+hash optimistic-lock + atomic-write
  pattern, `assertWithinProjectRoots()`, and the `DirCache`/Poller/SSE shape.
- **Backward compat:** none required — new doc family, new endpoints, new
  routes. Additive; no FS-convention bump.
- **Out of scope (follow-ups):**
  - The agent-facing authoring skill `memon-write-code-review` — a **separate
    change**, shipped after this runtime is verified (the body section
    scaffolding + the writing philosophy + the AskUserQuestion
    granularity-prompt all live there).
  - Building GitHub permalinks (commit URLs + `blob/<sha>/<path>#Lx-Ly`) — a
    skill/CLI concern; the store only stores and renders already-resolved
    URLs.
  - Creating / deleting reviews from the dashboard (authoring is the skill's
    job; the viewer is read + progress-toggle only).
  - Cross-linking review mentions, search, and tag filtering.
