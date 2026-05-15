## 1. Backend: `tmux rename-session` helper + endpoint

- [x] 1.1 In `apps/web/lib/terminal/tmux-discover.ts`, add a new exported function `renameTmuxSession({ oldName, newName }: { oldName: string; newName: string }): Promise<void>`:
  - Validate BOTH names against the existing `SAFE_NAME_RE = /^memon-[A-Za-z0-9._-]+$/`. Throw `Error('refusing to rename: name does not match memon-...')` if either fails.
  - Throw `Error('newName must differ from oldName')` if `oldName === newName`.
  - Call `tmuxHasSession(oldName)` — if false, throw `Error('old session not found')` (caller maps to 404).
  - Call `tmuxHasSession(newName)` — if true, throw a specifically-typed error indicating CONFLICT (e.g. attach a `code: 'CONFLICT'` field on the Error instance so the route can detect it). Suggested pattern: throw `Object.assign(new Error('tmux session ' + newName + ' already exists'), { code: 'CONFLICT' })`.
  - Best-effort: call `stopSession(oldName)` (from `./manager`) inside a try/catch — log on failure but proceed.
  - Run `execTmux(['rename-session', '-t', oldName, newName])`. Re-throw on non-zero exit.
- [x] 1.2 Create `apps/web/app/api/tmux-sessions/[name]/rename/route.ts` with a `POST` handler:
  - URL-decode the path `:name`, validate against `^memon-[A-Za-z0-9._-]+$`; on failure return 400 with `{ error: { code: 'BAD_REQUEST', message: 'name must match memon-[A-Za-z0-9._-]+' } }`.
  - Parse JSON body via zod schema: `z.object({ newName: z.string().min(1).regex(/^memon-[A-Za-z0-9._-]+$/, 'newName must match memon-[A-Za-z0-9._-]+') })`. On failure return 400 with the zod issue messages joined.
  - If `oldName === newName`, return 400 `{ error: { code: 'BAD_REQUEST', message: 'newName must differ from oldName' } }`.
  - Call `renameTmuxSession({ oldName, newName })`:
    - On a thrown `Error` with `code === 'CONFLICT'`, return 409 with the message.
    - On a thrown `Error` with message matching `/old session not found/`, return 404 `{ error: { code: 'NOT_FOUND', message: 'tmux session not found' } }`.
    - On any other thrown `Error`, return 500 `{ error: { message } }`.
  - On success return 200 `{ ok: true, sessionName: newName }`.
  - Set `export const dynamic = 'force-dynamic'`.
- [x] 1.3 Confirm the auth middleware classifies the new route as `shell`. Inspect `apps/web/middleware.ts` (or wherever the route-class map lives) — the existing `POST /api/tmux-sessions` + `DELETE /api/tmux-sessions/:name` are already `shell`; the new path `POST /api/tmux-sessions/:name/rename` SHALL match the same prefix pattern. Verify by writing a quick unit test asserting an anonymous request returns 401.
- [x] 1.4 Add a route test at `apps/web/app/api/tmux-sessions/[name]/rename/route.test.ts` mirroring the style of the existing `[name]/route.test.ts`. Cover:
  - Happy path (rename succeeds; `execTmux` is called with `['rename-session', '-t', old, new]`).
  - `oldName === newName` → 400.
  - Path regex failure → 400.
  - Body regex failure → 400.
  - Old session missing → 404 (mock `tmuxHasSession(old)` → false).
  - New session exists → 409 (mock both `has-session` calls accordingly).
  - Anonymous request → 401.
  - Manager teardown is invoked when an entry exists (spy on `stopSession`).

## 2. API client helper

- [x] 2.1 In `apps/web/lib/api.ts`, add a new exported function `renameTmuxSession({ name, newName }: { name: string; newName: string }): Promise<{ ok: true; sessionName: string }>`:
  - Issues a `POST` to `/api/tmux-sessions/${encodeURIComponent(name)}/rename` with `JSON.stringify({ newName })` and `Content-Type: application/json`.
  - On non-2xx, throws an `ApiError` carrying the server message + HTTP status (match the existing helpers' error-handling pattern).
  - On 2xx, returns the parsed body.

## 3. UI: Rename icon button + dialog

- [x] 3.1 In `apps/web/app/manage/tmux/tmux-page.client.tsx`, add a new `RenameDialog` function component near the existing `New session` dialog. Props: `{ row: TmuxSessionRow | null; onOpenChange: (open: boolean) => void; onRenamed: (oldName: string, newName: string) => void }`. When `row !== null`, render an open shadcn `<Dialog>`; when null, render closed.
  - Internal state: `value: string` (init to `row?.sessionName ?? ''`), `submitting: boolean`, `serverError: string | null`.
  - On the `Dialog` `open` event, reset state and focus + select-all the input via `useEffect` on `[row?.sessionName]`.
  - Compute `clientValidationError: string | null` from:
    - `value === ''` or `!/^memon-[A-Za-z0-9._-]+$/.test(value)` → `'must match memon-[A-Za-z0-9._-]+'`
    - `value === row?.sessionName` → `'same as current name'`
    - otherwise `null`
  - Render: `<DialogHeader>` with title `Rename tmux session` and description containing the current sessionName in a `<code className="font-mono">`. `<Label htmlFor="rename-input">New name</Label>` + `<Input id="rename-input" value={value} onChange={…} disabled={submitting} />`. Below the input, render the inline error (the first of `serverError` then `clientValidationError`) when present. `<DialogFooter>` with `<Button variant="outline" onClick={cancel} disabled={submitting}>Cancel</Button>` and a submit `<Button onClick={submit} disabled={submitting || clientValidationError !== null}>{submitting ? 'Renaming…' : 'Rename'}</Button>`.
  - The `submit` handler:
    - `setServerError(null); setSubmitting(true)`
    - `await renameTmuxSession({ name: row.sessionName, newName: value })`
    - On success: call `onRenamed(row.sessionName, value)`, close the dialog (`onOpenChange(false)`).
    - On `ApiError`: `setServerError(err.message)` and stay open.
    - On any other throw: surface a generic toast and stay open.
    - Finally: `setSubmitting(false)`.
- [x] 3.2 In the same file, modify `SessionCard` to add a Rename icon button as the FIRST action button (left of Popup and Kill):
  - Imports: extend the existing `lucide-react` import to include `Pencil`.
  - Add `onAskRename: (sessionName: string) => void` to `SessionCard` props.
  - Render the button just inside the `<div className="flex shrink-0 items-center gap-0.5">` wrapper, BEFORE the existing Popup button:
    ```tsx
    <ViewerGuard reason="Rename tmux session">
      <Button
        variant="ghost"
        size="sm"
        className="hidden h-6 w-6 p-0 md:inline-flex"
        onClick={(e) => {
          e.stopPropagation()
          onAskRename(row.sessionName)
        }}
        aria-label="Rename session"
      >
        <Pencil className="size-3" />
      </Button>
    </ViewerGuard>
    ```
  - Confirm the Kill button remains visible at every viewport (no `hidden md:inline-flex` on it).
- [x] 3.3 In `TmuxManagePageClient`, add the wiring for the Rename dialog:
  - `const [renameTarget, setRenameTarget] = useState<string | null>(null)`
  - Compute `const renameTargetRow = useMemo(...)` from `allByName.get(renameTarget)`.
  - Pass `onAskRename={(n) => setRenameTarget(n)}` down to every `<SessionCard>` instance (via the `LeftPane` → `SessionCard` props chain).
  - Render `<RenameDialog row={renameTargetRow ?? null} onOpenChange={(o) => !o && setRenameTarget(null)} onRenamed={handleRenamed} />` near the existing `New session` and `Kill confirm` dialogs.
  - `handleRenamed(oldName, newName)`:
    - `qc.invalidateQueries({ queryKey: ['tmux-sessions'] })`
    - `toast.success(\`renamed ${oldName} → ${newName}\`)`
    - If `selectedName === oldName`: call `router.replace(\`/manage/tmux?session=${encodeURIComponent(newName)}\`)` so the right pane re-mounts on the new name. (The backend already stopped the old ttyd, so `TerminalView` re-keys and attaches a fresh one.)
    - Update the in-memory `orderedNames` snapshot to swap `oldName` for `newName` in place, so the row doesn't visually jump positions on the next refetch.

## 4. Verification

- [x] 4.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 4.2 Build the prod web app (kill old `pnpm start` → `pnpm --filter @memon/web build` → `pnpm start`). Confirm `/manage/tmux` returns 200.
- [x] 4.3 With at least one matchable + one manual `memon-*` tmux session on the host, perform the F1 two-curl verification:
  - Fetch `/manage/tmux`, grep the HTML for three icon-only buttons per row in the order `aria-label="Rename session"` → `aria-label="Open in popup"` → `aria-label="Kill session"`. Confirm both Rename and Popup carry class `hidden md:inline-flex` and Kill does not.
  - Confirm compiled CSS includes the Pencil-icon class rules and the existing `hidden md:inline-flex` utilities.
- [x] 4.4 Real browser:
  - Click `Rename` on a manual row, type a new name, submit. Confirm a 200 response, the row reappears under the new name within ~5s, the toast fires, and (if the row was selected) the right pane stays attached without manual re-click.
  - Open the Rename dialog and submit a name equal to the current name. Confirm the submit button stays disabled and the inline `same as current name` appears.
  - Open the Rename dialog and submit a name that already exists. Confirm the dialog stays open and the inline error shows the server's `tmux session ... already exists` message.
  - Open the Rename dialog on a stale row. Confirm the rename succeeds and (after the next refetch) the row classification may change (e.g. stale → manual if the new name doesn't parse).
- [x] 4.5 Run `pnpm --filter @memon/web test [name]/rename/route.test.ts` (the new test file from 1.4) — all cases green.

## 5. Spec sync

- [x] 5.1 Re-run `openspec validate rename-tmux-session --type change` after any prose edits.
