## 1. Core file-listing + content readers

- [x] 1.1 Create `packages/core/src/git/files.ts` exporting
      `GitStatusFiles`, `GitFileEntry`, `ReadGitFileContentsResult`
      types and the `MAX_DIFF_BYTES = 1024 * 1024` constant.
- [x] 1.2 Implement `parsePorcelainV2ForFiles(stdout)` (pure helper)
      that reduces `1`/`2`/`u`/`?` lines into the three buckets per
      spec. Re-use the meta-line parsing from the existing reader
      (extract to a shared helper if needed).
- [x] 1.3 Implement `readGitStatusFiles(cwd, opts?)` wrapping the
      same `git status --porcelain=v2 --branch
      --ignore-submodules=all` call as `readGitStatus`. Reuse the
      error classification (`git-not-found` / `not-a-repo` /
      `timeout` / `error`).
- [x] 1.4 Implement `readGitFileContents(cwd, ref, path, opts?)`:
      - `ref === 'working'`: resolve `path` against `cwd`, confirm
        the resolved absolute path stays under `cwd`, `fs.readFile`,
        cap-check, binary-check, UTF-8 decode.
      - `ref === 'HEAD' | 'index'`: `execFile('git', ['show',
        '<ref>:<path>'], { cwd, timeout })`, capture stdout as a
        Buffer (not string), cap-check, binary-check, UTF-8 decode.
        Classify "not in HEAD" stderr → `reason: 'not-found'`.
- [x] 1.5 Re-export the new symbols from
      `packages/core/src/index.ts` (`readGitStatusFiles`,
      `readGitFileContents`, types, `MAX_DIFF_BYTES`).
- [x] 1.6 Unit tests in `packages/core/src/git/files.test.ts`:
      - parser: pure stdout → bucketed entries (clean / staged-only
        / unstaged-only / staged+unstaged / untracked / unmerged /
        renamed)
      - `readGitStatusFiles` end-to-end against real git (mkdtemp +
        `git init` helper)
      - `readGitFileContents`: small text, over cap, null-byte
        binary, invalid UTF-8, HEAD blob not present (untracked
        file), path-escape rejection (working ref).
- [x] 1.7 `pnpm --filter @memon/core typecheck` + full test green.

## 2. `/git-status/files` endpoint

- [x] 2.1 Create `apps/web/app/api/projects/[project]/git-status/
      files/route.ts`. Mirror the existing `/git-status/route.ts`
      project-resolution + viewer-scope + `export const dynamic =
      'force-dynamic'` boilerplate.
- [x] 2.2 Call `readGitStatusFiles(project.root)`; return JSON.
- [x] 2.3 Add `fetchGitStatusFiles(project)` + the
      `GitStatusFiles` / `GitFileEntry` types to
      `apps/web/lib/api.ts`.
- [x] 2.4 Integration test
      `apps/web/app/api/projects/[project]/git-status/files/
      route.test.ts`: owner 200 with bucketed payload (mock the
      reader); unknown project 404; viewer out-of-scope 403.

## 3. `/git-diff` endpoint

- [x] 3.1 Create `apps/web/app/api/projects/[project]/git-diff/
      route.ts`. Project resolution + viewer scope (identical
      pattern).
- [x] 3.2 Validate `path` and `side` query params per spec
      (400 on missing / null-byte / escape / invalid `side`).
- [x] 3.3 Per `side`, call `readGitFileContents` for old + new and
      assemble the `GitDiffResponse`:
      - `staged`: old=HEAD:path, new=index:path
      - `unstaged`: old=index:path, new=working:path
      - `untracked`: old=null, new=working:path
      - If either side returns `too-large` / `binary` →
        forward that as the response's `skipReason`.
- [x] 3.4 Add `fetchGitDiff(project, path, side)` + the
      `GitDiffResponse` type to `apps/web/lib/api.ts`.
- [x] 3.5 Integration test for the diff route covering:
      owner GET for unstaged text file → 200 ok=true with both
      contents; untracked → 200 with oldContent null; binary →
      200 skipReason binary; over cap → 200 skipReason too-large;
      path escape → 400; invalid side → 400; viewer out-of-scope
      → 403.

## 4. `useDiffViewMode()` hook

- [x] 4.1 Create `apps/web/lib/use-diff-view-mode.ts` with the
      hook + the `'memon:diff-view:mode'` localStorage key
      constant and the `'memon:diff-view-mode-change'` event-name
      constant.
- [x] 4.2 Implement read-on-mount with the default `'split'`;
      writer dispatches custom event + storage write.
- [x] 4.3 Subscribe in `useEffect` to BOTH the custom event AND
      the native `storage` event; clean up on unmount.
- [x] 4.4 Unit tests in `apps/web/lib/use-diff-view-mode.test.ts`
      (jsdom): default is split; setter persists to
      localStorage; second mounted instance receives the new
      mode after a custom-event dispatch; SSR-safe path (no
      `window`) returns the default without throwing.

## 5. Reusable `<FileDiff />` component

- [x] 5.1 Create `apps/web/components/file-diff.tsx` with the
      props shape from spec D5.
- [x] 5.2 Implement the loading / errorMessage / skipReason short-
      circuit branches.
- [x] 5.3 Mount `react-diff-viewer-continued`'s default export
      with `oldValue`, `newValue`, `splitView` from the hook,
      `useDarkTheme` matching the dashboard's theme (light for
      now; revisit if dark mode lands).
- [x] 5.4 Normalise CRLF → LF on both sides before passing to RDV.
- [x] 5.5 Component tests in `apps/web/components/file-
      diff.test.tsx`: skipReason short-circuits RDV; CRLF
      normalised; the view-mode hook's mode flows to RDV's
      splitView; loading renders skeleton; errorMessage renders
      destructive text.

## 6. `<GitDiffDialog />` component

- [x] 6.1 Create `apps/web/components/git-diff-dialog.tsx`. Props
      `{ project, open, onOpenChange }`. Wrapper around shadcn
      `<Dialog>`.
- [x] 6.2 Header summary: branch + ahead/behind + counts, fetched
      from the existing pill query (`['git-status', project]`)
      to avoid re-fetching what the pill already has.
- [x] 6.3 Sections: Staged / Unstaged / Untracked, fetched from
      `['git-status-files', project]` (enabled only when open).
      Use shadcn skeletons while loading.
- [x] 6.4 Toolbar: split/inline toggle wired to
      `useDiffViewMode()` — a shadcn `ToggleGroup` or a pair of
      buttons.
- [x] 6.5 File row component: status icon + path + chevron;
      collapsed by default; on expand mounts `<FileDiff />` with
      `['git-diff', project, path, side]` query.
- [x] 6.6 Empty-section placeholders: each section ALWAYS renders;
      when the section's array is empty, show `(none)` text rather
      than hiding the section.
- [x] 6.7 Renamed file rows render `oldPath → newPath` in the row
      header; the diff query uses `side` of the entry's bucket
      (always staged for renames).
- [x] 6.8 Dialog tests
      `apps/web/components/git-diff-dialog.test.tsx`: dialog
      opens with skeletons, then renders sections; rows are
      collapsed by default; clicking a row fires the diff
      request; collapsing + re-expanding reuses the cache.

## 7. Wire the footer pill click → dialog

- [x] 7.1 Modify `apps/web/components/project-footer.tsx` to
      manage `dialogOpen` state and render
      `<GitDiffDialog project={...} open={...} onOpenChange={...} />`
      alongside the pill.
- [x] 7.2 Wrap the `<GitStatusPill variant="footer" />` in a
      `<button>` whose `onClick` sets `dialogOpen = true`. Keep
      the existing tooltip wrapper inside `<GitStatusPill />` —
      hover + click must coexist.
- [x] 7.3 If `GitStatusPill` returns null (non-git project, etc.)
      the button SHALL render nothing — no broken click target.
      Achieve this with conditional rendering at the footer
      level (check whether the underlying TanStack query has
      `enabled:true` data) OR have the button itself check via
      the query.
- [x] 7.4 Verify the sidebar pill is NOT made clickable (no
      change required, but call it out in a sidebar test that
      asserts no `<GitDiffDialog />` mounts when the sidebar
      compact pill is clicked).

## 7b. Dialog sizing + 50/50 diff layout

- [x] 7b.1 `<DialogContent />` width:
      `w-[min(90vw,1600px)] max-w-none sm:max-w-none` (both
      `max-w-none` variants are required — shadcn's default
      `sm:max-w-sm` overrides the base-variant `max-w-none` on any
      viewport ≥ 640px otherwise).
- [x] 7b.2 `<FileDiff />` outer wrapper drops `overflow-auto`; uses
      `w-full min-w-0` instead.
- [x] 7b.3 Pass a `styles` override to `react-diff-viewer-continued`:
      `diffContainer { width: 100%, tableLayout: 'fixed' }`,
      `column / content / lineContent { width: 50%, minWidth: 0 }`,
      `contentText { whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      overflowWrap: 'anywhere' }`.

## 8. End-to-end verification

- [x] 8.1 `pnpm --filter @memon/core typecheck` clean; full core
      tests green.
- [x] 8.2 `pnpm --filter @memon/web typecheck` clean; full web
      tests green.
- [x] 8.3 Rebuild + restart prod per CLAUDE.md flow.
- [x] 8.4 Curl
      `/api/projects/project-a/git-status/files` and confirm a
      `200` with `enabled: true` and three bucketed arrays whose
      counts match the pill's `/git-status` response.
- [x] 8.5 Curl
      `/api/projects/project-a/git-diff?path=<a real unstaged
      file>&side=unstaged` and confirm `200 { ok: true,
      oldContent: '...', newContent: '...' }`.
- [x] 8.6 Curl
      `/api/projects/project-a/git-diff?path=../../etc/passwd&
      side=unstaged` and confirm `400`.
- [x] 8.7 Curl
      `/api/projects/project-a/git-diff?path=<a real large or
      binary file>&side=unstaged` and confirm
      `200 { ok: false, skipReason: ... }`.
- [x] 8.8 Curl `/p/project-a` HTML and confirm the footer
      contains a button-wrapped pill markup
      (`data-slot="git-diff-dialog-trigger"` or similar
      identifier).
- [x] 8.9 `openspec validate add-git-diff-dialog --type change`
      clean.
