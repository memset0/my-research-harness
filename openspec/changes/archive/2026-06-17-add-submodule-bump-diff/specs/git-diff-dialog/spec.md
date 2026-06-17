## MODIFIED Requirements

### Requirement: `/git-diff` accepts `side=commit&sha=<x>`

`GET /api/projects/:project/git-diff` SHALL accept the existing
`side` values `staged|unstaged|untracked|commit` PLUS a new
`range` value that compares two arbitrary refs.

| side | required extras | oldRef | newRef |
|------|----------------|--------|--------|
| staged | — | HEAD | index |
| unstaged | — | index | working |
| untracked | — | (empty) | working |
| commit | `sha=<x>` | `<sha>^` | `<sha>` |
| range | `from=<sha>&to=<sha>` | `<from>` | `<to>` |

For `side=range`:

- `from` and `to` MUST be present (400 otherwise).
- Each MUST match the safe-ref character class
  `/^[A-Za-z0-9_\-/.~^]+$/` with length ≤ 200 (400 otherwise).
- All other validation (path safety, submodule scoping) is
  unchanged.

The existing `sha` validation rules for `side=commit` carry
over: missing → 400, invalid → 400.

#### Scenario: Range diff between two arbitrary SHAs
- **GIVEN** an owner session and a project whose local clone has
  both `from=abc` and `to=def`
- **WHEN** `GET /api/projects/<p>/git-diff?path=app.ts&side=
  range&from=abc&to=def`
- **THEN** the response is `200 { ok: true, oldContent: '<bytes
  at abc:app.ts>', newContent: '<bytes at def:app.ts>',
  filename: 'app.ts', status: 'modified' }`

#### Scenario: Range diff scoped to a submodule
- **GIVEN** the project has submodule `vendor/foo`
- **WHEN** `GET /api/projects/<p>/git-diff?path=lib.ts&side=
  range&from=aaa&to=bbb&submodule=vendor%2Ffoo`
- **THEN** the route resolves cwd to
  `<projectRoot>/vendor/foo` and returns the range diff from
  there

#### Scenario: range missing `from` or `to`
- **WHEN** `GET /api/projects/<p>/git-diff?path=app.ts&side=
  range&from=abc` (no `to`)
- **THEN** the response is `400`

#### Scenario: range with malicious shas
- **WHEN** any of `from` / `to` contains shell metacharacters
- **THEN** the response is `400` and no reader runs

### Requirement: `<FileRow />` extracted for cross-dialog reuse

The collapsible file row used inside `<GitDiffDialog />` SHALL
be exported from `apps/web/components/file-row.tsx` so all
dialogs (status, history, submodule-bump) mount the same widget.

The row's API now accepts the discriminators below as optional
props. The per-file diff query is keyed by ALL of them so two
repos / commits / ranges with identical paths cache
independently:

```ts
interface FileRowProps {
  project: string
  side: GitDiffSide       // 'staged' | 'unstaged' | 'untracked' | 'commit' | 'range'
  entry: GitFileEntry
  sha?: string            // required when side === 'commit'
  submodule?: string      // any side; scopes cwd to a submodule
  range?: { from: string; to: string }  // required when side === 'range'
}
```

The query key SHALL include all five of `project`, `path`,
`side`, the relevant ref(s) (`sha` OR `range.from`+`range.to`),
and `submodule` so identical paths in different scopes don't
collide.

#### Scenario: FileRow in `side=range` mode
- **GIVEN** `<FileRow project="p" side="range" range={{ from:
  'abc', to: 'def' }} submodule="vendor/foo" entry={{ path:
  'lib.ts', status: 'modified' }} />` is mounted
- **WHEN** the user expands the row
- **THEN** the fetched URL is
  `/api/projects/p/git-diff?path=lib.ts&side=range&from=abc&to=
  def&submodule=vendor%2Ffoo`

#### Scenario: Range and commit caches don't collide
- **GIVEN** two FileRows mounted simultaneously for the same
  path in the same submodule — one with `side="commit"
  sha="def"`, the other with `side="range" range={{ from: 'abc',
  to: 'def' }}`
- **WHEN** the user expands BOTH
- **THEN** two distinct GET requests fire, one per row, and
  their results are cached under distinct TanStack query keys
