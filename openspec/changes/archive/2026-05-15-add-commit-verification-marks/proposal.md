## Why

The git-history dialog lets users browse a project's commits and
their diffs, but there's no place to RECORD a personal judgment on
each commit. After spot-checking a commit's diff, the user wants to
mark it: "verified — looks good", "suspicious — need to double-
check the GPU count", "issue — actually breaks the math". And they
want that judgment to be:

- **per-project** — different repos accumulate different review state
- **persistent across machines** — checked into the project's own
  git so a clone on another box keeps the marks
- **lightweight** — most commits stay unmarked; only marked entries
  pay storage cost
- **editable** — can change a mark later, or clear it entirely
- **optional note** — sometimes a sentence of context is worth more
  than the status alone

A small CSV file under each project's `.memon/` directory hits all
of those notes. `.memon/` already exists as the project-private
memon-data sub-directory (currently a placeholder); adding
`commit-marks.csv` there is the natural next step.

## What Changes

- **NEW** CSV file `<projectRoot>/.memon/commit-marks.csv` storing
  one row per marked commit. Format (RFC 4180):

  ```csv
  sha,status,note,updated_at
  abc1234567890abcdef1234567890abcdef12345678,verified,,2026-05-15T12:00:00+08:00
  def4567890abcdef1234567890abcdef123456789012,suspicious,"check the GPU count, also logs",2026-05-14T09:30:00+08:00
  ```

  Header row required. Rows MUST be sorted by `sha` ascending so
  git diffs read cleanly (additions / edits don't reorder
  unrelated rows). The file is meant to be **committed** to the
  project's git; the dashboard does not stage or commit it
  automatically — the user runs `git add .memon/commit-marks.csv`
  when they want to share their review state.
- **NEW** status enum: `verified` (green), `suspicious` (yellow),
  `issue` (red). UI surfaces use those colors via the dashboard's
  semantic-token palette (`bg-emerald-*`, `bg-amber-*`,
  `bg-destructive`).
- **NEW** core readers + writers in
  `packages/core/src/git/commit-marks.ts`:
  - `readCommitMarks(projectRoot, opts?)` → `Map<sha, CommitMark>`
    (empty map when the CSV is absent — that's the unmarked
    default for every project)
  - `setCommitMark(projectRoot, sha, { status, note? })` —
    upsert; atomic temp-file + rename so concurrent tab writes
    don't corrupt the file
  - `deleteCommitMark(projectRoot, sha)` — remove a row
  - CSV serialiser uses RFC 4180 quoting (notes with commas,
    quotes, or newlines get quoted; bare otherwise)
- **NEW** three endpoints, all guarded by the existing project-
  resolution + viewer-scope rules. Owner-only for mutations:
  - `GET /api/projects/:p/commit-marks` — full map. Returned as a
    JSON object `{ marks: Record<sha, CommitMark> }`.
  - `PUT /api/projects/:p/commit-marks/:sha` — upsert. Body
    `{ status: 'verified' | 'suspicious' | 'issue', note?: string }`.
    Viewer → 403.
  - `DELETE /api/projects/:p/commit-marks/:sha` — clear. Viewer
    → 403.
- **NEW** `apps/web/components/commit-mark-badge.tsx` — small
  reusable component rendering the colored dot + tooltip with
  status label and note (when present). Used in the commit list
  rows and beside the detail-pane header.
- **NEW** `apps/web/components/commit-mark-editor.tsx` — the
  status-setter control rendered in the selected-commit detail
  header. Three colored radio buttons (verified / suspicious /
  issue) + a "clear" button + an optional `<Textarea>` for the
  note + a "Save" button.
- **MODIFIED** `apps/web/components/git-history-dialog.tsx`:
  - The commit list row renders a `<CommitMarkBadge />` (small
    colored dot, or empty if unmarked) to the left of the SHA.
  - The selected-commit detail header renders the editor next to
    the SHA / author block.
- **NEW** API client helpers in `apps/web/lib/api.ts`:
  `fetchCommitMarks`, `setCommitMark`, `deleteCommitMark`.

What's NOT changing:

- The git-history dialog's existing layout, the commit list cap
  (100), the `/git-log` / `/git-commit` / `/git-diff` endpoints —
  all unchanged.
- No polling: marks are fetched once when the dialog opens (the
  same lifecycle as branches / log).
- No mtime locking for writes. Multi-tab races are mitigated by
  atomic temp-file rename + a TanStack mutation that invalidates
  `['commit-marks', project]` after each write so the next render
  reads the merged on-disk state. (Spec calls this out as an
  accepted v1 trade-off.)
- Viewers can SEE marks (read endpoint is in their scope) but
  cannot write — same posture as the rest of the dashboard.
- No `.memon/.gitignore` rewriting. We assume the user wants this
  directory checked in; their existing project gitignore SHOULD
  not exclude `.memon/`. If it does, the file is written but
  invisible to other clones — user discipline.

## Capabilities

### New Capabilities

- `commit-verification`: The CSV file format on disk, the three
  core readers/writers in `@memon/core/git/commit-marks.ts`, the
  three endpoints, the `<CommitMarkBadge />` and
  `<CommitMarkEditor />` components.

### Modified Capabilities

- `git-history-dialog`: the commit list row gains a leading
  `<CommitMarkBadge />`; the selected-commit detail header gains a
  `<CommitMarkEditor />`. Both wire through the new
  `commit-verification` capability.

## Impact

- **Code**:
  - new core module `packages/core/src/git/commit-marks.ts` +
    tests
  - new routes `apps/web/app/api/projects/[project]/commit-marks/
    route.ts` (GET) and `[project]/commit-marks/[sha]/route.ts`
    (PUT / DELETE) + tests
  - new components `commit-mark-badge.tsx`,
    `commit-mark-editor.tsx` + tests
  - touched `git-history-dialog.tsx` (badge in row + editor in
    detail)
  - new API client helpers in `apps/web/lib/api.ts`
- **Dependencies**: zero new npm deps. A tiny inline CSV
  parser/serialiser handles RFC 4180 quoting — small enough to not
  warrant a library.
- **Disk format**: new file `.memon/commit-marks.csv` per project.
  Directory `.memon/` is created lazily on first write. Existing
  empty `.memon/` placeholders are unaffected.
- **Performance**: full CSV read on dialog open. With typical
  research-repo review patterns (dozens to low-hundreds of marked
  commits) the file is < 50 KB — well below any throughput
  concern.
- **Security**: write endpoints owner-only. `sha` query parameter
  validated against the same safe-ref regex used by the other
  history endpoints (`/^[A-Za-z0-9_\-/.~^]+$/`, ≤ 200 chars). CSV
  parser hardened against malformed input.
