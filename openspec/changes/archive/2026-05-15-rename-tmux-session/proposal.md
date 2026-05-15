## Why

The `/manage/tmux` page has no way to rename a tmux session in place.
Today the only path for a wrongly-named session is **kill + recreate**,
which loses the running pane content (the user's REPL state, the
half-written command, the tmux scrollback). For matchable rows this is
especially painful: when a run / exp gets renamed on disk, the
corresponding `memon-<agent>-<project>--<scope>--<slug>` tmux session
goes stale (`unknown-target`) and can't be reattached to the new memon
target — the user has to kill the existing claude/codex pane and start
over.

`tmux rename-session -t <old> <new>` is a one-line operation that
preserves the pane and all its state. The change is purely an
additive surface: one new HTTP endpoint, one new icon button in the
existing row action group, and one Dialog for entering the new name.

## What Changes

- **Web backend**: new endpoint `POST /api/tmux-sessions/:name/rename`
  with body `{ newName }`. Runs `tmux rename-session -t <name> <newName>`
  after validating both names against `^memon-[A-Za-z0-9._-]+$`. If the
  old name has a live ttyd entry in the terminal manager, tear it down
  (`stopSession(oldName)`) BEFORE the tmux rename so the ttyd doesn't
  outlive its target key. Returns `{ ok: true, sessionName: newName }`
  on success; 400 for shape errors; 404 if the old name doesn't exist;
  409 if the new name is already taken on the host.
- **`/manage/tmux` UI**: a new icon-only `Rename` action button in the
  row action group, positioned to the LEFT of the existing `Popup` and
  `Kill` buttons (so the visual order is `Rename` → `Popup` → `Kill`).
  Uses the `Pencil` lucide icon with `aria-label="Rename session"`.
  Hidden on viewports below the Tailwind `md` breakpoint
  (`hidden md:inline-flex`) to match the existing `Popup` button's
  responsive policy.
- **Rename dialog**: clicking `Rename` opens a shadcn `Dialog` with:
  - a single `Input` pre-filled with the current sessionName (full
    `memon-...` form),
  - inline client-side validation (matches `^memon-[A-Za-z0-9._-]+$`,
    is not equal to the current name, doesn't contain whitespace),
  - a `Rename` submit button (disabled until the input passes client
    validation),
  - a `Cancel` button,
  - on submit, calls `POST /api/tmux-sessions/<old>/rename` and on
    success: invalidates the `['tmux-sessions']` TanStack query,
    closes the dialog, and shows a toast `renamed <old> → <new>`. On
    4xx error, surfaces the server message inline near the input
    without closing the dialog.
- **Selection bookkeeping**: when the renamed session was the currently-
  selected row (`?session=<old>`), the URL `?session=` query param
  SHALL be updated to the new name via `router.replace` after the
  refetch succeeds, so the right-pane terminal stays focused on the
  same (now renamed) session. The previous ttyd was already torn down
  on the backend, so the right-pane `TerminalView` will re-mount
  fresh and POST `/api/terminal/attach` for the new name.
- **`ViewerGuard`**: the `Rename` button SHALL be wrapped in
  `<ViewerGuard reason="Rename tmux session">` matching the existing
  `Popup` and `Kill` buttons' viewer-mode gating.

Non-changes (out of scope):

- No CLI surface (`memon tmux rename` etc.). The rename is web-only for
  this change — keeps the surface area minimal.
- No re-binding of a renamed session to a different memon target.
  Renaming a `memon-claude-A--run--foo-...` to
  `memon-claude-B--run--bar-...` changes how `/api/tmux-sessions`
  classifies the row on the next refetch, but the user is responsible
  for typing a name that makes sense.
- No automatic rename of memon-side artefacts. Renaming the tmux
  session DOES NOT touch the on-disk run dir / exp doc / experiment
  index.
- No history of past names on a session. The rename is destructive
  from tmux's POV.

## Capabilities

### New Capabilities

(None — this extends an existing capability.)

### Modified Capabilities

- `tmux-session-management`: adds the rename endpoint to the
  HTTP-routes section, adds the `Rename` icon button + dialog +
  selection-refocus behavior to the page requirement.

## Impact

- **Affected code**:
  - `apps/web/lib/terminal/tmux-discover.ts` — new export
    `renameTmuxSession({ oldName, newName })` running
    `tmux rename-session -t <old> <new>` after the validation pass.
  - `apps/web/app/api/tmux-sessions/[name]/rename/route.ts` — new
    `POST` handler.
  - `apps/web/app/manage/tmux/tmux-page.client.tsx` — new
    `RenameDialog` component, new `Rename` icon button in
    `SessionCard`, plumbing in `TmuxManagePageClient` for the
    dialog open/close state and the post-rename selection refocus.
  - `apps/web/lib/api.ts` — new client `renameTmuxSession({ name,
    newName })` helper.
- **Affected specs**: `openspec/specs/tmux-session-management/spec.md`
  (delta in this change at `specs/tmux-session-management/spec.md`).
- **No SSE topic changes**. The list polls every 5s and the rename
  flow explicitly invalidates the query — no need to broadcast.
- **No `FS_CONVENTION_VERSION` bump** — tmux state is host-level,
  not on-disk memon state.
- **Test impact**: add an integration-level route test for the new
  endpoint (mocks `execTmux`, asserts the validation matrix and the
  manager teardown). Optionally a browser-level smoke test that the
  dialog opens / validates / submits.
