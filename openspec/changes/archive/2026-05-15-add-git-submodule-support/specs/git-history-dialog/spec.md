## ADDED Requirements

### Requirement: History dialog has a submodule selector beside the branch selector

`<GitHistoryDialog />`'s toolbar SHALL render a submodule
`<Select>` (`data-slot="git-history-submodule-select"`) to the
LEFT of the existing branch select. The submodule select:

- Lists a synthetic "main" entry first (value sentinel — empty
  string), then one entry per submodule reported by
  `GET /api/projects/:project/submodules`.
- Default selection is "main".
- On change: clears `selectedRef` and `selectedSha` so the next
  render uses the new submodule's current HEAD; this also causes
  `['git-branches', project, submodule]` and `['git-log', project,
  submodule, ref]` to refetch.

The branch select continues to work, but is now keyed by
`(project, submodule)`. When the submodule has no branches (e.g.
detached-HEAD-only) the branch select still works via the
existing synthetic `(detached @ <sha>)` entry.

Refresh button invalidates `['git-branches', project, submodule]`
AND `['git-log', project, submodule, ref]` for the CURRENT
submodule scope — switching submodule is its own refetch path.

#### Scenario: Default selection is "main"
- **WHEN** the history dialog opens
- **THEN** the `data-slot="git-history-submodule-select"` element
  shows "main" as the current value

#### Scenario: Switching submodule refetches branches + log
- **GIVEN** the dialog is open showing main-repo commits
- **WHEN** the user picks submodule `vendor/foo` in the submodule
  select
- **THEN** fresh GETs to
  `/api/projects/project-a/git-branches?submodule=vendor%2Ffoo`
  AND
  `/api/projects/project-a/git-log?ref=<current>&submodule=vendor%2Ffoo`
  are fired

#### Scenario: Refresh is submodule-scoped
- **GIVEN** the dialog has the `vendor/foo` submodule selected
  and a commit list rendered
- **WHEN** the user clicks Refresh
- **THEN** only the queries for `(project, 'vendor/foo')` are
  invalidated; the main-repo queries (if cached from a previous
  selection) are NOT invalidated

#### Scenario: Selecting a commit + expanding a file inside a submodule
- **GIVEN** the user has selected the `vendor/foo` submodule,
  clicked a commit, and expanded a file row
- **WHEN** the diff fetch fires
- **THEN** the request URL is
  `/api/projects/project-a/git-diff?path=<...>&side=commit&sha=<sha>&submodule=vendor%2Ffoo`
