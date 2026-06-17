## 1. Core: config + permalink parser + context slice

- [x] 1.1 `packages/core/src/schemas.ts`: add `github` to `ProjectConfigRawSchema` — `z.array(z.object({ owner: z.string().min(1), repo: z.string().min(1), path: z.string().min(1) })).optional()`.
- [x] 1.2 `packages/core/src/types.ts`: `ProjectConfig.github?: Array<{ owner: string; repo: string; path: string }>` (path absolute after load).
- [x] 1.3 `packages/core/src/config/load.ts`: normalize `github` — resolve each `path` against the project root (absolute).
- [x] 1.4 `packages/core/src/git/github-permalink.ts`: `parseGithubPermalink(url)` → `{ owner, repo, sha, path, startLine, endLine } | null` (accept `#L<a>` and `#L<a>-L<b>`; reject non-github / non-`blob` / no `#L`); `sliceContext(content, startLine, endLine, ctx, maxLines)` → `{ lines: Array<{ n, text, target }>, startLine, endLine, truncated }`. Export both from `index.ts`.
- [x] 1.5 Unit tests: parser (single line, range, reject non-blob / no-anchor / non-github / branch-not-sha tolerated-or-rejected); `sliceContext` (range, clamp to file start/end, cap → truncated, correct `target` flags).

## 2. Backend API + auth

- [x] 2.1 `apps/web/app/api/code-preview/route.ts` (GET): require `project` + `url`; `parseGithubPermalink`; find the project's `github` entry matching `owner/repo` (404 if none); `localRoot = resolve(projectRoot, entry.path)`, `filePath = join(localRoot, permalink.path)`; `assertWithinProjectRoots` on both (403 on escape); `readGitFileContents(localRoot, sha, permalink.path)` (404 not-found); `sliceContext`; return `{ owner, repo, sha, path, startLine, endLine, lines, truncated }`. 400 on bad/missing url. (Also: graceful 200 + `reason` for too-large/binary.)
- [x] 2.2 `apps/web/lib/auth/route-classes.ts`: add `{ match: methodIs(['GET'], exact('/api/code-preview')), class: 'read', projectFor: projectQueryOrMulti() }` (before the mutating fallthrough).
- [x] 2.3 Route tests: happy path (single + range), 400 (missing/!blob/!github url), 404 (unmapped owner/repo; missing file/sha), 403 (path traversal). Add a route-classes test asserting `/api/code-preview` is `read` + project-scoped (and non-GET → mutating, fail-closed).

## 3. UI primitive

- [x] 3.1 `apps/web/components/ui/hover-card.tsx` (shadcn wrapper: `HoverCard` / `HoverCardTrigger` / `HoverCardContent`). NOTE: used the already-installed `radix-ui` meta-package (matches `ui/scroll-area.tsx` etc.) instead of adding a standalone `@radix-ui/react-hover-card` — no new dependency.

## 4. Frontend integration (the one shared renderer)

- [x] 4.1 `apps/web/lib/api.ts`: `CodePreview` type + `fetchCodePreview(project, url)`.
- [x] 4.2 `apps/web/components/github-permalink-preview.tsx` (client): `HoverCard` whose trigger is the original `<a href>` (still navigates to GitHub); on open, lazy `useQuery(['code-preview', project, url], …, { staleTime: 5m, retry: false })`; `HoverCardContent side="bottom"` with a native `overflow-auto` (max-h-80, two-axis) panel — monospace lines + line-number gutter + highlighted `target` rows; header (owner/repo · path · #L · sha7); loading / error / too-large / binary / truncated states. (Native scroll, not the shadcn `ScrollArea`, so both axes scroll without forking the primitive — F3.)
- [x] 4.3 `apps/web/components/markdown.tsx`: add `project?: string` prop; build `components` via `useMemo` and add an `a` entry — if `href` matches a GitHub blob line-permalink regex AND `project` is set → `<GithubPermalinkPreview project href>{children}</>`, else plain `<a target=_blank rel=noreferrer>` for external (or bare `<a>` for in-page). Client-side regex (`isGithubBlobPermalink`); does NOT import `@memon/core`.
- [x] 4.4 Thread `project` into every real-content `<Markdown>`: `code-review-detail.tsx`; `experiment-page.tsx` (Warnings + `SectionCard` ×5 + `RunSection` ×3, signatures extended); `experiment-detail.tsx` (`SectionCard` ×4, signature extended); `inbox-shell.tsx` (`RenderedItem`, signature extended). `EmptyState` markdown is hardcoded UI copy (no permalinks) — intentionally left without `project`.

## 5. Config / fixtures

- [x] 5.1 `config.yml` (local, gitignored): added `github` mappings for `sparse-fsdp` (`mem-research/sparse-fsdp`), `vsqa` (root + 3 submodules), `casual-parallel-drafting` (root + 5 submodules) so previews work live on real code-review docs.
- [x] 5.2 Dev fixture + docs: `config.example.yml` (committed) documents the `github` field incl. submodule entries. Local `config.yml` maps the mock `acme/project-a` + `acme/fsdp-ext` → `mock/project-a`; the fixture permalink shas are fabricated, so a dev hover exercises the trigger → loading → "couldn't load" path. Real-code 200 previews are verified live against `sparse-fsdp` (see 6.2).

## 6. Verify

- [x] 6.1 `pnpm --filter @memon/core typecheck && test`; `pnpm --filter @memon/web typecheck && test` (parser, route, route-classes, render) clean.
- [x] 6.2 Curl `/api/code-preview`: happy path (single + range) against a real project, 400, 404 (unmapped), 403 (traversal); confirm no-creds → 401 (logged-in-only).
- [x] 6.3 UI verify per CLAUDE.md: fetch a code-review detail page, confirm a permalink renders the hover-preview trigger markup and ordinary links are unaffected; confirm hover-card popover tokens (`--popover` / `--popover-foreground`) are defined in the compiled CSS.
- [x] 6.4 `openspec validate add-permalink-hover-preview --type change --strict` clean.
