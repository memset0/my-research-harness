## Context

`tmux-session-rework` shipped row actions on `/manage/tmux` as a
tri-button group `[Drawer] [Popup] [Kill]` regardless of matchability,
with the underlying buttons disabled only when the parsed name was
incomplete. Stale-but-parseable rows (e.g., the project simply got
removed from `config.yml`) still showed Drawer + Popup as enabled.

In practice opening such a row is noise, not utility — the manager
falls back to project root or `$HOME` and the user gets a confusing
view. Stale rows want one action: Kill.

## Goals / Non-Goals

**Goals:**
- Stale rows render only the `Kill` button. No Drawer, no Popup.
- Matchable rows are unchanged.
- The amendment is small and localized — one component file.

**Non-Goals:**
- Re-classifying any row. Stale detection logic is unchanged.
- Adding a tooltip on the now-absent Drawer/Popup explaining why
  they're gone. The `⚠ stale (...)` indicator in the Target cell is
  the explanation.

## Decisions

### D1. Conditional render, not disabled state

The buttons are removed from the DOM for stale rows, not rendered as
`disabled`. Reasons:
- Cleaner visual: stale rows have a single `Kill` button instead of
  two ghosted buttons + Kill.
- The user's natural eye-flow on a stale row is straight to Kill.
  Disabled buttons add visual noise.

Alternative considered: keep all three buttons + tooltip on
disabled. Rejected — tooltips on disabled shadcn Button require an
extra wrapper to capture hover; the value isn't worth the
complication.

### D2. Gating predicate is `row.matchable`

`row.matchable === false` (i.e. row is stale) is the gate for
hiding Drawer + Popup. The existing
`disabled={!p.agent || !p.project || !p.scope || !p.slug}` predicate
on each button covers the unparseable case as well — but with the
new conditional render, that branch becomes unreachable for those
buttons (unparseable rows are stale). The disabled check is removed
from Drawer / Popup; Kill is unconditional.

## Risks / Trade-offs

- [Risk] User wants to inspect a stale session before killing it
  (e.g., scroll the tmux scrollback). → Mitigation: they can
  `tmux attach -t <name>` from a real terminal. The management page
  is not the only path to a tmux session.
