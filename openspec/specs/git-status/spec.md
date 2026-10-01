# git-status Specification

## Purpose
Shows each project's working-tree state in the dashboard through a shared git pill in the sidebar and a fixed project footer, refreshed by client-side polling rather than SSE. It covers the core status, changed-file and file-content readers, the `git_status:` config block and the `/api/projects/:project/git-status` endpoints, and guarantees that no user-controlled path reaches `execFile`. Readers live in `@memon/core` (`git/`); the UI lives in `apps/web`.

## Requirements
### Requirement: Core git status reader

`packages/core/src/git/status.ts` SHALL export `readGitStatus(cwd:
string, opts?: { timeoutMs?: number }): Promise<GitStatus>`, where
`GitStatus` is the discriminated union:

```ts
export type GitStatus =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | {
      enabled: true
      branch: string | null
      detached: boolean
      sha: string
      upstream: string | null
      ahead: number
      behind: number
      staged: number
      unstaged: number
      untracked: number
      dirty: boolean
    }
```

The reader SHALL invoke `git status --porcelain=v2 --branch
--ignore-submodules=all` via `execFile` with `cwd` set to the
argument and a default timeout of 3000ms. The reader MUST NOT spawn
any other git subprocess.

The reader SHALL classify outcomes:

- `git` binary not found in PATH (ENOENT) → `{ enabled: false,
  reason: 'git-not-found' }`.
- `cwd` is not inside a git working tree (git exits non-zero with
  "not a git repository" on stderr) → `{ enabled: false, reason:
  'not-a-repo' }`.
- Timeout exceeded → `{ enabled: false, reason: 'timeout' }`.
- Any other non-zero exit, parse failure, or unexpected error →
  `{ enabled: false, reason: 'error', message: <truncated stderr or
  exception message> }`.
- Success → `{ enabled: true, ... }` with all numeric fields
  defaulting to 0 when their corresponding source lines are absent.

`dirty` SHALL be `staged + unstaged + untracked > 0`.

#### Scenario: Clean repo on a tracked branch
- **GIVEN** `cwd` is a git working tree on branch `main` whose
  upstream is `origin/main`, with no local changes and no untracked
  files
- **WHEN** `readGitStatus(cwd)` runs
- **THEN** the resolved value is `{ enabled: true, branch: 'main',
  detached: false, sha: '<short>', upstream: 'origin/main', ahead: 0,
  behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: false }`

#### Scenario: Working tree has staged + unstaged + untracked changes
- **GIVEN** `cwd` is a git working tree where 2 files are staged, 1
  file has unstaged modifications, and 1 untracked file is present
- **WHEN** `readGitStatus(cwd)` runs
- **THEN** the resolved value has `staged: 2, unstaged: 1,
  untracked: 1, dirty: true`

#### Scenario: Detached HEAD
- **GIVEN** `cwd` is a git working tree with HEAD checked out at a
  specific commit (detached)
- **WHEN** `readGitStatus(cwd)` runs
- **THEN** the resolved value has `branch: null, detached: true,
  sha: '<short>'`

#### Scenario: No upstream configured
- **GIVEN** `cwd` is on a local-only branch with no upstream
- **WHEN** `readGitStatus(cwd)` runs
- **THEN** the resolved value has `upstream: null, ahead: 0, behind: 0`

#### Scenario: cwd is not a git repository
- **GIVEN** `cwd` exists but is not inside any git working tree
- **WHEN** `readGitStatus(cwd)` runs
- **THEN** the resolved value is `{ enabled: false, reason:
  'not-a-repo' }`

#### Scenario: git binary missing
- **GIVEN** the `git` binary is not present in PATH (ENOENT from
  spawn)
- **WHEN** `readGitStatus(cwd)` runs
- **THEN** the resolved value is `{ enabled: false, reason:
  'git-not-found' }`

#### Scenario: Command times out
- **GIVEN** the git command does not complete within the configured
  timeout (default 3000ms; test override allowed)
- **WHEN** `readGitStatus(cwd, { timeoutMs: 50 })` runs against a
  hanging git stub
- **THEN** the resolved value is `{ enabled: false, reason: 'timeout' }`

#### Scenario: cwd inside a subdirectory of a repo
- **GIVEN** `cwd` is `<repo>/subdir` and `<repo>` is the actual git
  working tree root
- **WHEN** `readGitStatus(cwd)` runs
- **THEN** git auto-discovers the parent `.git` directory and the
  resolved value reflects the parent repo's branch and counts
  (per-file counts include only files reachable from the root, as
  per git's standard behavior)

### Requirement: `/api/projects/:project/git-status` endpoint

The web server SHALL expose `GET /api/projects/:project/git-status`
returning JSON. The dynamic segment matches the existing
`apps/web/app/api/projects/[project]/...` convention. The route:

1. Resolves the project segment against `runtime.config.projects`. If
   no registered project has that exact name, the route MUST return
   HTTP 404 with `{ error: { message: 'project not found' } }`.
2. Enforces viewer scope: if the requester is authenticated as a
   viewer and the project is not in their `scopeProjects`, the route
   MUST return HTTP 403.
3. Otherwise calls `readGitStatus(project.root)` and returns the
   discriminated-union value as the response body with HTTP 200.

The route SHALL maintain an in-memory throttle cache keyed by project
name: `{ readAt: number; result: GitStatus }`. If a request arrives
within `Config.gitStatus.intervalMs` of the last successful `readAt`
for the same project, the cached `result` SHALL be returned and
`readGitStatus` MUST NOT be re-invoked. The throttle window equals
`Config.gitStatus.intervalMs` exactly — see the "git_status config
block" requirement.

The route handler MUST NOT accept any path-shaped input from URL,
query, or body. All filesystem access derives from the registered
project's `root`.

#### Scenario: Owner GET on a registered, clean project
- **GIVEN** an authenticated owner and a registered project
  `project-a` whose `root` is a clean git repo
- **WHEN** the client issues `GET /api/projects/project-a/git-status`
- **THEN** the response is `200 OK` with body
  `{ enabled: true, branch: '<...>', detached: false, ... }`

#### Scenario: Unknown project
- **GIVEN** the URL references a project name that is NOT present in
  `Config.projects`
- **WHEN** the request arrives
- **THEN** the response is `404 Not Found` with
  `{ error: { message: 'project not found' } }`

#### Scenario: Viewer out of scope
- **GIVEN** a viewer session with `scopeProjects = ['proj-a']` and
  the URL targets `proj-b`
- **WHEN** the request arrives
- **THEN** the response is `403 Forbidden`

#### Scenario: Two requests within the throttle window use cache
- **GIVEN** `Config.gitStatus.intervalMs === 10000` and a request at
  `t=0` returned `200 { enabled: true, ... }` for `project-a`
- **WHEN** a second request for the same project arrives at `t=400ms`
- **THEN** the route returns the cached body without re-invoking
  `readGitStatus`

#### Scenario: Throttle window expires after intervalMs
- **GIVEN** `Config.gitStatus.intervalMs === 10000` and a request at
  `t=0` cached the result for `project-a`
- **WHEN** a second request arrives at `t=10500ms`
- **THEN** the route re-invokes `readGitStatus` and updates the cache

### Requirement: Live update via client-side polling, no SSE

The git-status capability SHALL NOT introduce a new SSE topic. The
sidebar pill and the project-footer pill SHALL poll
`/api/projects/:project/git-status` via TanStack Query with
`refetchInterval: intervalMs` and `staleTime: intervalMs / 2`, where
`intervalMs` is the value resolved from the `git_status:` config
block (see "git_status config block" requirement below).

Both pill instances for the same project name SHALL share the query
key `['git-status', name]` so that simultaneous mounting (sidebar +
footer) results in exactly one in-flight request at a time per
project.

#### Scenario: Sidebar + footer mounted simultaneously
- **GIVEN** the user is on `/p/project-a/e/E0001-foo`, so both the
  sidebar pill for `project-a` and the project footer pill for
  `project-a` are mounted
- **WHEN** a poll tick fires
- **THEN** exactly one GET request to `/api/projects/project-a/
  git-status` is in flight and both pills render from the same query
  data

### Requirement: `git_status:` config block

`config.yml` SHALL accept an optional top-level `git_status:` block
with one field:

```yaml
git_status:
  interval_ms: <integer>     # default 10000; minimum 1000
```

The config loader (`packages/core/src/config/load.ts` +
`schemas.ts`) SHALL parse this block and apply the following
defaults / validation:

- When the `git_status:` block is absent: `interval_ms` defaults to
  `10000`.
- `interval_ms` MUST be an integer.
- `interval_ms` MUST be `>= 1000`. Values below the floor MUST be
  rejected with a `ConfigError` ("git_status.interval_ms (<value>)
  must be >= 1000").
- The resolved `Config` SHALL carry a `gitStatus: GitStatusConfig`
  field with shape `{ intervalMs: number }` after camelCase
  conversion.

The same `intervalMs` value MUST drive BOTH the client's TanStack
`refetchInterval` AND the server's throttle window. Implementations
MUST NOT introduce separate knobs for the two sides.

#### Scenario: Block absent defaults to 10000
- **GIVEN** `config.yml` has no `git_status:` block
- **WHEN** `loadConfig(...)` runs
- **THEN** the returned `Config.gitStatus.intervalMs === 10000`

#### Scenario: Custom value flows through
- **GIVEN** `config.yml` contains `git_status: { interval_ms: 30000 }`
- **WHEN** `loadConfig(...)` runs
- **THEN** the returned `Config.gitStatus.intervalMs === 30000`

#### Scenario: Below-floor rejected
- **GIVEN** `config.yml` contains `git_status: { interval_ms: 500 }`
- **WHEN** `loadConfig(...)` runs
- **THEN** it throws `ConfigError` with a message mentioning
  `git_status.interval_ms`

#### Scenario: Non-integer rejected
- **GIVEN** `config.yml` contains `git_status: { interval_ms: 1500.5 }`
- **WHEN** `loadConfig(...)` runs
- **THEN** it throws `ConfigError`

### Requirement: Client receives `intervalMs` via SSR-injected runtime config

The root layout (`apps/web/app/layout.tsx`) SHALL render a
`<script id="memon-runtime-config" type="application/json">` element
containing at least `{ gitStatus: { intervalMs: <resolved value> } }`.
Client components SHALL read this value through a shared
`apps/web/lib/runtime-config.ts` reader. When the script element is
absent (e.g. unit tests without SSR), the reader SHALL fall back to
`intervalMs: 10000` so components still mount.

The `<GitStatusPill />` component SHALL use the reader's `intervalMs`
for both `refetchInterval` and (as `intervalMs / 2`) `staleTime`.

#### Scenario: SSR injects current config
- **GIVEN** `config.yml` contains `git_status: { interval_ms: 15000 }`
  and a user requests `/p/project-a`
- **WHEN** the page renders
- **THEN** the served HTML contains
  `<script id="memon-runtime-config" type="application/json">` with
  a body that, when parsed, includes `gitStatus.intervalMs === 15000`

#### Scenario: Reader fallback when script tag absent
- **GIVEN** a component is mounted in a unit test without SSR-
  injected config
- **WHEN** the reader is invoked
- **THEN** it returns `{ gitStatus: { intervalMs: 10000 } }` rather
  than throwing

### Requirement: Shared `<GitStatusPill />` component, two variants

`apps/web/components/git-status-pill.tsx` SHALL export
`<GitStatusPill project: string; variant: 'compact' | 'footer' />`.

The component SHALL:

- Use `useQuery(['git-status', project], ...)` with the polling
  cadence above.
- Render nothing (return `null`) when the query is loading on first
  mount, when the response has `enabled: false`, or when the request
  failed with a 4xx/5xx status.
- On `enabled: true`:
  - `variant === 'compact'`: render a small inline group containing
    a `GitBranch` icon, the branch name truncated at 12 characters
    (or `(<short-sha>)` rendered muted when detached), and a colored
    dot when `dirty === true`. The full upstream + ahead/behind +
    counts SHALL be exposed via a hover tooltip.
  - `variant === 'footer'`: render a monospace inline group with
    icon + branch (or `(<short-sha>)`), `↑<ahead>` and `↓<behind>`
    arrows when nonzero, and `●<staged> ○<unstaged> ?<untracked>`
    when those counts are nonzero. Hover tooltip surfaces the full
    upstream ref.
- Use shadcn `Tooltip` for the tooltip.
- Use semantic Tailwind tokens (`text-muted-foreground`, `bg-card`,
  `border-border`) — implementers MUST verify each token's CSS
  variable is defined in `apps/web/app/globals.css` before shipping
  (CLAUDE.md F4).

#### Scenario: Compact variant on a dirty branch
- **GIVEN** the query for `project-a` resolved to `{ enabled: true,
  branch: 'feature/x', detached: false, ahead: 0, behind: 0, staged:
  1, unstaged: 0, untracked: 2, dirty: true }`
- **WHEN** `<GitStatusPill project="project-a" variant="compact" />`
  renders
- **THEN** the rendered markup contains a git-branch icon, the text
  `feature/x` (or a truncated form), and a dirty indicator dot

#### Scenario: Footer variant with ahead + behind
- **GIVEN** the query resolved to `{ enabled: true, branch: 'main',
  ahead: 2, behind: 1, ... }`
- **WHEN** `<GitStatusPill project="project-a" variant="footer" />`
  renders
- **THEN** the rendered markup contains `↑2` and `↓1`

#### Scenario: enabled=false renders nothing
- **GIVEN** the query for `project-a` resolved to `{ enabled: false,
  reason: 'not-a-repo' }`
- **WHEN** the pill renders
- **THEN** the component returns `null` (empty DOM output)

### Requirement: Sidebar shows compact git pill per project

`apps/web/components/app-sidebar.tsx` SHALL render
`<GitStatusPill variant="compact" project={p.name} />` for each
project row in the sidebar. The pill SHALL be visually
secondary to the project name (smaller, muted) and SHALL NOT push
the project name out of view on the default sidebar width.

When the pill returns `null` (non-git project, query loading,
unauthenticated viewer for that project), the project row SHALL
render exactly as it did prior to this change.

#### Scenario: Sidebar with a git-repo project
- **GIVEN** the user has a registered project `project-a` whose root
  is a git repo on branch `main` with no dirty files
- **WHEN** the sidebar renders
- **THEN** the project-a row contains a compact git pill with branch
  text `main` and no dirty dot

#### Scenario: Sidebar with a non-git project
- **GIVEN** the user has a registered project `project-z` whose root
  is NOT a git repo
- **WHEN** the sidebar renders
- **THEN** the project-z row contains no git pill markup and the row
  layout matches the pre-change sidebar exactly

### Requirement: `<ProjectFooter />` fixed bottom bar on project pages

`apps/web/components/project-footer.tsx` SHALL export a client
component `<ProjectFooter project: string />` that renders a fixed
bottom bar on the viewport.

The bar SHALL:

- Use `position: fixed; bottom: 0; left: 0; right: 0` (full-width on
  mobile; on desktop, the sidebar overlays its left portion via the
  existing sidebar's higher z-index — implementers MAY indent the
  footer to start at the sidebar's right edge if the overlay looks
  wrong, but the visual fix is acceptable as a follow-up).
- Have a height between 24px and 32px, a top border (`border-t`), and
  background using the `bg-card` semantic token (verify that
  `--card` is defined in `globals.css` first per CLAUDE.md F4).
- Render: project name on the left (clickable link to
  `/p/<project>`), `<GitStatusPill variant="footer" project={...} />`
  in the next slot, and a reserved flex spacer on the right where
  future widgets can mount.
- Be visible on `z-index` higher than ordinary page content but
  lower than `sonner` toasts (which use z-index 100 by default).

`apps/web/app/p/[project]/layout.tsx` SHALL:

- Resolve `params.project` and pass it to `<ProjectFooter />`.
- Wrap `children` so that the last content row receives bottom
  padding equal to the footer height (e.g. `pb-8` if footer is
  ~28px) to prevent footer overlap.
- Mount `<ProjectFooter />` once per project subtree, outside the
  scrollable content region.

#### Scenario: Footer rendered on project root
- **GIVEN** the user navigates to `/p/project-a`
- **WHEN** the page renders
- **THEN** the served HTML contains the project-footer markup, the
  project name `project-a` (linked to `/p/project-a`), and a
  git-status pill placeholder

#### Scenario: Footer rendered on experiment detail
- **GIVEN** the user navigates to `/p/project-a/e/E0001-foo`
- **WHEN** the page renders
- **THEN** the served HTML contains the same project-footer markup
  as the project root, with `project-a` as the project name in the
  footer

#### Scenario: Content not occluded by footer
- **GIVEN** the project root page renders an experiment grid that
  extends past the viewport bottom
- **WHEN** the user scrolls to the bottom of the content area
- **THEN** the last content row is fully visible (the layout's
  bottom padding equals or exceeds the footer height)

### Requirement: Path safety — no user-controlled paths reach `execFile`

The git-status route MUST resolve filesystem paths via the registered
`Config.projects[].root` only. The route handler MUST NOT accept a
path-shaped parameter from the URL, query string, body, or headers.

The reader (`readGitStatus`) accepts a `cwd` argument, but every
production caller MUST pass `project.root` derived from a name
lookup. Direct user-controlled invocation paths are forbidden.

#### Scenario: Attempt to abuse a path parameter
- **GIVEN** the route is `GET /api/projects/:name/git-status`
- **WHEN** a client requests `GET /api/projects/..%2Fother/git-status`
- **THEN** name resolution fails (no registered project has that
  literal name) and the route returns `404 Not Found` without
  invoking `readGitStatus`

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

