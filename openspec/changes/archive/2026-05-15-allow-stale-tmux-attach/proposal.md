## Why

The `/manage/tmux` page currently treats a `staleReason !== null` row as
un-attachable — clicking the card is a no-op, the keyboard activation is
disabled, the `Popup` icon button is hidden, and the right pane refuses
to mount a terminal even if the URL `?session=` param picks the stale
row. That is wrong: "stale" only means **the parsed `(project, slug)`
no longer resolves against memon's current view of the project / run /
exp indexes** — the tmux session itself is still alive on the host, has
a real pane, and is fully attachable via `POST /api/terminal/attach`
(which only needs the sessionName). The user needs to read the buffer,
copy output, or kill the program cleanly inside the session — exactly
the things ttyd is for.

The current behavior is also inconsistent with the existing **manual**
category, which has the same `matchable: false` shape but IS allowed to
attach via the raw mode. The stale class is, in fact, easier to attach
to than manual (both reach the same `tmux new-session -A -s <name>`
codepath); the block is purely a UI policy that no longer matches what
the user wants.

## What Changes

- Allow stale rows in `/manage/tmux` to be **selected by click** and by
  keyboard (Enter / Space), with the right pane mounting
  `<TerminalView mode="raw" sessionName={row.sessionName} />` — the
  same path that manual rows use today.
- Allow stale rows to render the **Popup** icon button in the row's
  action group, opening `/terminal-popup?sessionName=<encoded>`.
  Currently `popupUrl()` returns `null` for stale rows because the
  function falls through to the final `return null` after the
  `matchable` branch.
- The right pane (and the popup page, when a stale session is opened
  via popup) SHALL render a one-line **stale warning banner** above
  the iframe explaining the `staleReason` value (one of
  `unknown-project` / `unknown-target`), so the user understands why
  memon-side navigation links won't resolve while still being able to
  attach. The banner is informational; it does not gate the iframe.
- The visual treatment of stale rows in the list (amber `Stale (<reason>)`
  scope/target badge, `opacity-75` to read as "demoted") stays — only
  the interactive lock comes off, and the focus ring + cursor-pointer
  return so the row reads as click-target.

Non-changes (out of scope):

- `staleReason` classification logic in `apps/web/lib/terminal/tmux-discover.ts`
  stays exactly as today.
- The **Stale** filter tab on the list still shows stale rows only
  (excluding manual).
- `GET /api/tmux-sessions` payload shape is unchanged.
- `POST /api/terminal/attach` is unchanged — it already accepts any
  `^memon-[A-Za-z0-9._-]+$` sessionName, including stale ones.

## Capabilities

### New Capabilities

(None — this change only adjusts existing UI behavior of one capability.)

### Modified Capabilities

- `tmux-session-management`: stale rows go from "non-selectable, no
  popup, no terminal mount" to "selectable in raw mode, popup
  allowed, right pane mounts with a stale warning banner". The
  Kill-only / opacity-75 visuals stay; only the interactive lock and
  the popup-URL `null` are removed, and a new banner requirement is
  added.

## Impact

- **Affected code**:
  - `apps/web/app/manage/tmux/tmux-page.client.tsx`:
    - `popupUrl()` — drop the `if (row.staleReason === null) ... return null` gate; fall through to the raw URL for stale rows too.
    - `SessionCard` — drop the `if (stale) return` early-outs in `handleSelect` and `handleKey`; restore `role="button"`, `tabIndex={0}`, `cursor-pointer`, `focus-visible:ring-*` for stale rows; keep `opacity-75` and `selected && 'border-primary'` styling.
    - `RightPane` — drop the `if (stale) return <RightPaneEmpty />` early-out; render `<TerminalView mode="raw" sessionName={row.sessionName} />` for stale rows (same as manual fallback). Add a small banner row above the iframe when `row.staleReason !== null`.
- **Affected specs**: `openspec/specs/tmux-session-management/spec.md` — modified scenarios + new banner requirement (delta in `specs/tmux-session-management/spec.md` under this change).
- **No backend changes**. `POST /api/terminal/attach` already handles any `memon-*` sessionName.
- **No API contract changes**. `TmuxSessionRow` shape, SSE topics, and TanStack query keys are untouched.
- **No `FS_CONVENTION_VERSION` bump** — this is a UI-only fix.
- **Test impact**: small. One unit-ish behavioral change in the manage-tmux client; existing route tests for `/api/terminal/attach` already cover the underlying path.
