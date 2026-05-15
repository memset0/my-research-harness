# commit-verification Specification

## Purpose
TBD - created by archiving change add-commit-verification-marks. Update Purpose after archive.
## Requirements
### Requirement: CSV file format under `.memon/commit-marks.csv`

`@memon/core` SHALL persist commit verification marks in a CSV file
at `<projectRoot>/.memon/commit-marks.csv`. The format SHALL be:

```csv
sha,status,note,updated_at
<full 40-char SHA>,<verified|suspicious|issue>,<note>,<ISO 8601 w/ offset>
```

Requirements on the format:

- Header row MUST be present and contain exactly those four column
  names, in that order, comma-separated, with no trailing
  whitespace.
- Rows MUST be sorted by `sha` ascending (lexical byte order) so
  edits / additions don't reorder unrelated rows when committed to
  git.
- `sha` MUST be a non-empty string ≤ 200 characters matching the
  safe-ref character class `/^[A-Za-z0-9_\-/.~^]+$/`. In normal
  use it is the FULL 40-character SHA produced by `git log
  --format=%H`.
- `status` MUST be exactly one of `verified`, `suspicious`,
  `issue`. Anything else makes the row malformed.
- `note` MAY be empty. Notes containing commas, double-quote
  characters, or newlines MUST be quoted per RFC 4180 (wrap in
  double quotes; escape inner double quotes by doubling them).
  Empty notes are written as two adjacent commas with no quotes.
- `updated_at` MUST be an ISO 8601 timestamp with a timezone
  offset (matching memon's other timestamp conventions).

The CSV file SHALL be considered authoritative; readers MUST NOT
infer anything about missing SHAs (an absent SHA = unmarked).

#### Scenario: Round-trip simple row
- **GIVEN** a CSV file with the header plus one row:
  `abc1234567890abcdef1234567890abcdef12345678,verified,,2026-05-15T12:00:00+08:00`
- **WHEN** the file is read and re-serialised
- **THEN** the output is byte-identical to the input

#### Scenario: Note with a comma is RFC 4180 quoted on write
- **GIVEN** a `setCommitMark` call with `note: "check GPU count, also logs"`
- **WHEN** the writer serialises the mark
- **THEN** the row reads `<sha>,suspicious,"check GPU count, also logs",<ts>`
  (note is wrapped in double quotes)

#### Scenario: Note with embedded double-quote is doubled
- **GIVEN** a `setCommitMark` call with `note: 'said "hi" then left'`
- **WHEN** the writer serialises the mark
- **THEN** the row reads `<sha>,verified,"said ""hi"" then left",<ts>`

#### Scenario: Rows stay sorted by sha after edits
- **GIVEN** an existing CSV with rows for SHAs `aaa…`, `mmm…`,
  `zzz…` (in that order)
- **WHEN** the user adds a mark for `kkk…`
- **THEN** the resulting file has rows in order `aaa…`, `kkk…`,
  `mmm…`, `zzz…`

#### Scenario: Malformed row is skipped, others survive
- **GIVEN** a CSV where row 2 has only three columns (truncated)
  but rows 1 and 3 are well-formed
- **WHEN** the reader runs
- **THEN** the returned map contains entries for rows 1 and 3
  only, AND the result includes a `parseWarnings` array with one
  entry pointing at row 2

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

