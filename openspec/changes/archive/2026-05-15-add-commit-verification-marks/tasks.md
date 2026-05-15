## 1. Core CSV reader / writer

- [x] 1.1 Create `packages/core/src/git/commit-marks.ts`:
      - `MARKS_RELPATH = '.memon/commit-marks.csv'` constant
      - `CommitMarkStatus = 'verified' | 'suspicious' | 'issue'`
      - `CommitMark`, `ReadCommitMarksResult` types
      - RFC 4180-aware `parseCsv(text)` + `serializeCsv(rows)`
        helpers (small inline implementation)
- [x] 1.2 Implement `readCommitMarks(projectRoot, opts?)`:
      missing file → empty result; malformed rows → skipped +
      surfaced in `parseWarnings`.
- [x] 1.3 Implement `setCommitMark(projectRoot, sha, { status,
      note? })`:
      - validate `status` is one of the three legal values
      - validate `sha` against `/^[A-Za-z0-9_\-/.~^]+$/` (max 200
        chars)
      - read-existing → upsert → sort-by-sha → atomic-write
        (temp file + rename)
      - create `.memon/` directory lazily
      - return the resolved `CommitMark` with the freshly-stamped
        `updatedAt`
- [x] 1.4 Implement `deleteCommitMark(projectRoot, sha)`:
      idempotent. Returns `{ deleted: boolean }`.
- [x] 1.5 Re-export the new symbols and types from
      `packages/core/src/index.ts`.
- [x] 1.6 Unit tests in `packages/core/src/git/commit-marks.test.ts`:
      - parser round-trips simple rows
      - notes containing commas / quotes / newlines are RFC 4180
        quoted on write and unquoted on read
      - rows stay sorted by sha after edits
      - malformed row skipped + parseWarnings populated
      - missing header → empty marks + parseWarnings
      - `readCommitMarks` on absent file → empty result
      - `setCommitMark` inserts → reads back identically
      - `setCommitMark` updates an existing row (no duplicate)
      - `setCommitMark` creates `.memon/` if missing
      - invalid status / sha rejected with thrown Error
      - `deleteCommitMark` removes a row; idempotent on missing
- [x] 1.7 `pnpm --filter @memon/core typecheck` clean + full
      core tests green.

## 2. New endpoints

- [x] 2.1 Create `apps/web/app/api/projects/[project]/commit-
      marks/route.ts` exporting `GET`. Project resolution +
      viewer-scope rules match existing routes. Read is allowed
      for viewers in scope. Returns
      `readCommitMarks(project.root)`.
- [x] 2.2 Create `apps/web/app/api/projects/[project]/commit-
      marks/[sha]/route.ts` exporting `PUT` and `DELETE`. Both
      reject viewer sessions with 403. PUT validates `sha`
      against the safe-ref regex (400 on miss) AND validates
      body shape (400 on miss). Returns the resolved mark / the
      `{ deleted }` flag.
- [x] 2.3 Add `fetchCommitMarks(project)`, `setCommitMark(
      project, sha, input)`, `deleteCommitMark(project, sha)`
      and the matching types to `apps/web/lib/api.ts`.
- [x] 2.4 Integration tests covering:
      - GET: owner 200 with payload; viewer-in-scope 200;
        viewer-out-of-scope 403; unknown project 404
      - PUT: owner 200 + invokes setCommitMark; viewer 403;
        invalid sha 400; invalid status 400; invalid JSON body
        400
      - DELETE: owner 200 + invokes deleteCommitMark; viewer
        403; invalid sha 400

## 3. `<CommitMarkBadge />` component

- [x] 3.1 Create `apps/web/components/commit-mark-badge.tsx`
      with the props from spec D8.
- [x] 3.2 Slot reserves a fixed footprint via `inline-flex
      items-center w-3 h-3` (or equivalent). When `mark` is
      null, the inner dot has class `opacity-0` so the slot
      width persists; when present, the dot is colored per the
      status-to-token mapping.
- [x] 3.3 Wrap in a Radix `<Tooltip>` whose content shows the
      status label, the note (when non-empty), and the
      `updatedAt`.
- [x] 3.4 Set `data-slot="commit-mark-badge"` AND `data-status=
      {mark?.status ?? 'none'}` on the root element.
- [x] 3.5 Component test
      `apps/web/components/commit-mark-badge.test.tsx`:
      - unmarked renders `data-status="none"` AND has
        `opacity-0` (or equivalent invisibility) on inner dot
      - verified renders `bg-emerald-500`
      - suspicious renders `bg-amber-500`
      - issue renders `bg-destructive`
      - tooltip content matches the note when provided

## 4. `<CommitMarkEditor />` component

- [x] 4.1 Create `apps/web/components/commit-mark-editor.tsx`
      with the props from spec D8 / capability spec.
- [x] 4.2 Three colored toggle buttons for `verified` /
      `suspicious` / `issue`. Use existing `<Button>` primitive
      with variant differences per status. Show the current
      selection via `aria-pressed` + `data-active`.
- [x] 4.3 `<Textarea>` for the optional note. Pre-populates
      from the existing mark.
- [x] 4.4 `Save` button disabled when form is pristine relative
      to `mark`. `Clear` button rendered only when a mark
      exists.
- [x] 4.5 TanStack `useMutation` for save (PUT) and delete.
      `onSuccess` of either: `queryClient.invalidateQueries({
      queryKey: ['commit-marks', project] })`. Also call
      `onMutated?.()` if provided.
- [x] 4.6 Error block (`text-destructive` text) rendered when
      either mutation has an error.
- [x] 4.7 Component test
      `apps/web/components/commit-mark-editor.test.tsx`:
      - Save with picked status + note fires PUT with the right
        body
      - Clear fires DELETE
      - Save disabled while pristine; enabled after change
      - Successful mutation invalidates the commit-marks query

## 5. Wire into `<GitHistoryDialog />`

- [x] 5.1 Modify `apps/web/components/git-history-dialog.tsx`:
      - On dialog open, fire a `useQuery({ queryKey:
        ['commit-marks', project], queryFn: () =>
        fetchCommitMarks(project), enabled: open, staleTime:
        Infinity, retry: false })`.
      - Pass each row's mark (or `undefined`) to a leading
        `<CommitMarkBadge />` inside `<CommitRow />`. Keep the
        existing row content (SHA + subject + author + relative
        time) unchanged.
      - In the right-pane detail header, render
        `<CommitMarkEditor project sha mark />` near the
        existing metadata block.
- [x] 5.2 Update `apps/web/components/git-history-dialog.test.
      tsx`:
      - mock `fetchCommitMarks` (default: empty map)
      - assert: every row contains a `data-slot="commit-mark-
        badge"` (marked or unmarked)
      - assert: selecting a commit renders a `data-slot=
        "commit-mark-editor"` in the detail pane

## 5b. Save policy refinements

- [x] 5b.1 `<CommitMarkEditor />`: clicking a status toggle
      auto-fires `setCommitMark` with the clicked status + the
      current note draft (no Save button click needed).
- [x] 5b.2 Typing in the note does NOT fire a request; Save
      becomes enabled when the note differs from the persisted
      value.
- [x] 5b.3 Add an `onKeyDown` handler on the textarea: Ctrl+S
      (or Cmd+S) prevents default AND calls `mutate()` when the
      form is dirty; no-op when clean.
- [x] 5b.4 New `onDirtyChange?: (dirty: boolean) => void` prop:
      fired from a `useEffect` whose dependency is `noteDirty`
      (computed against the persisted note). On unmount, the
      effect cleanup fires `onDirtyChange(false)`.
- [x] 5b.5 `<GitHistoryDialog />`: track `editorDirty` state. When
      a commit row is clicked AND the clicked SHA differs from
      the currently selected SHA AND `editorDirty === true`,
      prompt via `window.confirm(...)` before changing
      `selectedSha`.
- [x] 5b.6 Update `<CommitMarkEditor />` tests:
      - status-toggle click auto-fires PUT with current note
      - typing in note alone does NOT fire PUT
      - Ctrl+S in textarea fires save (and calls preventDefault)
      - onDirtyChange callback tracks transitions
- [x] 5b.7 Update `<GitHistoryDialog />` tests:
      - clicking a different commit with dirty note → confirm
        fires
      - confirm cancel → no `fetchGitCommit` for the other sha
      - confirm accept → navigation proceeds
      - switching without a dirty note → no confirm

## 6. End-to-end verification

- [x] 6.1 `pnpm --filter @memon/core typecheck` clean; core
      tests green.
- [x] 6.2 `pnpm --filter @memon/web typecheck` clean; web tests
      green.
- [x] 6.3 Rebuild + restart prod per CLAUDE.md flow.
- [x] 6.4 Curl `GET /api/projects/<a-real-git-project>/commit-
      marks` → 200 with `marks: {}` initially.
- [x] 6.5 Curl `PUT /api/projects/<p>/commit-marks/<some-sha>`
      with body `{"status":"verified","note":"e2e check"}` → 200
      with the resolved mark.
- [x] 6.6 Curl GET again → 200 with the just-written mark in the
      `marks` map.
- [x] 6.7 Inspect the on-disk file: `cat <projectRoot>/.memon/
      commit-marks.csv` shows the header + the one row, RFC 4180
      quoted note.
- [x] 6.8 Curl `DELETE /api/projects/<p>/commit-marks/<sha>` →
      200 `{deleted: true}`. Re-GET → empty map.
- [x] 6.9 Curl `PUT` with `{"status":"green"}` → 400.
- [x] 6.10 Curl `PUT` with viewer session → 403.
- [x] 6.11 `openspec validate add-commit-verification-marks
      --type change` clean.
