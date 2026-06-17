## Why

Code-review docs (and markdown across the dashboard) are full of GitHub
line-permalinks (`blob/<sha>/<path>#Lx-Ly`). To review, a human clicks each one
out to GitHub — a context switch, and impossible for **private** repos the
dashboard host has on local disk but a browser may not be able to open. Since
every configured project's repo (and submodules) already lives on local disk, we
can preview the referenced code inline on hover, with **zero GitHub network
access**, gated to authenticated users so private source is never exposed to
anon callers.

## What Changes

### Config — per-project GitHub mapping

- Add an optional per-project `github` field: a **list** of `{ owner, repo, path }`
  entries, where `path` is the local path relative to the project root (`.` = the
  main repo, a submodule path otherwise). It lets the backend resolve a
  permalink's `github.com/<owner>/<repo>` to a local git repo. Projects without
  it simply get no previews (graceful). A list (not a single entry) so a
  project's main repo **and** its submodules can each map.

### Backend — local code-preview API

- New **`GET /api/code-preview?project=<name>&url=<github-permalink>`**:
  parses the permalink (owner / repo / sha / path / line range), resolves
  `owner/repo` → local path via the project's `github` config, reads the file at
  `<sha>:<path>` from the **local** repo (`readGitFileContents`), and returns the
  referenced lines plus a few lines of surrounding context (line numbers + which
  lines are the target). No network. Path validated by
  `assertWithinProjectRoots()`. Errors: 400 (unparseable url / bad params), 403
  (out of scope / path escape), 404 (owner/repo not mapped, or file/sha/lines not
  found).
- **Auth: `read`, project-scoped** — owner passes; a viewer passes only if the
  project is in their share scope; **anon is rejected**. This gating is what
  prevents others from pulling private-repo code through the endpoint.

### Frontend — one hover-preview in the already-unified Markdown renderer

- All dashboard markdown already renders through the single
  `apps/web/components/markdown.tsx` `<Markdown>` (code-review detail, experiment
  + run pages, reports / digests inbox). Add a `project` prop and an `a`-link
  override there: when an href is a GitHub blob line-permalink, render it via a
  new `<GithubPermalinkPreview>` that, **on hover**, fetches `/api/code-preview`
  and shows a popover **below the link** with the code — line-numbered, the
  target range highlighted, **scrollable** when long. Non-permalink links render
  unchanged; no `project` context or an unmapped repo → plain link. Because the
  renderer is shared, this lights up everywhere at once.
- Add a `hover-card` UI primitive (radix) + reuse `ScrollArea`. Lazy fetch on
  first hover (TanStack Query, keyed by url; code-at-a-sha is immutable → long
  `staleTime`).

## Capabilities

### New Capabilities

- `code-preview`: the per-project GitHub→local mapping, the
  `GET /api/code-preview` contract (permalink parse, local read at sha, context
  window), its path-safety, and its logged-in-only `read` auth.
- `markdown-link-preview`: the unified `<Markdown>` link override + the
  hover popover behavior (anchored below, scrollable, line-numbered, target
  range highlighted, graceful fallback to a plain link).

## Impact

- **Code:**
  - `packages/core/src/`: `ProjectConfigRawSchema` + `ProjectConfig` +
    `config/load.ts` normalize gain the `github` list; a permalink parser + a
    `readGitFileLines`/context-slice helper (or inline over `readGitFileContents`).
  - `apps/web/app/api/code-preview/route.ts` (new); `apps/web/lib/auth/route-classes.ts`
    (+1 read rule); `apps/web/lib/path-safety.ts` (reuse).
  - `apps/web/components/markdown.tsx` (+`project` prop, `a` override);
    `apps/web/components/github-permalink-preview.tsx` (new);
    `apps/web/components/ui/hover-card.tsx` (new); `apps/web/lib/api.ts`
    (`fetchCodePreview`). Thread `project` into `<Markdown>` at its ~5 call sites.
- **Deps:** `@radix-ui/react-hover-card`.
- **Specs:** new `code-preview`, `markdown-link-preview`.
- **Tests:** permalink-parser unit tests; API route tests (parse, mapping,
  read-at-sha, context window, 400/403/404, path-safety, auth read-scope); a
  render test that the `a` override wraps a permalink and leaves other links plain.
- **Config/fixtures:** add a `github` mapping to a real project (e.g. sparse-fsdp)
  for live use; a dev fixture mapping for the mock project pointing at a real
  local git repo so the popover is exercisable in dev.
- **Out of scope:** syntax highlighting of the preview (plain monospace + line
  numbers + highlighted target range; a highlighter is a heavy follow-up); any
  real GitHub-network fallback; previews for non-GitHub or non-`blob` links;
  editing code from the popover. No skill change.
