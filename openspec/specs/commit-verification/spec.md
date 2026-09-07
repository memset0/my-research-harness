# commit-verification Specification

## Purpose
Per-commit verification marks (`.memon/commit-marks.csv`, `verified|suspicious|issue`) surfaced in the git history dialog.

**Deprecated** since change `wiki-system`: wiki trust is now recorded by *wiki review* (`.memon/wiki-review.csv`, commit-ordered, see `wiki-store`). Commit marks keep working unchanged but their UI entry points are labelled "(deprecated)" and nothing consults them for wiki trust; removal is a later change.
## Requirements
### Requirement: CSV file format under `.memon/commit-marks.csv`

`@memon/core` SHALL persist commit verification marks in a CSV file
at `<projectRoot>/.memon/commit-marks.csv`. The format SHALL be:

```csv
sha,status,note,updated_at,submodule
<full 40-char SHA>,<verified|suspicious|issue>,<note>,<ISO 8601 w/ offset>,<submodule-name-or-empty>
```

Requirements on the format:

- Header row MUST be present. The reader SHALL accept BOTH the
  legacy 4-column header (`sha,status,note,updated_at`) AND the
  new 5-column header (`sha,status,note,updated_at,submodule`).
  Rows under the legacy header are interpreted as `submodule =
  ''` (main repo).
- The writer SHALL always emit the 5-column header (the next write
  after deployment lazily upgrades the file).
- Rows MUST be sorted by `(submodule, sha)` ascending so edits
  cluster predictably. Empty-submodule rows (main repo) sort
  FIRST.
- `submodule` is the submodule NAME from `.gitmodules` (value
  inside `[submodule "<name>"]`). Main-repo rows write the column
  as an empty string between commas (no quoting needed).
- `sha`, `status`, `note`, `updated_at` retain their existing
  semantics (full SHA, three-state enum, RFC 4180 quoted note,
  ISO 8601 w/ offset).

#### Scenario: Round-trip a 5-column row
- **GIVEN** a CSV with header `sha,status,note,updated_at,submodule`
  and one row
  `abc1234…,verified,,2026-05-15T12:00:00+08:00,vendor/foo`
- **WHEN** the file is read and re-serialised
- **THEN** the output is byte-identical to the input AND the
  parsed entry has `submodule: 'vendor/foo'`

#### Scenario: Legacy 4-column header reads as main-repo entries
- **GIVEN** a CSV with the legacy 4-column header and one row
  `abc1234…,verified,,2026-05-15T12:00:00+08:00`
- **WHEN** the reader runs
- **THEN** the parsed entry has `submodule: ''` (empty string) AND
  the `parseWarnings` array reports the legacy format was
  detected (so callers can surface a hint if desired)

#### Scenario: Writer always emits 5 columns
- **GIVEN** the on-disk CSV has the legacy 4-column header
- **WHEN** any `setCommitMark` or `deleteCommitMark` call runs
- **THEN** the resulting file's header is the 5-column form AND
  pre-existing main-repo rows now have an empty `submodule` cell

#### Scenario: Rows sorted by (submodule, sha)
- **GIVEN** marks at SHAs `aaa…` (main), `mmm…` (main), `bbb…`
  (submodule `vendor/foo`), `ccc…` (submodule `vendor/foo`),
  `aaa…` (submodule `themes/dark`)
- **WHEN** the file is serialised
- **THEN** the row order is:
  1. `aaa…,…,,…,` (main, empty submodule sorts first)
  2. `mmm…,…,,…,`
  3. `aaa…,…,,…,themes/dark`
  4. `bbb…,…,,…,vendor/foo`
  5. `ccc…,…,,…,vendor/foo`

### Requirement: `readCommitMarks` core reader

`@memon/core` SHALL export
`readCommitMarks(projectRoot: string, opts?: { csvPathOverride?:
string }): Promise<ReadCommitMarksResult>` from
`packages/core/src/git/commit-marks.ts`, where:

```ts
export type CommitMarkStatus = 'verified' | 'suspicious' | 'issue'

export interface CommitMark {
  sha: string
  status: CommitMarkStatus
  note: string                  // '' when absent
  updatedAt: string             // ISO 8601 w/ offset
}

export interface ReadCommitMarksResult {
  marks: Record<string, CommitMark>   // keyed by sha
  parseWarnings: string[]
}
```

Implementation behaviour:

- File absent → `{ marks: {}, parseWarnings: [] }` (an unmarked
  project has no on-disk state).
- File present + valid → parsed entries, sorted-by-sha order
  preserved on read.
- File present + partially-malformed → valid rows in the map,
  malformed row indices in `parseWarnings`.
- File present + missing header → `parseWarnings: ['missing
  header']` and `marks: {}`.

#### Scenario: Missing file
- **GIVEN** `projectRoot/.memon/commit-marks.csv` does not exist
- **WHEN** `readCommitMarks(projectRoot)` runs
- **THEN** the result is `{ marks: {}, parseWarnings: [] }`

#### Scenario: Present file with two marks
- **GIVEN** the file holds two valid rows for distinct SHAs
- **WHEN** the reader runs
- **THEN** `Object.keys(result.marks).length === 2`, each entry's
  `status` matches the CSV, and `parseWarnings` is empty

### Requirement: `setCommitMark` core writer

`@memon/core` SHALL export
`setCommitMark(projectRoot: string, sha: string, input: { status:
CommitMarkStatus; note?: string }): Promise<CommitMark>`.

Behaviour:

- Validates `status` is one of the three legal values; rejects
  with a thrown `Error` otherwise.
- Validates `sha` is non-empty and matches the safe-ref regex;
  rejects with a thrown `Error` otherwise.
- Reads existing CSV (empty when absent), upserts the row,
  re-sorts by sha ascending, writes atomically to a temp file +
  rename.
- Creates `<projectRoot>/.memon/` directory if missing.
- Sets `updated_at` to the current time in ISO 8601 with the
  resolved timezone offset.
- Returns the resolved `CommitMark` (including the new
  `updated_at`).

#### Scenario: Inserts a new row
- **GIVEN** an absent CSV file
- **WHEN** `setCommitMark(projectRoot, 'abc1234…', { status:
  'verified' })` runs
- **THEN** the file `.memon/commit-marks.csv` exists, contains
  the header + the new row, and `readCommitMarks` returns one
  entry

#### Scenario: Updates an existing row
- **GIVEN** a CSV with one row for `abc1234…` and status
  `suspicious`
- **WHEN** `setCommitMark(projectRoot, 'abc1234…', { status:
  'verified', note: 'fixed' })` runs
- **THEN** the existing row's `status` becomes `verified`, its
  `note` becomes `fixed`, and its `updated_at` is refreshed; no
  duplicate row is created

#### Scenario: Atomic write doesn't leak partial files
- **GIVEN** an existing CSV
- **WHEN** the writer crashes (simulated via a thrown rename
  error)
- **THEN** the original CSV file is unchanged AND no `.tmp.*`
  file is observably present after the throw propagates

#### Scenario: Invalid status rejected
- **WHEN** `setCommitMark(projectRoot, 'abc…', { status: 'green'
  as never })` runs
- **THEN** the call rejects with an `Error` whose message
  identifies the invalid status

### Requirement: `deleteCommitMark` core writer

`@memon/core` SHALL export
`deleteCommitMark(projectRoot: string, sha: string): Promise<{
deleted: boolean }>`.

Behaviour:

- Reads existing CSV; if absent OR `sha` not present in the file,
  returns `{ deleted: false }` without writing.
- Otherwise drops the row and writes the result atomically.
- Never deletes the CSV file itself, even when the row count
  drops to zero (the empty file with only the header remains).

#### Scenario: Removes an existing mark
- **GIVEN** a CSV containing rows for `abc…` and `def…`
- **WHEN** `deleteCommitMark(projectRoot, 'abc…')` runs
- **THEN** the result is `{ deleted: true }` and the file now
  contains only the header + the row for `def…`

#### Scenario: No-op on a missing mark
- **GIVEN** a CSV containing rows for `abc…` and `def…`
- **WHEN** `deleteCommitMark(projectRoot, 'ggg…')` runs
- **THEN** the result is `{ deleted: false }` and the file is
  byte-identical

### Requirement: `GET /api/projects/:project/commit-marks` endpoint

The web server SHALL expose
`GET /api/projects/:project/commit-marks` returning JSON.

Behaviour:

- Project resolution + viewer-scope rules identical to other git
  endpoints. Unknown project → 404; viewer-out-of-scope → 403.
- READ is allowed for both owner and viewer-in-scope sessions.
- Response shape: `{ marks: Record<sha, CommitMark>,
  parseWarnings: string[] }`.

#### Scenario: Owner GET returns the parsed map
- **WHEN** an owner requests
  `GET /api/projects/<p>/commit-marks`
- **THEN** the response is `200 { marks: {...}, parseWarnings:
  [...] }`

#### Scenario: Viewer in scope can read
- **GIVEN** a viewer session with the project in scope
- **WHEN** the viewer requests
  `GET /api/projects/<p>/commit-marks`
- **THEN** the response is `200`

### Requirement: `PUT /api/projects/:project/commit-marks/:sha` endpoint

The web server SHALL expose
`PUT /api/projects/:project/commit-marks/:sha` accepting a JSON
body `{ status: CommitMarkStatus; note?: string }`.

Behaviour:

- Project resolution + viewer-scope rules as elsewhere.
- Viewer sessions → 403 (mutations are owner-only).
- `sha` MUST match the safe-ref character class; invalid →
  400.
- Body MUST be valid JSON with a `status` field that is one of
  the three legal values; invalid → 400.
- On success, calls `setCommitMark` and returns
  `200 { mark: CommitMark }`.

#### Scenario: Owner upsert
- **WHEN** an owner PUTs `{ status: 'verified', note: 'looked
  good' }` to `/api/projects/<p>/commit-marks/abc1234…`
- **THEN** the response is `200 { mark: { sha: 'abc1234…',
  status: 'verified', note: 'looked good', updatedAt: '...' } }`

#### Scenario: Viewer is rejected
- **GIVEN** a viewer session
- **WHEN** PUT is invoked
- **THEN** the response is `403` and the CSV file is unchanged

#### Scenario: Invalid status payload
- **WHEN** PUT body is `{ status: 'green' }`
- **THEN** the response is `400`

#### Scenario: Malicious sha
- **WHEN** PUT URL is `/api/projects/<p>/commit-marks/foo$(rm)`
- **THEN** the response is `400`

### Requirement: `DELETE /api/projects/:project/commit-marks/:sha` endpoint

The web server SHALL expose
`DELETE /api/projects/:project/commit-marks/:sha` removing a row.

Behaviour:

- Project + viewer rules as above; viewer → 403.
- `sha` validation as above; invalid → 400.
- On success, calls `deleteCommitMark` and returns
  `200 { deleted: <boolean> }` (`false` when no row matched —
  idempotent).

#### Scenario: Owner delete of an existing mark
- **GIVEN** a mark exists for `abc1234…`
- **WHEN** the owner DELETEs `/api/projects/<p>/commit-marks/
  abc1234…`
- **THEN** the response is `200 { deleted: true }` and the next
  GET to `/commit-marks` omits the row

#### Scenario: Idempotent delete
- **GIVEN** no mark exists for `xxx…`
- **WHEN** DELETE is invoked
- **THEN** the response is `200 { deleted: false }`

### Requirement: `<CommitMarkBadge />` component

`apps/web/components/commit-mark-badge.tsx` SHALL export a
stateless component with the props:

```ts
interface CommitMarkBadgeProps {
  mark?: CommitMark | null
  size?: 'sm' | 'md'
}
```

The component MUST:

- Reserve a fixed-width slot regardless of whether a mark is
  present (so list rows stay aligned).
- When `mark` is `null` / `undefined`, render an invisible
  placeholder of the slot's natural width.
- When `mark` is present, render a colored dot via the
  status-to-token mapping:
  - `verified` → `bg-emerald-500`
  - `suspicious` → `bg-amber-500`
  - `issue` → `bg-destructive`
- Wrap the visible badge in a Radix `<Tooltip>` whose content is
  the status label + the note (when non-empty) + the
  `updated_at`.
- Carry the `data-slot="commit-mark-badge"` attribute and
  `data-status` reflecting the current status (or `none`).

#### Scenario: Unmarked commit renders an invisible placeholder
- **GIVEN** `<CommitMarkBadge />` is mounted with no `mark` prop
- **WHEN** it renders
- **THEN** the markup contains a `data-slot="commit-mark-badge"`
  element with `data-status="none"` AND the inner colored-dot
  span has classes that make it invisible (e.g. `opacity-0` or
  `invisible`), preserving slot width

#### Scenario: `verified` mark renders an emerald dot
- **GIVEN** `<CommitMarkBadge mark={{ status: 'verified', ... }} />`
- **WHEN** it renders
- **THEN** the inner colored-dot span has class
  `bg-emerald-500` AND `data-status="verified"`

### Requirement: `<CommitMarkEditor />` component

`apps/web/components/commit-mark-editor.tsx` SHALL export a
component for setting / clearing a commit's mark with the
save-policy split below.

Props:

```ts
interface CommitMarkEditorProps {
  project: string
  sha: string
  mark?: CommitMark | null
  /** Fired on every successful upsert OR delete. */
  onMutated?: () => void
  /** Fired whenever the note's dirty state changes. The parent uses
   *  this to gate navigation away from the commit (confirm prompt). */
  onDirtyChange?: (dirty: boolean) => void
}
```

The component MUST:

- Render three colored toggles for `verified`, `suspicious`,
  `issue` and a `<Textarea>` for the note (pre-populated from
  `mark.note` when present).
- **Auto-save on status change.** Clicking any status toggle SHALL
  immediately fire `setCommitMark(project, sha, { status:
  <clicked>, note: <current draft note in the textarea> })`. The
  user does NOT need to also click Save. This effectively flushes
  the current note draft along with the new status.
- **Manual save for note edits.** Typing in the note SHALL NOT
  fire a request. The Save `<Button>` is enabled exactly when the
  note draft differs from the persisted note AND a status is
  selected. Clicking Save fires `setCommitMark` with the current
  status + draft note.
- **Ctrl+S / Cmd+S in the textarea** SHALL trigger the same save
  as the Save button (preventing the browser's default "save
  page" dialog). When the form is not dirty, the keystroke is a
  no-op.
- The component SHALL emit `onDirtyChange(dirty)` whenever the
  note draft's dirty state changes (compared to the persisted
  note). The parent dialog uses this signal to prompt the user
  before discarding unsaved note edits on navigation.
- When a mark exists, render a "Clear" `<Button>` that triggers
  `deleteCommitMark`.
- Mutation `onSuccess` SHALL invalidate `['commit-marks',
  project]` so the badge in the commit list updates immediately
  AND SHALL call `onMutated?.()`.
- Surface mutation errors via a small inline `text-destructive`
  block beneath the form.

#### Scenario: Clicking a status toggle auto-saves immediately
- **GIVEN** the editor is mounted with an existing mark
  `{ status: 'verified', note: 'ok' }` and the user has NOT
  edited the note
- **WHEN** the user clicks the `suspicious` toggle
- **THEN** a PUT to `/api/projects/<p>/commit-marks/<sha>` is
  fired with `{ status: 'suspicious', note: 'ok' }` WITHOUT the
  user clicking Save

#### Scenario: Status auto-save also persists the current note draft
- **GIVEN** the editor with no existing mark, the user has typed
  "needs review" in the note but has NOT clicked Save
- **WHEN** the user clicks the `verified` toggle
- **THEN** a PUT is fired with `{ status: 'verified', note:
  'needs review' }`, and the note becomes the persisted note
  (no longer dirty)

#### Scenario: Typing in the note does NOT fire a save
- **GIVEN** the editor with an existing mark
- **WHEN** the user types into the note textarea
- **THEN** NO mutation is fired AND the Save button becomes
  enabled

#### Scenario: Ctrl+S in the textarea triggers save
- **GIVEN** the editor with a status selected and a dirty note
- **WHEN** the user presses Ctrl+S (or Cmd+S) while focus is in
  the textarea
- **THEN** the browser's default save action is suppressed AND a
  PUT is fired with the current status + note

#### Scenario: Ctrl+S is a no-op when the form is not dirty
- **GIVEN** the editor with a persisted mark and no draft changes
- **WHEN** the user presses Ctrl+S in the textarea
- **THEN** no mutation is fired AND the browser's default is
  still suppressed

#### Scenario: onDirtyChange tracks the note draft
- **GIVEN** the editor with an existing note `'ok'`
- **WHEN** the user types `'x'` into the textarea, then deletes
  it back to `'ok'`
- **THEN** `onDirtyChange(true)` was called when the note diverged
  AND `onDirtyChange(false)` was called when it returned to the
  persisted value

#### Scenario: Clear deletes the mark
- **GIVEN** the editor for SHA `abc…` with an existing `verified`
  mark
- **WHEN** the user clicks Clear
- **THEN** a DELETE to `/api/projects/<p>/commit-marks/abc…` is
  fired AND the `['commit-marks', <p>]` query is invalidated

### Requirement: Confirm before discarding an unsaved note on commit switch

`<GitHistoryDialog />` SHALL prompt the user for confirmation
(e.g. via `window.confirm`) before discarding a dirty note draft
when the user selects a DIFFERENT commit in the same dialog
session. On cancel, the
selection MUST stay on the current commit (no state change). On
confirm, navigation proceeds and the next commit's editor mounts
with its own state.

The dirty signal SHALL come from the editor via the
`onDirtyChange` callback documented above. The dialog tracks the
latest value in state.

The prompt applies ONLY to commit-row clicks within the same
dialog. Dialog close (Escape / overlay click / dialog
`onOpenChange(false)`) is NOT gated by this prompt in v1.

#### Scenario: Confirm fires on commit switch with dirty note
- **GIVEN** the editor for commit A has a dirty note draft
- **WHEN** the user clicks the row for commit B
- **THEN** `window.confirm` is invoked with a message mentioning
  the unsaved changes

#### Scenario: Cancel keeps the current commit selected
- **GIVEN** the confirm prompt fires
- **WHEN** the user cancels the prompt
- **THEN** the dialog's selected commit remains commit A AND no
  GET to `/api/projects/<p>/git-commit?sha=B…` is fired

#### Scenario: Confirm proceeds with navigation
- **GIVEN** the confirm prompt fires
- **WHEN** the user accepts the prompt
- **THEN** the selected commit changes to B AND the next render
  fetches commit B's detail

#### Scenario: Switch without a dirty note does NOT prompt
- **GIVEN** the editor for commit A has only persisted (clean)
  state
- **WHEN** the user clicks the row for commit B
- **THEN** `window.confirm` is NOT called AND the selection
  changes to B immediately

### Requirement: `CommitMark` carries an optional `submodule` field

The `CommitMark` type SHALL gain an optional `submodule: string`
field (empty string represents main repo; non-empty is the
submodule name from `.gitmodules`).

```ts
export interface CommitMark {
  sha: string
  status: CommitMarkStatus
  note: string
  updatedAt: string
  submodule: string  // '' for main repo
}
```

#### Scenario: Main-repo mark has empty submodule
- **GIVEN** a mark for SHA `abc…` in the main repo (no submodule
  param)
- **WHEN** the mark is returned by `readCommitMarks`
- **THEN** the entry's `submodule` field is the empty string `''`

#### Scenario: Submodule mark carries the name
- **GIVEN** a mark set with `submodule: 'vendor/foo'`
- **WHEN** the mark is returned by `readCommitMarks`
- **THEN** the entry's `submodule` field is `'vendor/foo'`

### Requirement: `setCommitMark` / `deleteCommitMark` accept submodule scope

`@memon/core` SHALL extend `setCommitMark` and `deleteCommitMark`
to accept an optional `submodule` argument so the writer can
target a specific submodule's mark row. Omitting the argument
defaults to `''` (main repo) — the existing call signature stays
backward-compatible.

`deleteCommitMark(projectRoot, sha, opts?)` SHALL accept an
OPTIONAL `submodule: string` parameter (positional or in opts)
that scopes the delete. When omitted, defaults to `''` (main
repo). The match is by `(sha, submodule)` exact tuple.

#### Scenario: Two repos with identical SHAs coexist
- **GIVEN** the main repo has a mark for SHA `abc…` AND the
  submodule `vendor/foo` also has a mark for SHA `abc…`
- **WHEN** the user invokes `deleteCommitMark(projectRoot,
  'abc…', { submodule: 'vendor/foo' })`
- **THEN** only the submodule entry is removed; the main-repo
  entry remains AND
  `readCommitMarks(projectRoot)` returns the main-repo row only

### Requirement: Commit-marks endpoints accept `?submodule=<name>` + return array shape

The commit-marks endpoints SHALL adopt two wire changes: GET
returns an array shape, and PUT / DELETE accept an optional
`?submodule=<name>` query parameter that scopes the mutation:

- `GET /commit-marks` returns
  `{ marks: CommitMark[], parseWarnings: string[] }` — an ARRAY
  of marks (each with the new `submodule` field), no longer a
  Record keyed by SHA.
- `PUT /commit-marks/:sha?submodule=<name>` upserts a mark scoped
  to the given submodule. Missing `submodule` = main repo.
- `DELETE /commit-marks/:sha?submodule=<name>` removes the
  matching `(sha, submodule)` row. Missing `submodule` = main
  repo. Returns `{ deleted: boolean }`.

When `submodule` is provided to PUT or DELETE, it MUST be
validated against the project's `.gitmodules` (via
`readGitSubmodules`). Unknown name → 400.

#### Scenario: GET returns array shape
- **GIVEN** the project has two marks (one main, one submodule)
- **WHEN** an owner requests `GET /commit-marks`
- **THEN** the response is
  `200 { marks: [{...empty submodule...}, {...submodule:
  'vendor/foo'...}], parseWarnings: [] }`

#### Scenario: PUT scoped to a submodule
- **GIVEN** an owner session and an existing
  `.gitmodules` declaring `vendor/foo`
- **WHEN** the owner PUTs
  `/commit-marks/abc1234?submodule=vendor%2Ffoo` with body
  `{ status: 'verified', note: '' }`
- **THEN** the CSV row `abc1234,verified,,<ts>,vendor/foo` exists
  on disk AND the response body's `mark.submodule === 'vendor/
  foo'`

#### Scenario: Unknown submodule rejected with 400
- **WHEN** PUT or DELETE is invoked with
  `?submodule=does-not-exist`
- **THEN** the response is `400` and no CSV mutation occurs

### Requirement: `<CommitMarkEditor />` threads submodule scope through

`<CommitMarkEditor />` SHALL accept an OPTIONAL `submodule?:
string` prop. When provided, all calls to `setCommitMark` /
`deleteCommitMark` from the editor include that submodule in the
request. The parent (`<GitHistoryDialog />`) passes the value
from its current submodule selector.

#### Scenario: Saving a mark in a submodule
- **GIVEN** the history dialog has `vendor/foo` selected and the
  user has clicked a commit
- **WHEN** the user clicks the `verified` toggle in the editor
- **THEN** the resulting `setCommitMark` call sends
  `?submodule=vendor%2Ffoo` AND the on-disk CSV gains a row with
  `submodule = vendor/foo`

