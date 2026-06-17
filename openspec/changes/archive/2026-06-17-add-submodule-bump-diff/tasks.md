## 1. Core: switch `readGitCommit` to `--raw` + extract submodule pointers

- [x] 1.1 In `packages/core/src/git/history.ts`, replace the
      diff-tree call from `--name-status` to `--raw`. New parser
      `parseDiffTreeRaw(stdout)` (replaces or supplements
      `parseDiffTreeNameStatus`) handles the
      `:<oldMode> <newMode> <oldSha> <newSha> <status>\t<path>`
      format; for `R`/`C` status the extra `\t<origPath>` segment
      is captured.
- [x] 1.2 Extend `GitFileEntry` (in
      `packages/core/src/git/files.ts`) with optional
      `submoduleBump?: { fromSha: string; toSha: string }`.
- [x] 1.3 In the new parser, populate `submoduleBump` whenever
      `oldMode === '160000'` AND `newMode === '160000'`.
- [x] 1.4 Update the existing `parseDiffTreeNameStatus` callers /
      tests in core. Either keep the old parser around for
      backward compat OR migrate all call sites; pick whichever
      makes the diff cleaner.
- [x] 1.5 Unit tests in `packages/core/src/git/history.test.ts`:
      - `git diff-tree --raw` regular modify produces no
        `submoduleBump`
      - rename `R100` parses path + origPath, no `submoduleBump`
      - submodule pointer bump (`160000 160000 M`) produces
        `submoduleBump: { fromSha, toSha }`
      - real-git E2E: a commit that `git submodule add`-s a
        repo and a follow-up commit that bumps its pin
- [x] 1.6 `pnpm --filter @memon/core typecheck` + tests green.

## 2. Core: range reader pieces

- [x] 2.1 Add a `readGitRange(cwd, { from, to }, opts?)` helper
      in `packages/core/src/git/history.ts`:
      - `git log --format=<existing NUL-RS spec> <from>..<to>`
        → commits array
      - `git diff-tree -r --root --raw -M <from>..<to>` → files
        array via the shared raw parser from §1
      - returns
        `{ enabled: true, commits, files } | { enabled: false, reason }`
- [x] 2.2 Re-export from `packages/core/src/index.ts`. Add the
      `GitRange` discriminated-union type next to the existing
      `GitLog` / `GitCommitDetail`.
- [x] 2.3 Unit tests in `history.test.ts`:
      - empty range (`<from>..<from>`) → 0 commits, 0 files
      - range with 3 commits and N files → counts match
      - unknown ref → `enabled: false, reason: 'error'`

## 3. Endpoints

- [x] 3.1 `/git-diff/route.ts`: add `range` to the valid `side`
      union. Validate `from` + `to` query params (required,
      safe-ref regex, ≤ 200 chars). Compute `oldRef = from`,
      `newRef = to`. Existing fallback / skipReason logic
      passes through unchanged.
- [x] 3.2 New route file
      `apps/web/app/api/projects/[project]/git-range/route.ts`:
      validate `from`, `to`, and optional `submodule`; resolve
      cwd via the existing helper; call `readGitRange`.
- [x] 3.3 Integration tests:
      - `/git-diff?side=range&from=&to=` happy path + missing
        `from`/`to` 400 + invalid sha 400
      - `/git-range` owner 200 with expected payload; 400 on
        missing args; 400 on unknown submodule

## 4. API client

- [x] 4.1 Refactor `fetchGitDiff` signature in `apps/web/lib/api.ts`
      to use an options bag:
      `fetchGitDiff(project, path, side, opts?: { sha?,
      submodule?, from?, to? })`.
- [x] 4.2 Add `fetchGitRange(project, from, to, submodule?)` and
      the `GitRangeResponse` type.
- [x] 4.3 Migrate every existing call site to the new
      `fetchGitDiff` shape. Compile-error-driven; tests must
      pick up the new shape too.

## 5. `<FileRow />`: add `range` prop + `side="range"` plumbing

- [x] 5.1 Extend `FileRowProps` (and the inner `FileRowBody`)
      with `range?: { from: string; to: string }`. Include
      `range.from` AND `range.to` in the TanStack query key
      alongside the existing `sha` / `submodule` discriminators.
- [x] 5.2 Inside `FileRowBody`, when `side === 'range'`, invoke
      the new `fetchGitDiff` shape with the range opts. All
      other paths unchanged.

## 6. `<SubmoduleBumpRow />` component

- [x] 6.1 Create `apps/web/components/submodule-bump-row.tsx`
      with props from spec.
- [x] 6.2 Header layout: chevron + submodule name +
      `<fromShort> → <toShort>` + `(loading)` until the range
      query resolves, then `(N commits)`.
- [x] 6.3 On first expand: `useQuery(['git-range', project,
      submodule, fromSha, toSha], () => fetchGitRange(...))`.
      Stays mounted after collapse for cache stickiness.
- [x] 6.4 Expanded body: small commits-summary block (one line
      per commit) + flat file list. Each file row mounts as
      `<FileRow project side="range" range={{ from, to }}
      submodule={submodule} entry={f} />`.
- [x] 6.5 Error + loading states match `<FileRow />`'s look.
- [x] 6.6 Component test
      `apps/web/components/submodule-bump-row.test.tsx`:
      - header text contains both SHAs
      - default collapsed, no fetch
      - expand fires `fetchGitRange` exactly once
      - body renders commit summaries + files
      - expanding a file inside the body fires `fetchGitDiff`
        with `side="range"`, `from`, `to`, `submodule`

## 7. Wire `<SubmoduleBumpRow />` into `<GitHistoryDialog />`

- [x] 7.1 In `CommitDetailBody`, iterate `detail.files`. For
      each entry: if `entry.submoduleBump` exists AND the path
      matches a name in `['submodules', project]`, render
      `<SubmoduleBumpRow />` instead of `<FileRow />`.
- [x] 7.2 Update `git-history-dialog.test.tsx`:
      - mock `fetchSubmodules` with one submodule
      - mock `fetchGitCommit` to return a `files` entry with
        `submoduleBump` set + matching path
      - assert: `data-slot="submodule-bump-row"` appears, no
        `data-slot="file-row-trigger"` for that entry
      - regular files in the same commit still render as
        `data-slot="file-row-trigger"`

## 8. End-to-end verification

- [x] 8.1 `pnpm --filter @memon/core typecheck` clean; core
      tests green.
- [x] 8.2 `pnpm --filter @memon/web typecheck` clean; web tests
      green.
- [x] 8.3 Rebuild + restart prod.
- [x] 8.4 Pick a real project commit known to bump a submodule
      pointer. Curl
      `GET /api/projects/<p>/git-commit?sha=<that-commit>` and
      confirm the response `files` entry for the submodule path
      includes a `submoduleBump` object with both SHAs.
- [x] 8.5 Curl `GET /api/projects/<p>/git-range?from=<fromSha>&
      to=<toSha>&submodule=<name>` and confirm `enabled: true`
      with both `commits[]` and `files[]` populated.
- [x] 8.6 Curl `GET /api/projects/<p>/git-diff?path=<file-in-
      range>&side=range&from=<fromSha>&to=<toSha>&submodule=
      <name>` and confirm `ok: true` with both contents set.
- [x] 8.7 Negative-path curls: `side=range` without `from` →
      400; without `to` → 400; with invalid sha → 400;
      with unknown submodule → 400.
- [x] 8.8 `openspec validate add-submodule-bump-diff --type
      change` clean.
