## ADDED Requirements

### Requirement: Commit detail renders bump rows for submodule pointer changes

`<GitHistoryDialog />`'s commit-detail file list SHALL route file
entries through a discriminator:

- An entry is a "submodule bump" when its `submoduleBump` field
  is present AND its `path` matches a name OR path from
  `['submodules', project]`.
- Bump entries render via `<SubmoduleBumpRow />` (see
  `git-submodule-bump-diff` capability).
- All other entries render via the existing `<FileRow />` flow.

The mark editor (`<CommitMarkEditor />`) at the top of the
detail pane is UNAFFECTED by the presence of bump rows — the
mark belongs to the main-repo commit being viewed.

#### Scenario: Commit with regular files + a submodule bump renders both row variants
- **GIVEN** a main-repo commit modified `app/page.tsx` AND
  bumped the `vendor/foo` submodule
- **WHEN** the detail pane renders
- **THEN** the body contains exactly one
  `data-slot="submodule-bump-row"` element AND at least one
  `data-slot="file-row-trigger"` element; the
  `data-slot="commit-mark-editor"` is present for the
  main-repo SHA exactly as before this change

#### Scenario: Submodule path with no `submoduleBump` is still a regular FileRow
- **GIVEN** a `submoduleBump` field is absent on an entry
  (e.g. a regular tracked file whose path happens to match a
  legacy submodule name)
- **WHEN** the detail pane renders
- **THEN** the entry renders as a regular `<FileRow />`, NOT as
  a bump row — the discriminator is `submoduleBump !==
  undefined` AND a name match, both required

## MODIFIED Requirements

### Requirement: `readGitCommit` core reader

`@memon/core`'s `readGitCommit(cwd, sha, opts?)` SHALL continue
to return the existing `GitCommitDetail` discriminated union,
with one extension: the `files` array's entries MAY carry an
optional `submoduleBump?: { fromSha: string; toSha: string }`
field for entries that represent submodule pointer changes.

Implementation change: the file list is now sourced from
`git diff-tree -r --root --raw -M <sha>` (rather than
`--name-status`). The raw output line format is:

```
:<oldMode> <newMode> <oldSha> <newSha> <status>\t<path>
```

with rename / copy entries adding a `\t<origPath>` segment. The
parser:

- Extracts `path` (and `origPath` for `R`/`C` entries) exactly
  as before.
- Maps the status code to the existing `GitFileStatus` enum.
- When BOTH `oldMode` AND `newMode` are `160000` (the gitlink
  mode), populates
  `submoduleBump = { fromSha: <oldSha>, toSha: <newSha> }`.
- For non-gitlink entries, `submoduleBump` is absent
  (`undefined`).

Returned shape (unchanged outer envelope; only `files[]` entries
gain the optional field):

```ts
export interface GitFileEntry {
  path: string
  status: GitFileStatus
  origPath?: string
  submoduleBump?: { fromSha: string; toSha: string }
}
```

#### Scenario: Commit bumping a submodule pointer
- **GIVEN** a commit whose `git diff-tree --raw` output contains
  `:160000 160000 aaa1111 bbb2222 M\tvendor/foo`
- **WHEN** `readGitCommit(cwd, sha)` runs
- **THEN** the resolved `files` array contains
  `{ path: 'vendor/foo', status: 'modified', submoduleBump:
  { fromSha: 'aaa1111', toSha: 'bbb2222' } }`

#### Scenario: Regular file modification carries no submoduleBump
- **GIVEN** a commit whose `git diff-tree --raw` output contains
  `:100644 100644 1111111 2222222 M\tapp.ts`
- **WHEN** the reader runs
- **THEN** the corresponding entry has `submoduleBump`
  undefined / absent

#### Scenario: Renamed file still parses status + origPath
- **GIVEN** a rename `R100\told\tnew` in raw form
- **WHEN** the reader runs
- **THEN** the entry has `status: 'renamed'`, `path: 'new'`,
  `origPath: 'old'`, and no `submoduleBump`
