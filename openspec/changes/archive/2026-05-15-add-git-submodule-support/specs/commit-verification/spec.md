## MODIFIED Requirements

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

## ADDED Requirements

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
