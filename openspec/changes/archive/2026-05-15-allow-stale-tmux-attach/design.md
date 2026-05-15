## Context

`apps/web/app/manage/tmux/tmux-page.client.tsx` currently encodes a
three-layer block for stale rows that was inherited from the original
`tmux-session-management` spec:

1. `popupUrl(row)` returns `null` when `row.staleReason !== null` —
   the Popup icon button never renders.
2. `SessionCard.handleSelect` / `handleKey` early-return `undefined`
   when `stale === true` — clicks and Enter/Space don't propagate to
   `onSelect`, so the row never goes into URL `?session=` state.
3. `RightPane` returns `<RightPaneEmpty />` whenever
   `row.staleReason !== null` — even if the URL were forced via
   `?session=`, the iframe wouldn't mount.

The supporting backend (`POST /api/terminal/attach`) and the
`TerminalView mode="raw"` codepath are unaware of "stale" — they only
need a `^memon-[A-Za-z0-9._-]+$` sessionName. So the block is purely a
UI policy decision, and there is no infrastructure work to do.

The user has run into this in production: a project rename / removal
leaves a still-running tmux session orphaned in memon's index, and the
user wants to attach to it (to read the buffer or kill the program
cleanly) but can't.

## Goals / Non-Goals

**Goals:**

- Stale rows are selectable and openable in the inline right pane
  (raw mode).
- Stale rows expose the same Popup icon button manual rows do, opening
  `/terminal-popup?sessionName=<encoded>`.
- The user sees an unambiguous, non-dismissible **stale banner** above
  the iframe (both inline and popup) explaining which kind of staleness
  is in effect (`unknown-project` or `unknown-target`) and stating that
  memon-side navigation links won't resolve. The banner does not block
  interaction.
- The `Stale` scope/target badge in the list row stays exactly as today
  (amber `Stale (<reason>)` chip), and the row keeps `opacity-75` so it
  still reads as a demoted entry — only the interactive lock comes off.

**Non-Goals:**

- Changing `staleReason` classification (still `unknown-project` /
  `unknown-target` in `tmux-discover.ts`).
- Touching the `/api/terminal/attach` endpoint or the manager.
- Adding any "fix this stale row" mutation surface (e.g. rebind to a
  different project). That's a separate, larger change.
- Persisting any "I've seen this banner" state — the banner is always
  visible whenever a stale row is mounted.
- Adding a separate `Stale` filter behavior — Stale tab still filters
  by `staleReason !== null`.

## Decisions

### Reuse the raw-mode attach path, do not invent a new one.

The `TerminalView mode="raw"` codepath was added by the
`attach-tmux-by-name` change and is the canonical "attach to any
sessionName" mechanism in this codebase. Stale rows now route through
the same exact code as manual rows.

Alternative considered: extend `mode="standard"` to tolerate missing
project/run/exp. Rejected because the start path runs
`assertWithinProjectRoots` and many memon-server-side guards that
assume a real project; raw mode bypasses all of those by design.

### Render the warning banner in `RightPane` and in `TerminalPopupClient`, NOT inside `TerminalView`.

`TerminalView` is a leaf component shared by inline / popup / drawer /
manage. Embedding a stale banner inside it would require passing
`staleReason` down or duplicating it in every consumer. Instead, each
consumer that knows it might mount a stale session renders the banner
itself just above the iframe.

For the inline `/manage/tmux` right pane, the banner sits inside the
existing `<div className="flex h-full min-h-0 flex-1 flex-col">`,
between the existing slim header bar and the iframe-host
`<div className="flex flex-1 flex-col min-h-0">`.

For the popup page, the banner sits inside `TerminalPopupClient`'s
`raw` branch — but only when the URL also carries a `stale=<reason>`
hint (added when the list-row Popup button is clicked on a stale row).
Rationale: `TerminalPopupClient` only sees the URL, not the row
classification, so the page must be told via a query param whether to
render the banner. Raw popups opened from manual rows DO NOT receive
`stale=...` and therefore render no banner — preserving today's
behavior for manual rows.

### Banner styling.

A single line, amber background (matching the existing `BADGE_COLORS.stale`
amber palette), full-width, with the `AlertTriangle` lucide icon, the
text `Stale: <reason> — memon links won't resolve. ttyd is still
attached.`, and a `font-mono` rendering of the sessionName at the end.
No close / dismiss button — the banner is informational and tied to
the session, not to user state.

### Keep `opacity-75` on stale cards.

The card list opacity continues to signal "demoted entry, no current
memon target". Users have learned that visual; it's an accurate signal.
Only the interactive affordances (cursor, role, tabIndex, focus ring,
border-primary on select) come back.

### Popup URL shape.

The simplest possible extension: when `row.staleReason !== null`, the
popup URL is `?sessionName=<encoded>&stale=<reason>`. The `stale=`
param is the only difference from a manual popup URL. The popup page
validates `stale` against the same `unknown-project` / `unknown-target`
enum used by `staleReason` and ignores any other value silently.

## Risks / Trade-offs

[Risk] The stale tmux session may itself be in a broken state
(e.g. the process inside the pane crashed in a way that tmux can't
recover; the pane is a zombie). → Mitigation: the underlying
`tmux new-session -A -s <name>` already handles this — if the named
session truly no longer exists on the host, tmux creates a fresh
session with the same name and the user lands in a bare shell. This
matches manual-row behavior. The list-side classifier will then
re-classify the next refetch as `staleReason: 'unknown-target'`
without `liveEntry`, which is still fine.

[Risk] A user might attach to a stale session and assume the run is
"back" — i.e. that memon now indexes it. → Mitigation: the banner
text is explicit ("memon links won't resolve"); the row keeps the
`opacity-75` demoted look; the scope/target badge remains the amber
`Stale (<reason>)` variant rather than promoting to a green
run/exp/project badge.

[Risk] Spec drift: the existing
`tmux-session-management` spec has at least three scenarios
("Stale rows render Kill only and are non-selectable",
"Clicking the stale row's card body — no `<TerminalView>` is mounted",
plus the prose paragraph "Stale row: NEVER selectable") that must be
flipped. → Mitigation: the spec delta in this change uses explicit
MODIFIED / ADDED markers for those exact requirements.

## Migration Plan

UI-only, no data migration. Ship in a single deploy. Rollback is a
trivial revert of the three pieces in `tmux-page.client.tsx` plus the
banner in `terminal-popup-client.tsx`. No `FS_CONVENTION_VERSION`
involvement.

## Open Questions

None — the user's request is unambiguous and the implementation reuses
the existing raw-attach path verbatim.
