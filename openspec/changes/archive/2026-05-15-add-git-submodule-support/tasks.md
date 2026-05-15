## 1. Core submodule reader

- [x] 1.1 Create `packages/core/src/git/submodules.ts` exporting
      `GitSubmoduleEntry`, `GitSubmodules`, and
      `readGitSubmodules(projectRoot, opts?)` per spec.
- [x] 1.2 Implementation: `execFile('git', ['config', '--file',
      '.gitmodules', '--get-regexp', '^submodule\\..+\\.path$'],
      { cwd: projectRoot })`. Parse each line into
      `{ name, path }`. Empty `.gitmodules` (or absent) →
      `{ enabled: true, submodules: [] }`.
- [x] 1.3 Error classification matches existing readers: ENOENT
      git binary, "not a git repository" stderr, timeout, etc.
- [x] 1.4 Re-export the new symbols from
      `packages/core/src/index.ts`.
- [x] 1.5 Unit tests in
      `packages/core/src/git/submodules.test.ts`:
      - no `.gitmodules` → empty list
      - one submodule with matching name/path
      - submodule where name differs from path
      - non-repo cwd → enabled:false reason:not-a-repo
- [x] 1.6 `pnpm --filter @memon/core typecheck` + tests green.

## 2. `submodule` resolution helper used by routes

- [x] 2.1 Create a small helper
      `apps/web/lib/server/resolve-submodule-cwd.ts` exporting
      `resolveSubmoduleCwd(projectRoot, submodule)`:
      returns `{ ok: true, cwd }` when `submodule` matches an
      entry in `.gitmodules`; returns `{ ok: false, status: 400,
      message }` for unknown names. Missing/empty submodule →
      `{ ok: true, cwd: projectRoot }` (main repo).
- [x] 2.2 Unit test
      `apps/web/lib/server/resolve-submodule-cwd.test.ts`: mocks
      `readGitSubmodules` and verifies the three branches.

## 3. New endpoint: `GET /api/projects/:project/submodules`

- [x] 3.1 Create `apps/web/app/api/projects/[project]/submodules/
      route.ts`. Auth + project resolution match existing
      endpoints. Returns
      `readGitSubmodules(project.root)`.
- [x] 3.2 Add `fetchSubmodules(project)` + the `GitSubmodules` /
      `GitSubmoduleEntry` types to `apps/web/lib/api.ts`.
- [x] 3.3 Integration test
      `apps/web/app/api/projects/[project]/submodules/route.test.ts`:
      owner 200; viewer-in-scope 200; viewer-out-of-scope 403;
      unknown project 404.

## 4. Extend existing git endpoints with `?submodule=<name>`

- [x] 4.1 `git-status/files/route.ts`: add submodule resolution
      via the helper. Unknown name → 400. Pass resolved cwd to
      `readGitStatusFiles`.
- [x] 4.2 `git-diff/route.ts`: same pattern. Resolution applies
      to ALL sides (`staged`, `unstaged`, `untracked`, `commit`).
- [x] 4.3 `git-branches/route.ts`: same.
- [x] 4.4 `git-log/route.ts`: same.
- [x] 4.5 `git-commit/route.ts`: same.
- [x] 4.6 Update each route's tests to cover:
      - happy path with `?submodule=<known>` → reader receives
        the resolved cwd
      - `?submodule=<unknown>` → 400, reader not invoked
      - no submodule param → reader receives `project.root`
- [x] 4.7 Update API client signatures in `apps/web/lib/api.ts`:
      `fetchGitStatusFiles(project, submodule?)`,
      `fetchGitDiff(project, path, side, sha?, submodule?)`,
      `fetchGitBranches(project, submodule?)`,
      `fetchGitLog(project, ref, limit?, submodule?)`,
      `fetchGitCommit(project, sha, submodule?)`. URL-encode the
      submodule name when appending the query param.

## 5. Status dialog renders submodule blocks

- [x] 5.1 `git-diff-dialog.tsx`: on open, also fetch
      `['submodules', project]`. While that's pending, render the
      main repo block only (no submodule blocks).
- [x] 5.2 Once submodules resolve, render each block — main repo
      first, then each submodule in `.gitmodules` order. Each
      submodule block re-uses the existing three-section layout
      via a small `<RepoSections submodule={...} />` wrapper.
- [x] 5.3 Wire `<FileRow submodule={...} />` through so the diff
      fetch is scoped correctly.
- [x] 5.4 When a submodule's status query resolves
      `enabled: false`, render an inline placeholder
      ("not initialised" for `reason: 'not-a-repo'`, generic
      otherwise) instead of the three sections.
- [x] 5.5 Update `git-diff-dialog.test.tsx`:
      - mock `fetchSubmodules` (default: empty array)
      - test with two submodules: main block + 2 submodule
        blocks render
      - expanding a file inside a submodule fires
        `fetchGitDiff(project, path, side, undefined,
        'vendor/foo')`
      - submodule with `enabled: false` shows the "not
        initialised" placeholder

## 6. `<FileRow />` carries optional `submodule`

- [x] 6.1 Add `submodule?: string` to `FileRowProps`. Include it
      in the TanStack query key:
      `['git-diff', project, path, side, sha, submodule]`. Pass
      to `fetchGitDiff`.
- [x] 6.2 Update the existing `git-diff-dialog.tsx` and
      `git-history-dialog.tsx` call sites — main repo passes
      `submodule: undefined` (no behaviour change).

## 7. History dialog: submodule selector

- [x] 7.1 Add a `selectedSubmodule: string | ''` state to
      `HistoryBody` (default `''` = main repo).
- [x] 7.2 Render a `<Select data-slot="git-history-submodule-
      select">` to the LEFT of the existing branch select. Items:
      synthetic `main` (value `''`) + one per submodule fetched
      via `['submodules', project]`.
- [x] 7.3 On submodule change: clear `selectedRef` and
      `selectedSha`; the branches + log queries refetch via
      their `(project, submodule)` keys.
- [x] 7.4 Update query keys throughout the dialog:
      `['git-branches', project, submodule]`,
      `['git-log', project, submodule, ref]`,
      `['git-commit', project, submodule, sha]`. Pass `submodule`
      to each fetcher.
- [x] 7.5 Refresh button invalidates only the CURRENT submodule's
      branches + log queries.
- [x] 7.6 Update `git-history-dialog.test.tsx`:
      - mock `fetchSubmodules` (default empty)
      - test: switching the submodule select fires fresh
        branches + log with the new submodule arg
      - test: refresh invalidates only the current submodule's
        keys

## 8. Commit-marks: 5th column + submodule routing

- [x] 8.1 `commit-marks.ts`: extend `CommitMark` with `submodule:
      string`. Update `parseCsv` to accept BOTH the 4-column and
      5-column headers — legacy form sets `submodule = ''` and
      surfaces a `parseWarnings` entry ("legacy 4-column
      header").
- [x] 8.2 `serializeCsv` always emits the 5-column header. Sort
      rows by `(submodule, sha)` ascending.
- [x] 8.3 `setCommitMark(projectRoot, sha, { status, note?,
      submodule? })`: persist `submodule` on the row.
- [x] 8.4 `deleteCommitMark(projectRoot, sha, opts?)` where
      `opts` accepts `{ submodule? }`. The match is by
      `(sha, submodule)` exact tuple.
- [x] 8.5 Change `ReadCommitMarksResult.marks` from
      `Record<string, CommitMark>` to `CommitMark[]`. Update
      core tests accordingly.
- [x] 8.6 Update unit tests in
      `packages/core/src/git/commit-marks.test.ts`:
      - legacy 4-column file reads as `submodule: ''` + parse
        warning
      - 5-column round-trip
      - same SHA in main vs submodule coexist as distinct rows
      - sort order `(submodule, sha)` verified
      - writer always emits 5-column header (legacy file →
        write upgrades it)
      - `setCommitMark` / `deleteCommitMark` honour the
        submodule arg

## 9. Commit-marks endpoints: array shape + submodule param

- [x] 9.1 `/commit-marks/route.ts` (GET): return
      `{ marks: CommitMark[], parseWarnings: string[] }`. Update
      test.
- [x] 9.2 `/commit-marks/[sha]/route.ts` (PUT, DELETE): accept
      an optional `submodule` query param. When provided,
      validate against `readGitSubmodules` (unknown → 400). Pass
      the validated value through to the core writer.
- [x] 9.3 Update API client in `apps/web/lib/api.ts`:
      `setCommitMark(project, sha, input, submodule?)` and
      `deleteCommitMark(project, sha, submodule?)`. URL-encode
      the submodule when appending it as a query param.
- [x] 9.4 Update the existing client `CommitMarksResponse` type
      to the array shape; update consumers in
      `commit-mark-editor.tsx`, `commit-mark-badge.tsx`, and
      `git-history-dialog.tsx` to look up marks by
      `(sha, submodule)` instead of `Record[sha]`.

## 10. Components: thread submodule through

- [x] 10.1 `<CommitMarkEditor />`: add `submodule?: string` prop.
      Pass to the mutation calls. Update tests.
- [x] 10.2 `<GitHistoryDialog />`: pass the current submodule
      (from its selector) to `<CommitMarkEditor />` AND use it
      when looking up the mark for the selected commit. Update
      the badge mapping in the commit list too.
- [x] 10.3 Update `git-history-dialog.test.tsx`: switching
      submodules + marking a commit results in a PUT scoped to
      the right submodule.

## 11. End-to-end verification

- [x] 11.1 `pnpm --filter @memon/core typecheck` clean; core
      tests green.
- [x] 11.2 `pnpm --filter @memon/web typecheck` clean; web tests
      green.
- [x] 11.3 Rebuild + restart prod.
- [x] 11.4 Curl `GET /api/projects/<a-project-with-submodules>/
      submodules` → 200 with the expected names + paths.
- [x] 11.5 Curl
      `GET /api/projects/<p>/git-status/files?submodule=<name>`
      → 200 with the submodule's working-tree state.
- [x] 11.6 Curl
      `GET /api/projects/<p>/git-log?ref=main&submodule=<name>`
      → 200 with the submodule's commits.
- [x] 11.7 Curl
      `PUT /api/projects/<p>/commit-marks/<sha>?submodule=<name>`
      with `{"status":"verified","note":"in submodule"}` → 200
      with `mark.submodule === <name>`. `cat <projectRoot>/.memon/
      commit-marks.csv` shows the new 5-column row.
- [x] 11.8 Curl PUT with `?submodule=does-not-exist` → 400.
- [x] 11.9 `openspec validate add-git-submodule-support --type
      change` clean.
