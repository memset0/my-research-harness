## 1. Widen `readGitFileContents` to accept arbitrary refs

- [x] 1.1 Change the `ref` parameter type from `'HEAD' | 'index' |
      'working'` to `'index' | 'working' | string`. Special-case
      `'index'` and `'working'`; everything else passes verbatim
      to `git show <ref>:<path>`.
- [x] 1.2 Update existing call sites in
      `apps/web/app/api/projects/[project]/git-diff/route.ts` —
      no behaviour change for staged/unstaged/untracked, just
      satisfy the new type.
- [x] 1.3 Extend the existing test
      `packages/core/src/git/files.test.ts` with:
      - reading bytes at an arbitrary SHA — `{ ok: true, content
        }`
      - reading bytes at `<sha>^` — parent contents
      - root commit's `<sha>^` → `{ ok: false, reason: 'not-
        found' }`

## 2. Core history readers (`packages/core/src/git/history.ts`)

- [x] 2.1 Create `packages/core/src/git/history.ts` exporting
      `GitBranches`, `GitBranchEntry`, `GitLog`, `GitCommitSummary`,
      `GitCommitDetail` types per spec.
- [x] 2.2 Implement `readGitBranches(cwd, opts?)` using
      `git for-each-ref refs/heads --format=...`,
      `git rev-parse --short HEAD`, and `git symbolic-ref --short
      -q HEAD` (non-zero exit ⇒ detached). Reuse the existing
      execFile error-classification helper from
      `git/status.ts`.
- [x] 2.3 Implement `readGitLog(cwd, { ref, limit }, opts?)` with
      `git log <ref> --max-count=<limit> --format=<NUL-delimited
      fields separated by RS \x1e>`. Parse NUL-then-RS into typed
      summaries.
- [x] 2.4 Implement `readGitCommit(cwd, sha, opts?)`:
      - metadata via `git show --format=... --no-patch <sha>`
      - file list via `git diff-tree -r --root --name-status
        <sha>`
      - `'not-found'` classification for "fatal: ambiguous
        argument" / "unknown revision" stderrs
- [x] 2.5 Re-export new symbols from
      `packages/core/src/index.ts`.
- [x] 2.6 Unit tests in
      `packages/core/src/git/history.test.ts`: branches with
      current + non-current; detached HEAD; log returns newest-
      first; log caps at limit; commit detail returns metadata +
      files; renamed file in commit; root commit (parents: [],
      files all `A`); unknown SHA → not-found.
- [x] 2.7 `pnpm --filter @memon/core typecheck` + full test green.

## 3. `/git-diff?side=commit&sha=` extension

- [x] 3.1 In `apps/web/app/api/projects/[project]/git-diff/route.
      ts`, add `'commit'` to the valid `side` union.
- [x] 3.2 When `side === 'commit'`, require `sha` query param
      (400 if missing); validate against
      `/^[A-Za-z0-9_\-/.~^]+$/` with length ≤ 200 (400
      otherwise).
- [x] 3.3 Compute `oldRef = '<sha>^'`, `newRef = '<sha>'`. The
      existing `not-found` → `oldContent: ''`, `status: 'added'`
      fallback handles root commits — no new branch needed.
- [x] 3.4 Extend the integration test
      `apps/web/app/api/projects/[project]/git-diff/route.test.ts`
      with:
      - owner GET with `side=commit&sha=<x>` → `ok: true` with
        both contents from the mocked reader
      - root-commit case (mock parent reader returns not-found) →
        `oldContent: ''`, `status: 'added'`
      - missing `sha` → 400
      - invalid `sha` (e.g. `foo;rm`) → 400
- [x] 3.5 Update `apps/web/lib/api.ts` `fetchGitDiff` signature
      to accept an optional `sha?: string`; build the URL with it
      when present.

## 4. New endpoints: `/git-branches`, `/git-log`, `/git-commit`

- [x] 4.1 Create `apps/web/app/api/projects/[project]/git-
      branches/route.ts`. Project resolution + viewer-scope rules
      match existing endpoints. Returns
      `readGitBranches(project.root)`.
- [x] 4.2 Create `apps/web/app/api/projects/[project]/git-log/
      route.ts`. Validate `ref` (required, safe-ref regex, ≤ 200
      chars) and optional `limit` (1..1000, default 100). Returns
      `readGitLog(...)`.
- [x] 4.3 Create `apps/web/app/api/projects/[project]/git-commit/
      route.ts`. Validate `sha` (required, safe-ref regex, ≤ 200
      chars). Returns `readGitCommit(...)`.
- [x] 4.4 Integration tests for the three routes:
      - branches: owner 200 + payload; 404 unknown project; 403
        viewer out-of-scope
      - log: owner 200 with bucketed commits; 400 missing ref;
        400 bad ref; 400 limit too large; 404 / 403 as above
      - commit: owner 200 with payload; 400 missing/bad sha;
        404 / 403 as above
- [x] 4.5 Add `fetchGitBranches(project)`, `fetchGitLog(project,
      ref, limit?)`, `fetchGitCommit(project, sha)` to
      `apps/web/lib/api.ts` with the matching types.

## 5. Extract `<FileRow />` for cross-dialog reuse

- [x] 5.1 Move `FileRow` + `FileRowBody` out of
      `apps/web/components/git-diff-dialog.tsx` into
      `apps/web/components/file-row.tsx`. Export both.
- [x] 5.2 Add optional `sha?: string` prop on `<FileRow />`.
      When provided, the query key is `['git-diff', project,
      path, side, sha]` and the fetcher passes `sha` through.
- [x] 5.3 Update `git-diff-dialog.tsx` to import from the new
      module. Existing callers pass `sha: undefined`.
- [x] 5.4 Existing dialog tests SHALL continue to pass without
      changes (asserts data-slots are stable).

## 6. `<GitHistoryDialog />` component

- [x] 6.1 Create `apps/web/components/git-history-dialog.tsx`
      with props `{ project, open, onOpenChange }`. Same Dialog
      shell sizing as `<GitDiffDialog />`
      (`w-[min(90vw,1600px)] max-w-none sm:max-w-none max-h-
      [90vh]`).
- [x] 6.2 Header: branch shadcn `<Select>` populated from
      `['git-branches', project]` query (lazy on dialog open).
      Default value resolves from `current` or, when detached, the
      synthetic `(detached @ <short-sha>)` entry.
- [x] 6.3 Refresh button to the right of the select, `data-slot
      ="git-history-refresh"`. On click: `queryClient.
      invalidateQueries({ queryKey: ['git-log', project, ref] })`
      AND `... { queryKey: ['git-branches', project] }`.
- [x] 6.4 Body left pane (`data-slot="commit-list"`): scrollable
      list of commit rows. Each row mounts a `<button>` per
      commit. Loading state = skeletons; error = retry message.
- [x] 6.5 Body right pane (`data-slot="commit-detail"`): empty
      placeholder until a commit is selected. On selection,
      `useQuery(['git-commit', project, sha])` fetches detail;
      while pending → skeletons; on success → header (full SHA,
      author, ISO date, full message) + list of `<FileRow project
      side="commit" sha={selectedSha} entry={f} />` instances.
- [x] 6.6 Relative time helper: small `formatRelativeTime(iso)`
      function in `apps/web/lib/format-relative-time.ts` (or
      inline in the row component). Use the full ISO date in the
      `title` attribute for hover detail.
- [x] 6.7 Component test
      `apps/web/components/git-history-dialog.test.tsx`:
      - dialog renders skeletons then commit list
      - clicking a commit fires `fetchGitCommit` exactly once and
        renders the file list
      - expanding a file row fires
        `fetchGitDiff(p, path, 'commit', sha)` exactly once
      - switching branch fires a fresh `fetchGitLog`
      - clicking refresh fires `fetchGitLog` AND
        `fetchGitBranches` BUT not `fetchGitCommit` for the
        already-resolved commit
      - the dialog's `DialogContent` has the size classes

## 7. Wire the two triggers

- [x] 7.1 Modify `apps/web/components/project-footer.tsx`:
      - Manage two booleans: `statusDialogOpen` and
        `historyDialogOpen` — they MUST be mutually exclusive
        (opening one closes the other).
      - Add a new `<button>` with `data-slot="git-history-
        dialog-trigger"` next to the existing pill trigger,
        using lucide `History` icon. Click → opens history.
      - Mount `<GitHistoryDialog project open=
        {historyDialogOpen} onOpenChange={setHistoryDialogOpen}
        />`.
      - The history button SHALL NOT render when the underlying
        git query is `enabled: false` (same gating as the pill).
- [x] 7.2 Modify `apps/web/components/git-diff-dialog.tsx` to
      accept an optional `onOpenHistory?: () => void` callback
      and, when present, render a `data-slot="git-diff-dialog-
      history-link"` link/button in the header.
- [x] 7.3 In `project-footer.tsx`, wire `<GitDiffDialog
      onOpenHistory={() => { setStatusDialogOpen(false);
      setHistoryDialogOpen(true) }} />`.
- [x] 7.4 Extend `git-diff-dialog.test.tsx` with a test that
      `data-slot="git-diff-dialog-history-link"` renders when
      `onOpenHistory` is provided AND invokes the callback on
      click.

## 8. End-to-end verification

- [x] 8.1 `pnpm --filter @memon/core typecheck` clean; full core
      tests green.
- [x] 8.2 `pnpm --filter @memon/web typecheck` clean; full web
      tests green.
- [x] 8.3 Rebuild + restart prod per CLAUDE.md flow.
- [x] 8.4 Curl `/api/projects/project-a/git-branches` → 200 with
      at least one entry, `current` matching `git symbolic-ref
      --short HEAD` of the project root.
- [x] 8.5 Curl `/api/projects/project-a/git-log?ref=<current>` →
      200 with `commits.length > 0`; first commit's `sha` matches
      `git log -1 --format=%H`.
- [x] 8.6 Curl `/api/projects/project-a/git-commit?sha=<head>` →
      200 with `enabled:true`, `files` matching `git show --name-
      status --format=`.
- [x] 8.7 Curl `/api/projects/project-a/git-diff?path=<a-real-
      committed-file>&side=commit&sha=<head>` → 200 with
      `ok:true, oldContent, newContent` set.
- [x] 8.8 Curl `/p/project-a` HTML and confirm the footer
      contains `data-slot="git-history-dialog-trigger"`.
- [x] 8.9 `openspec validate add-git-history-dialog --type
      change` clean.
