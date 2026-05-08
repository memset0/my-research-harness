## 1. Backend: classifier change + create endpoint

- [x] 1.1 In `apps/web/lib/terminal/tmux-discover.ts`, narrow the `StaleReason` type to `'unknown-project' | 'unknown-target'`. Update `classify()` so legacy and unparseable rows return `{ matchable: false, staleReason: null }` (the manual category) instead of `staleReason: 'old-format'` / `'unparseable'`.
- [x] 1.2 In `apps/web/lib/terminal/tmux-discover.ts`, add `createManualTmuxSession({ name })` that validates `name` (regex `[A-Za-z0-9._-]+`, no `--`, no leading `memon-`), runs `tmux has-session -t memon-manual-<name>` to record `alreadyExisted`, then runs `tmux new-session -A -d -s memon-manual-<name> -c <process.cwd()>`. Returns `{ sessionName, alreadyExisted }`. Use the existing `execTmux(['has-session', '-t', name])` and `execTmux(['new-session', '-A', '-d', '-s', name, '-c', cwd])` calls; same spawn pattern as `killTmuxSessionByName`.
- [x] 1.3 In `apps/web/app/api/tmux-sessions/route.ts`, add a `POST` handler alongside the existing `GET`. Body schema `{ name: z.string().min(1) }`. On valid body, call `createManualTmuxSession`. Return `{ ok: true, sessionName, alreadyExisted }` on 200, `{ error: { code: 'BAD_REQUEST', message } }` on 400.
- [x] 1.4 In `apps/web/lib/terminal/tmux-discover.test.ts`, update existing tests:
  - The "old-format" stale-classification test now asserts `matchable: false, staleReason: null` (manual).
  - Drop the `unparseable` tests' `staleReason` assertion (it's now null).
- [x] 1.5 Add new unit tests for `createManualTmuxSession`:
  - Happy path: name "foo" → spawns `tmux new-session -A -d -s memon-manual-foo -c <cwd>`, returns `alreadyExisted: false`.
  - Idempotent: when `tmux has-session` exits 0, returns `alreadyExisted: true`.
  - Validation: empty name throws; `--` in name throws; name starting with `memon-` throws; space in name throws.

## 2. Frontend: api.ts client + dialog UI

- [x] 2.1 In `apps/web/lib/api.ts`:
  - Trim `TmuxSessionRow.staleReason` type to `'unknown-project' | 'unknown-target' | null`.
  - Add `createTmuxSession(input: { name: string }): Promise<{ ok: true; sessionName: string; alreadyExisted: boolean }>` client (POSTs to `/api/tmux-sessions`).
- [x] 2.2 In `apps/web/app/manage/tmux/tmux-page.client.tsx`:
  - Add a `New session` button next to `Refresh` in the header area.
  - Add a Dialog (shadcn `Dialog`) with: title "New tmux session", an `Input` for the name (with the prefix `memon-manual-` shown as immutable text in front), a small label showing `cwd: <process.cwd()>` (the cwd is server-side; we can show a generic line like "cwd: memon's working directory" since the client doesn't know `process.cwd()`).
  - Submit fires `createTmuxSession({ name })` via a `useMutation`. On success: invalidate `['tmux-sessions']`, close the dialog, toast `Created memon-manual-<name>` or `Joined existing memon-manual-<name>` based on `alreadyExisted`. On error: toast the error.
- [x] 2.3 In `apps/web/app/manage/tmux/tmux-page.client.tsx`'s `SessionRow`, adjust the Target cell's third branch (matchable=false + staleReason=null) so it renders `—` (em-dash) instead of `⚠ stale (unknown)`. The grep should be: when `!row.matchable && !row.staleReason` → render `<span className="text-muted-foreground">—</span>`.

## 3. Verification

- [x] 3.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 3.2 `pnpm --filter @memon/web test` passes.
- [x] 3.3 Rebuild prod via the CLAUDE.md restart sequence; wait until prod is up.
- [x] 3.4 Smoke-test `POST /api/tmux-sessions`:
  - `{ name: "foo" }` → 200, `alreadyExisted: false`. Confirm `tmux has-session -t memon-manual-foo` exits 0 afterwards.
  - Repeat the same call → 200, `alreadyExisted: true`.
  - `{ name: "foo--bar" }` → 400 with `--` message.
  - `{ name: "memon-foo" }` → 400 with `memon-` message.
  - `{ name: "" }` → 400.
  - `{ name: "spa ce" }` → 400.
  - Anonymous (no auth header) → 401.
- [x] 3.5 `GET /api/tmux-sessions` lists the new `memon-manual-foo` row with `matchable: false, staleReason: null`.
- [x] 3.6 Compiled-chunk verification on the `/manage/tmux` chunk:
  - Contains the literal string `New session` (button label).
  - Contains the literal string `memon-manual-` (the prefix shown in the dialog).
  - Does NOT contain `'old-format'` or `'unparseable'` as STRING LITERALS (those values are gone from emission and from `STALE_REASON_LABEL` lookup).
- [x] 3.7 Browser check (described, not run via curl): on `/manage/tmux`, click `New session`, type `foo`, submit — toast confirms creation; the new row appears in the table with Target=`—`, actions=Kill only. Click Kill → row removed.
- [x] 3.8 Cleanup: `tmux kill-session -t memon-manual-foo` if the smoke-test session is still around.
