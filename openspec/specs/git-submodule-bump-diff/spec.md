# git-submodule-bump-diff Specification

## Purpose
TBD - created by archiving change add-submodule-bump-diff. Update Purpose after archive.
## Requirements
### Requirement: `GET /api/projects/:project/git-range` endpoint

The web server SHALL expose
`GET /api/projects/:project/git-range?from=<sha>&to=<sha>` returning
the commit list AND file list for the range. Optional
`submodule=<name>` scopes the underlying reader to that submodule
(same rules as the other git endpoints).

Validation:

- `from` and `to` MUST be present (400 if missing).
- Each MUST match the safe-ref character class
  `/^[A-Za-z0-9_\-/.~^]+$/` with length ≤ 200 (400 otherwise).
- `submodule`, when present, MUST be a known name from
  `.gitmodules` (400 otherwise; same validation as other
  endpoints).

Response:

```ts
type GitRangeResponse =
  | { enabled: false; reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'; message?: string }
  | {
      enabled: true
      from: string
      to: string
      submodule: string  // '' for main repo
      commits: GitCommitSummary[]
      files: GitFileEntry[]
    }
```

Implementation:

- `commits` comes from
  `git log --format=<NUL-RS format> <from>..<to>` inside the
  resolved cwd.
- `files` comes from
  `git diff-tree -r --root --raw -M <from>..<to>` inside the
  resolved cwd, parsed via the new raw parser.

#### Scenario: Owner GET on a submodule-scoped range
- **GIVEN** an owner session and a project with submodule
  `vendor/foo` whose local clone contains both `abc1234` and
  `def5678`
- **WHEN** `GET /api/projects/<p>/git-range?from=abc1234&to=
  def5678&submodule=vendor%2Ffoo`
- **THEN** the response is `200 { enabled: true, from: '...',
  to: '...', submodule: 'vendor/foo', commits: [...], files:
  [...] }`

#### Scenario: Missing `from` or `to`
- **WHEN** `GET /api/projects/<p>/git-range?to=def5678`
- **THEN** the response is `400`

#### Scenario: Invalid sha format
- **WHEN** `GET /api/projects/<p>/git-range?from=foo%3Brm&to=
  abc1234`
- **THEN** the response is `400` AND no reader is invoked

#### Scenario: Unknown submodule name
- **WHEN** `GET /api/projects/<p>/git-range?from=abc&to=def&
  submodule=does-not-exist`
- **THEN** the response is `400`

#### Scenario: Local clone lacks one of the SHAs
- **GIVEN** the submodule's local clone does NOT contain `from`
  (user hasn't fetched yet)
- **WHEN** the range endpoint is invoked
- **THEN** the response is `200 { enabled: false, reason:
  'error', message: ... }` — passes the underlying reader's
  failure shape through

### Requirement: `GitFileEntry.submoduleBump` field populated by `readGitCommit`

`@memon/core`'s `readGitCommit` SHALL switch from
`git diff-tree -r --root --name-status -M <sha>` to
`git diff-tree -r --root --raw -M <sha>` to gain access to mode
bits. Each resulting `GitFileEntry` SHALL gain an optional
`submoduleBump?: { fromSha: string; toSha: string }` field
populated when the file's diff line shows the gitlink mode
(`160000 → 160000`).

The reader's behaviour for non-submodule entries is unchanged
in observable shape (`path`, `status`, `origPath?` all preserved
as before).

```ts
export interface GitFileEntry {
  path: string
  status: GitFileStatus
  origPath?: string
  submoduleBump?: { fromSha: string; toSha: string }
}
```

#### Scenario: Commit that bumps a submodule pointer
- **GIVEN** a main-repo commit that changed the submodule
  `vendor/foo` pin from `aaa1111…` to `bbb2222…`
- **WHEN** `readGitCommit(cwd, <mainSha>)` runs
- **THEN** the resolved value's `files` array contains an entry
  with `path: 'vendor/foo'`, `status: 'modified'`, AND
  `submoduleBump: { fromSha: 'aaa1111…', toSha: 'bbb2222…' }`

#### Scenario: Commit that only touches regular files
- **GIVEN** a commit that modified `app/page.tsx` only
- **WHEN** the reader runs
- **THEN** the `app/page.tsx` entry has NO `submoduleBump` field
  (the field is absent / undefined, not present-but-empty)

#### Scenario: Renamed regular file still produces origPath
- **GIVEN** a commit that renamed `old.ts` → `new.ts`
- **WHEN** the reader runs
- **THEN** the entry has `status: 'renamed'`, `path: 'new.ts'`,
  `origPath: 'old.ts'`, AND no `submoduleBump`

### Requirement: `<SubmoduleBumpRow />` component

`apps/web/components/submodule-bump-row.tsx` SHALL export a
client component used by `<GitHistoryDialog />`'s commit-detail
view in place of `<FileRow />` when a file entry has
`submoduleBump` set AND its path matches a submodule reported by
`['submodules', project]`.

Props:

```ts
interface SubmoduleBumpRowProps {
  project: string
  submodule: string   // .gitmodules name
  path: string        // submodule path inside the main repo
  fromSha: string
  toSha: string
}
```

Behaviour:

- Always-visible header (`data-slot="submodule-bump-row"`):
  chevron + submodule name (or path if name differs) +
  `<fromShort> → <toShort>` + `(loading)` until the range query
  resolves, then `(N commits)`.
- Default state collapsed (matching `<FileRow />`'s contract).
- Expand → fires `useQuery(['git-range', project, submodule,
  fromSha, toSha])`. While loading, a skeleton. On success,
  renders:
  - A small commits-summary block (subject + author + relative
    time for each commit in range, no per-commit expand).
  - A flat file list — one `<FileRow />` per entry from the
    range's `files`. Each `<FileRow />` mounts with
    `side="range"`, `submodule={submodule}`, AND the new
    `range={{ from: fromSha, to: toSha }}` prop so its per-file
    diff query targets the right pair of refs.
- On error, an inline `text-destructive` message reports the
  reader's reason.

The row MUST NOT mount any submodule-range queries until first
expand — matches the existing FileRow contract.

#### Scenario: Header always shows the from / to SHAs
- **GIVEN** the row is rendered for `vendor/foo` bumping
  `aaa1111` → `bbb2222`
- **WHEN** the user has NOT yet clicked to expand
- **THEN** the header text contains `aaa1111` AND `bbb2222`
  (short forms accepted), AND no `/git-range` request has
  fired

#### Scenario: Expand fires the range query exactly once
- **GIVEN** the row is rendered (collapsed)
- **WHEN** the user clicks the row to expand it
- **THEN** exactly one GET to `/api/projects/<p>/git-range?from=
  <from>&to=<to>&submodule=<sub>` is fired

#### Scenario: Expand renders the file list AND a commits summary
- **GIVEN** the range query has resolved with 3 commits and 5
  files
- **WHEN** the row's expanded body renders
- **THEN** the body shows 3 commit summary lines AND 5
  `<FileRow />` instances; each FileRow is collapsed by default

#### Scenario: File row inside the bump uses `side=range`
- **GIVEN** the body has rendered with at least one file
- **WHEN** the user clicks a file row to expand it
- **THEN** a GET to `/api/projects/<p>/git-diff?path=<path>&
  side=range&from=<from>&to=<to>&submodule=<sub>` is fired

### Requirement: Commit detail uses `<SubmoduleBumpRow />` for bump entries

`<GitHistoryDialog />`'s commit-detail file list SHALL, for each
entry whose `submoduleBump` field is set AND whose path matches
the project's `['submodules', project]` list:

- Render `<SubmoduleBumpRow />` IN PLACE OF the regular
  `<FileRow />`.
- All non-bump entries SHALL continue to render via
  `<FileRow />` unchanged.

The mark for the commit (set via `<CommitMarkEditor />`) is
unaffected by the presence of bump rows — the mark belongs to
the main-repo commit, exactly as today.

#### Scenario: Commit with one regular file + one submodule bump
- **GIVEN** a commit that modified `app/page.tsx` AND bumped
  `vendor/foo`
- **WHEN** the commit detail renders
- **THEN** the file list contains exactly one
  `data-slot="file-row-trigger"` element AND exactly one
  `data-slot="submodule-bump-row"` element

#### Scenario: Mark stays on the main-repo commit
- **GIVEN** a commit with a submodule bump and an existing
  `verified` mark
- **WHEN** the user expands the bump row and reviews
- **THEN** the `<CommitMarkEditor />` in the detail header
  continues to show the mark for the MAIN-REPO commit; no new
  marks are created for the submodule's own commits in the
  range

