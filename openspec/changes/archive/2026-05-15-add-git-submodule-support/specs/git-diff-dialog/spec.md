## ADDED Requirements

### Requirement: Status dialog renders per-submodule blocks

`<GitDiffDialog />` SHALL fetch
`GET /api/projects/:project/submodules` lazily on open and, for
each submodule reported, render an additional repo block beneath
the main repo's three sections. Each block contains:

- A header naming the submodule (the `name` field from
  `.gitmodules`).
- Three sections (Staged / Unstaged / Untracked) following the
  same layout contract as the main repo's sections, fetched via
  `GET /api/projects/:project/git-status/files?submodule=<name>`.
- File rows that mount `<FileRow project side sha? submodule
  entry />` so the per-file diff fetch carries the submodule
  scope.

The main repo block remains rendered FIRST. Submodule blocks
render in `.gitmodules` declaration order beneath it. When a
submodule's underlying query resolves `enabled: false` (e.g.
not initialised), the block renders the header + an inline
placeholder ("not initialised" / "not a git repository") instead
of three sections.

#### Scenario: Dialog renders main + each submodule
- **GIVEN** project-a has submodules `vendor/foo` and
  `themes/dark`, and the user opens the status dialog
- **WHEN** the dialog body renders
- **THEN** the DOM contains a main-repo region followed by two
  submodule regions (one per submodule), in `.gitmodules` order

#### Scenario: Expanding a file row inside a submodule fetches the right diff
- **GIVEN** the dialog has rendered with the submodule
  `vendor/foo` showing one unstaged file `lib.ts`
- **WHEN** the user clicks the row to expand it
- **THEN** a GET to
  `/api/projects/project-a/git-diff?path=lib.ts&side=unstaged&submodule=vendor%2Ffoo`
  is fired and the diff renders inside the submodule's block

#### Scenario: Submodule not yet initialised
- **GIVEN** project-a has submodule `vendor/foo` declared but
  not checked out
- **WHEN** the dialog renders
- **THEN** the `vendor/foo` block shows a "not initialised"
  placeholder and no file-row markup

### Requirement: `<FileRow />` carries an optional `submodule` prop

`<FileRow />` SHALL accept an OPTIONAL `submodule?: string` prop.
When present:

- The per-file diff query key is `['git-diff', project, path,
  side, sha, submodule]` (sha may be `undefined`, submodule may
  be `undefined`).
- The fetcher invocation is
  `fetchGitDiff(project, path, side, sha, submodule)`.

When omitted, behaviour is unchanged (main repo).

#### Scenario: Two repos with identical file paths cache independently
- **GIVEN** the main repo and submodule `vendor/foo` both have an
  unstaged file at `lib/util.ts`
- **WHEN** the user expands BOTH rows in the dialog
- **THEN** the two diff queries have distinct cache keys —
  `[..., undefined]` for main and `[..., 'vendor/foo']` for the
  submodule — so the two diffs render independently
