## ADDED Requirements

### Requirement: Commit list rows render a `<CommitMarkBadge />`

`<GitHistoryDialog />`'s commit-list rows SHALL render a leading
`<CommitMarkBadge />` for each commit. The badge's `mark` prop
SHALL come from the `['commit-marks', project]` TanStack query
loaded lazily once when the dialog opens.

Row layout: `[badge] [shortSha] [subject]` for the top line —
the badge sits to the LEFT of the SHA so the colored dot is the
first thing the eye lands on. The badge reserves its slot width
even for unmarked rows so rows stay vertically aligned.

#### Scenario: Marked commit shows a colored dot in the list row
- **GIVEN** the commit `abc1234…` has been marked `verified` via
  the editor
- **WHEN** the dialog opens
- **THEN** the row for `abc1234…` contains a
  `data-slot="commit-mark-badge"` element with `data-status=
  "verified"` AND an inner span with class `bg-emerald-500`

#### Scenario: Unmarked rows reserve the badge slot
- **GIVEN** zero commits are marked
- **WHEN** the dialog renders
- **THEN** every commit row contains a `data-slot="commit-mark-
  badge"` element with `data-status="none"`, so the badge slot
  is uniformly reserved

### Requirement: Selected-commit detail header renders `<CommitMarkEditor />`

`<GitHistoryDialog />`'s right pane SHALL render a
`<CommitMarkEditor />` inline with the metadata block whenever a
commit is selected. The editor receives `project`, `sha`, and the
current `mark` (or `undefined`) and MUST share the
`['commit-marks', project]` TanStack cache with the commit-list
badges so saving propagates to the list without a manual refresh.

The editor SHALL:

- Receive `mark` from the same `['commit-marks', project]`
  query.
- Wire its `onMutated` callback to invalidate the
  `['commit-marks', project]` query so the commit-list badges
  update immediately.

#### Scenario: Editor is mounted on selection
- **GIVEN** the dialog is open and the user clicks the row for
  `abc1234…`
- **WHEN** the detail pane re-renders
- **THEN** the detail header contains a `data-slot="commit-mark-
  editor"` element targeting `sha = abc1234…`

#### Scenario: Saving a mark updates the commit-list badge
- **GIVEN** the user has selected `abc1234…` (currently
  unmarked)
- **WHEN** the user picks `verified` in the editor and clicks
  Save
- **THEN** after the mutation resolves, the row for `abc1234…`
  in the commit list renders the badge with `data-status=
  "verified"` (no manual refresh needed)
