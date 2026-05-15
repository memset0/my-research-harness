## Why

The project footer's git pill currently shows a one-line summary
(branch, ahead/behind, dirty counts) and a hover tooltip that lists
totals. To act on that information — "which files are staged?", "what
did I change in run.sh?" — users still have to flip to a terminal and
run `git status` / `git diff`.

We want a click-to-open dialog from the footer pill that surfaces the
**file lists** behind those counts AND lets the user expand any text
file to see the actual diff inline. Side-by-side and unified views,
toggle persisted across all open diff views, file-size + binary guards
to keep the dialog cheap.

This change also introduces a reusable `<FileDiff />` component. The
follow-up "commit history + diff" feature will mount it again against
HEAD ↔ commit pairs, so getting the component shape right now pays
off later.

## What Changes

- **NEW** click handler on the project-footer git-pill that opens a
  shadcn `<Dialog>` (the existing tooltip stays — hover and click do
  different things). The sidebar's compact pill is NOT clickable
  (clicking the row already toggles its `Collapsible`).
- **NEW** `GET /api/projects/:project/git-status/files` — returns the
  full file lists, separated into `staged`, `unstaged`, `untracked`,
  each entry `{ path, status }`. The pill's existing
  `/api/projects/:project/git-status` endpoint (counts only) is
  UNCHANGED, so polling stays cheap.
- **NEW** `GET /api/projects/:project/git-diff?path=<rel>&side=<staged|
  unstaged|untracked>` — returns `oldContent` + `newContent` strings,
  the filename(s), and the diff status. When either side exceeds the
  1024 KB cap OR is detected as binary, returns
  `{ skipReason: 'too-large' | 'binary', ... }` with no content.
- **NEW** `apps/web/components/file-diff.tsx` — reusable component
  wrapping `react-diff-viewer-continued` (already a dependency).
  Renders a single file's diff or the appropriate skip-reason
  placeholder. View mode (split / inline) comes from a shared hook,
  not props.
- **NEW** `apps/web/lib/use-diff-view-mode.ts` — `useDiffViewMode()`
  hook backed by `localStorage` key `memon:diff-view:mode`. All
  mounted instances stay in sync via a custom event AND the native
  `storage` event (cross-tab).
- **NEW** `apps/web/components/git-diff-dialog.tsx` — the dialog UI.
  Header: branch + ahead/behind + the same counts as the pill.
  Sections: Staged (N) / Unstaged (N) / Untracked (N), each
  collapsible. Inside each section, file rows are
  individually-collapsible (default collapsed). Toolbar holds the
  view-mode toggle (split / inline) wired to the shared hook.
- **MODIFIED** `apps/web/components/project-footer.tsx` — wrap the
  footer git pill in a click target that opens `<GitDiffDialog />`
  for the current project.
- **MODIFIED** `packages/core/src/git/status.ts` — add a new
  `readGitStatusFiles(cwd, opts?)` that returns
  `{ staged: GitFileEntry[]; unstaged: GitFileEntry[]; untracked:
  GitFileEntry[] }` parsed from the same `--porcelain=v2` stream.
- **NEW** in `@memon/core`: `readGitFileContents(cwd, ref, path,
  opts?)` for "the bytes at this side of the diff" (HEAD / index /
  working tree). Wraps `git show <ref>:<path>` (or fs read for the
  working tree). Enforces the 1024 KB cap and surfaces binary
  detection.

What's NOT changing:

- The pill's polling endpoint, cadence, throttle, and caching all
  stay exactly as `git_status.interval_ms` shipped. The dialog
  endpoints are lazy (fetched on dialog open / file expand) and
  unthrottled.
- No new top-level config knob. The 1024 KB cap is a constant in
  `@memon/core` (private to the diff reader); we'll lift it to
  config only if a real user asks.
- Commit history viewing remains explicitly out of scope — that's the
  next follow-up change. The `<FileDiff />` component is designed so
  the commit-history change can mount it without modification.

## Capabilities

### New Capabilities

- `git-diff-dialog`: The click-to-open dialog UX, the reusable
  `<FileDiff />` component, the shared view-mode hook + persistence,
  and the two new backend endpoints (`/git-status/files` and
  `/git-diff`).

### Modified Capabilities

- `git-status`: extends the capability to cover the new
  `readGitStatusFiles` reader and the `/git-status/files` endpoint
  (the existing pill endpoint and config knob are unchanged).

## Impact

- **Code**:
  - new core module `packages/core/src/git/files.ts` (file lists +
    content readers) + tests
  - new routes `apps/web/app/api/projects/[project]/git-status/files/
    route.ts` and `apps/web/app/api/projects/[project]/git-diff/
    route.ts` + tests
  - new components `file-diff.tsx`, `git-diff-dialog.tsx` + tests
  - new hook `use-diff-view-mode.ts` + tests
  - touched `project-footer.tsx` (wrap pill in click target)
  - new API client functions in `apps/web/lib/api.ts`
- **Dependencies**: zero new npm deps — `react-diff-viewer-continued`
  is already at `^4.2.2`.
- **System**: assumes the same `git` binary the existing reader
  already shells out to. No new system requirements.
- **Performance**: dialog payload bounded — counts + N file paths
  (typically < 100 entries on a research repo) + at most 1024 KB
  per expanded file. Lazy: file content fetched only on expand.
- **Security**: same project-name → root resolution as the existing
  `/git-status` route. Path parameter validated: must be a
  repository-relative path with no `..` segments after `path.resolve`
  comparison against `project.root`.
