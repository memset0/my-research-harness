## Context

GitHub line-permalinks are everywhere in dashboard markdown (code-review docs
especially). The repos they point at are already on local disk (project roots +
submodules). All markdown already renders through ONE component
(`apps/web/components/markdown.tsx`), so a single link override lights the
feature up everywhere. Reuse: `readGitFileContents(cwd, ref, path)` from
`@memon/core` (reads a file at a sha from a local repo), the `read`-class +
project-scope auth pattern in `route-classes.ts`, `assertWithinProjectRoots()`,
`jsonFetch` + TanStack Query, and `ScrollArea`.

## Goals / Non-Goals

**Goals:** hover a GitHub permalink in any rendered markdown → a popover below it
previews the referenced lines + surrounding context, read from the local repo,
no GitHub network, gated to authenticated users.

**Non-Goals:** syntax highlighting (plain monospace + line numbers for v1); any
real GitHub-network fetch; previews for non-GitHub or non-`blob` links; editing
from the popover.

## Decisions

### D1. Config: per-project `github` list (submodule-aware)
`github?: Array<{ owner, repo, path }>`; `path` is local, relative to the
project root (`.` = main repo, else a submodule path). A list so a project's main
repo and each submodule can map to their GitHub owner/repo. Optional — no entry
⇒ no preview for that owner/repo.

### D2. Resolution is server-side; the client only screens
The client `a`-override does a cheap regex test for a GitHub blob line-permalink
and, if matched, passes the **raw url** to the API. The server parses + maps +
reads. This keeps `@memon/core` (git/fs) out of the client bundle.

### D3. API contract + context window
`GET /api/code-preview?project=<name>&url=<permalink>` →
`{ owner, repo, localPath, sha, path, startLine, endLine, lines: Array<{ n, text, target }>, truncated }`.
The window is `[startLine - CTX, endLine + CTX]` (CTX = 12), clamped to the file
and capped at `MAX_LINES` (400) with `truncated: true` when the target range
itself exceeds the cap. `target: true` marks the lines the permalink points at.

### D4. Auth: `read`, project-scoped
Registered `read` with `projectFor = projectQueryOrMulti()` (the `?project=`).
Owner passes; a viewer passes only if `project` is in their share scope; anon is
rejected — the gate that stops code theft. **Noted trade-off:** a scoped viewer
can read the *source* of that project's configured repos (not just its
experiment docs). That is consistent with "logged-in users only" and with a
viewer's existing read access to the project; if undesired, flip this route to
`mutating` (owner-only). Defaulting to `read` to match the user's "登录的用户"
wording and the rest of the per-project read API.

### D5. Path safety
Resolve `localRepoRoot = resolve(projectRoot, githubEntry.path)`; the file read
path = `join(localRepoRoot, permalink.path)`. Run BOTH the repo root and the
resolved file path through `assertWithinProjectRoots()` (→ 403 on escape). The
permalink `path` is taken relative to the mapped repo root (so a submodule
permalink's path is relative to the submodule, matching how the doc author built
it).

### D6. UI: radix hover-card
Add `@radix-ui/react-hover-card` + `apps/web/components/ui/hover-card.tsx`
(standard shadcn wrapper). The popover is `side="bottom"`, holds a `ScrollArea`
(max height, scroll when long), renders the lines monospaced with a gutter of
line numbers and the `target` rows visually highlighted. Open on hover with a
small delay; lazy `useQuery` (keyed by the url) fires on first open; long
`staleTime` since code at a sha is immutable. Loading + error (unmapped / not
found) states render inside the card; on hard failure the link still works as a
normal link.

### D7. No syntax highlighting in v1
A real highlighter (shiki/prism) is a 100s-of-KB-to-MB bundle hit. v1 renders
plain monospace + line numbers + highlighted target range. Highlighting is a
clean follow-up.

### D8. Threading `project` into the shared `<Markdown>`
`<Markdown>` gains an optional `project?: string`. The `a`-override uses it +
the permalink regex to decide whether to wrap a link in
`<GithubPermalinkPreview project url>`. Thread `project` at the ~5 call sites
(code-review detail, experiment-page, experiment-detail, inbox-shell ×2). No
`project` ⇒ links render plain (safe default).

## Risks / Trade-offs

- **Scoped-viewer reads source (D4)** — flagged; flip to owner-only if desired.
- **Sha not present locally** (shallow clone / unfetched commit) → `readGitFileContents`
  returns not-found → 404; the popover shows "couldn't load" and the link still
  works.
- **Submodule path mapping** — the permalink path must be relative to the mapped
  repo; documented in the config + the skill already builds links that way.
- **Bundle** — hover-card is small; no highlighter added.

## Migration Plan

1. Core: config `github` list (schema + type + loader) + permalink parser +
   context-slice helper + tests.
2. API `/api/code-preview` + auth `read` rule + route tests.
3. UI primitive `ui/hover-card.tsx` (+ dep).
4. `markdown.tsx` (`project` prop + `a` override) + `github-permalink-preview.tsx`
   + `api.ts` fetcher; thread `project` at call sites.
5. Config/fixtures: real project mapping + a dev mock pointing at a real local
   repo; verify per CLAUDE.md (served HTML + the preview renders).

## Open Questions

1. `read` vs owner-only for `/api/code-preview` (D4) — default `read`; trivially
   tightened later.
2. Context window size (CTX=12, MAX=400) — tunable constants.
