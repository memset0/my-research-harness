## ADDED Requirements

### Requirement: `readGitStatusFiles` core reader

`@memon/core` SHALL export `readGitStatusFiles(cwd: string, opts?:
{ timeoutMs?: number }): Promise<GitStatusFiles>` from
`packages/core/src/git/files.ts`, where `GitStatusFiles` extends
the existing `GitStatus` discriminated-union with three file-list
fields:

```ts
type GitStatusFiles =
  | { enabled: false; reason: ... }   // identical to GitStatus's disabled variant
  | {
      enabled: true
      branch: string | null
      detached: boolean
      sha: string
      upstream: string | null
      ahead: number
      behind: number
      staged: GitFileEntry[]
      unstaged: GitFileEntry[]
      untracked: GitFileEntry[]
    }

interface GitFileEntry {
  path: string                       // repo-relative
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'
        | 'untracked' | 'conflict' | 'typechange'
  origPath?: string                  // set when status === 'renamed' | 'copied'
}
```

Implementation: the reader SHALL invoke the same
`git status --porcelain=v2 --branch --ignore-submodules=all`
command as the existing `readGitStatus`, and reduce the body lines
into the three buckets:

- `1 XY ...` / `2 XY ...` lines: bucket by `XY`. `X` ∈ `{A, M, D, T,
  R, C}` (non-`.`) → staged. `Y` ∈ same set (non-`.`) → unstaged.
  A single file with both non-`.` columns goes in BOTH buckets.
- `u ...` lines (unmerged): status `'conflict'`, goes in the
  `unstaged` bucket (matches git's classification of conflicts as
  worktree-side problems).
- `? ...` lines: status `'untracked'`, goes in the `untracked`
  bucket only.

#### Scenario: Staged, unstaged, and untracked produce non-overlapping buckets
- **GIVEN** a working tree with 2 staged-only files, 1 unstaged-
  only file, and 1 untracked file
- **WHEN** `readGitStatusFiles(cwd)` runs
- **THEN** the resolved value has `staged.length === 2,
  unstaged.length === 1, untracked.length === 1`

#### Scenario: Mixed staged + unstaged file appears in both lists
- **GIVEN** a file that has been staged AND then further modified in
  the working tree (`XY = MM` in porcelain v2)
- **WHEN** `readGitStatusFiles(cwd)` runs
- **THEN** the file appears once in `staged` AND once in `unstaged`,
  with the same `path` value

#### Scenario: Renamed entry surfaces origPath
- **GIVEN** a renamed file `old/path.txt -> new/path.txt`
  (porcelain v2 `2 R..`)
- **WHEN** `readGitStatusFiles(cwd)` runs
- **THEN** the entry under `staged` has `status: 'renamed'`,
  `path: 'new/path.txt'`, `origPath: 'old/path.txt'`

#### Scenario: Unmerged file lands in unstaged with status 'conflict'
- **GIVEN** a file in `u UU` state from a merge
- **WHEN** `readGitStatusFiles(cwd)` runs
- **THEN** the entry appears under `unstaged` with `status:
  'conflict'`

### Requirement: `readGitFileContents` core reader

`@memon/core` SHALL export `readGitFileContents(cwd: string,
ref: 'HEAD' | 'index' | 'working', path: string, opts?:
{ maxBytes?: number; gitBin?: string; timeoutMs?: number }):
Promise<ReadGitFileContentsResult>`.

```ts
type ReadGitFileContentsResult =
  | { ok: true; content: string }     // valid UTF-8, ≤ maxBytes
  | { ok: false; reason: 'too-large'; sizeBytes: number; maxBytes: number }
  | { ok: false; reason: 'binary' }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'error'; message: string }
```

`maxBytes` defaults to `MAX_DIFF_BYTES = 1024 * 1024`.

- `ref === 'HEAD'`: read via `git show HEAD:<path>` (with the
  output captured as raw bytes; do NOT pass `--text`, which would
  hide the binary case).
- `ref === 'index'`: read via `git show :<path>`.
- `ref === 'working'`: read via `fs.readFile(<absolute path>)`
  AFTER resolving against `cwd` and confirming the resolved path
  stays under `cwd` (path-safety).

For `ref === 'HEAD'` / `'index'`, an exit code indicating "no
such path" (git's `fatal: path '<...>' exists on disk, but not in
'HEAD'` etc.) MUST be classified as `reason: 'not-found'`, not
`'error'`.

#### Scenario: Successful UTF-8 read under cap
- **GIVEN** a 4 KB UTF-8 text file in the working tree
- **WHEN** `readGitFileContents(cwd, 'working', 'app.ts')` runs
- **THEN** the result is `{ ok: true, content: '...' }` matching
  the file bytes decoded as UTF-8

#### Scenario: Over-cap file
- **GIVEN** a 1.5 MB working-tree file
- **WHEN** `readGitFileContents(cwd, 'working', 'big.txt')` runs
- **THEN** the result is `{ ok: false, reason: 'too-large',
  sizeBytes: 1572864, maxBytes: 1048576 }`

#### Scenario: Binary detection via null byte
- **GIVEN** a working-tree file containing a `0x00` byte in its
  first 8 KB
- **WHEN** `readGitFileContents(cwd, 'working', 'data.bin')` runs
- **THEN** the result is `{ ok: false, reason: 'binary' }`

#### Scenario: Invalid UTF-8 with no null byte
- **GIVEN** a file under 8 KB whose bytes form a valid Latin-1 but
  invalid UTF-8 sequence
- **WHEN** the reader runs
- **THEN** the result is `{ ok: false, reason: 'binary' }`

#### Scenario: HEAD blob does not exist
- **GIVEN** an untracked file `notes.md` that has no `HEAD` blob
- **WHEN** `readGitFileContents(cwd, 'HEAD', 'notes.md')` runs
- **THEN** the result is `{ ok: false, reason: 'not-found' }`

### Requirement: `GET /api/projects/:project/git-status/files` endpoint

The web server SHALL expose `GET /api/projects/:project/git-
status/files` returning JSON whose body is the `GitStatusFiles`
discriminated-union value produced by
`readGitStatusFiles(project.root)`.

The route:

1. Resolves `params.project` against `runtime.config.projects`.
   404 on miss (same as the existing `/git-status` route).
2. Enforces viewer scope. 403 if viewer + out-of-scope (same
   pattern).
3. Calls `readGitStatusFiles(project.root)` and serialises the
   result as JSON with HTTP 200.

The route SHALL NOT introduce a server-side cache for v1. TanStack
Query's `staleTime` on the client is sufficient — the dialog opens
infrequently and there's no observable load issue.

The route SHALL NOT introduce a new SSE topic.

#### Scenario: Owner GET returns categorized files
- **GIVEN** an owner session and a registered project whose root has
  1 staged, 1 unstaged, and 1 untracked change
- **WHEN** `GET /api/projects/<p>/git-status/files`
- **THEN** the response is `200 { enabled: true, ... staged: [...
  1 entry ...], unstaged: [... 1 entry ...], untracked: [...
  1 entry ...] }`

#### Scenario: Viewer out of scope is 403
- **GIVEN** a viewer session with scope `['project-a']` and a
  request for `project-b`
- **WHEN** the request arrives
- **THEN** the response is `403`

#### Scenario: Unknown project is 404
- **WHEN** `GET /api/projects/does-not-exist/git-status/files`
- **THEN** the response is `404` with body
  `{ error: { message: 'project not found' } }`
