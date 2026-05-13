## Why

The current `/manage/tmux` page is a wide table of rows; opening a
session in the browser is a two-step interaction (find the row → click
`Drawer` to overlay a sheet, or `Popup` to spawn a window). Switching
between sessions means closing the drawer and clicking another row, or
managing N popup windows. The wide table also wastes horizontal space
(eight columns of dash-padded metadata) on a page whose actual job is
"pick a session and use its terminal".

We want a layout that surfaces both halves of that job simultaneously:
the **list on the left** for picking, and the **terminal on the right**
for using. Clicking a row replaces the right pane's contents — no
drawer to dismiss, no second click. The divider is draggable so power
users can give the terminal more room when reading scrollback. On
phones the same split rotates to top/bottom.

## What Changes

### `/manage/tmux` becomes a resizable split-pane page

- **BREAKING (UI only)**: The table layout is replaced by a two-pane
  layout. Desktop: left list + right terminal, horizontal divider.
  Mobile (< Tailwind `md` breakpoint): top list + bottom terminal,
  horizontal-bar vertical-orientation divider.
- The page fills the available `<SidebarInset>` content area
  (`h-full` / `h-[100dvh]` minus the inset chrome). The current
  `max-w-[1400px] p-6` wrapper is removed in favor of full-bleed.
- Pane sizes are persisted in `localStorage` (key
  `memon:manage-tmux:split-sizes`), so a user's preferred split
  survives reloads. Default split is 30/70 on desktop, 45/55 on mobile.

### Left pane: compact session list

- Header (sticky): `tmux sessions` title, filter tabs (`All` /
  `Active in memon` / `Stale`, unchanged), `New session` button, and
  `Refresh` button — same controls as today, just packed tighter.
- Each row is a card (not a table cell) showing:
  - **Category badge** (lead element, colored by category): one of
    `manual` (amber), `run` (emerald), `exp` (sky), `project` (violet),
    `legacy` (muted). Category is derived from the parse result and
    the literal prefix:
    - `manual` when the sessionName starts with `memon-manual-`.
    - `run` when `parsed.scope === 'run'`.
    - `exp` when `parsed.scope === 'exp'`.
    - `project` when the sessionName starts with `memon-project-`
      (forward-compatible — no current names match, but the rule is in
      place if a future scheme adds them).
    - `legacy` when `parsed.legacy === true` (the pre-rework
      `memon-<agent>-<runId>` format).
  - **Title**: the session name with the universal `memon-` prefix
    stripped AND any of the secondary category-name prefixes
    (`manual-`, `project-`, `exp-`, `run-`) stripped if present
    immediately after `memon-`. Examples:
    - `memon-manual-foo` renders as `foo`.
    - `memon-claude-project-a--run--foo-260507-103000` renders as
      `claude-project-a--run--foo-260507-103000` (only `memon-` is
      stripped — none of the secondary prefixes match).
    - `memon-claude-foo-260507-103000` (legacy) renders as
      `claude-foo-260507-103000`.
  - **Last activity**: relative time (`5m ago`), unchanged formatting.
  - **Inline badges** for the row's parsed metadata. Each badge is
    rendered **only if its value is non-null** (i.e. the table
    currently shows a value other than `—`). Possible badges, in
    order, all rendered AFTER the category badge:
    - `:<port>` — ttyd bound port (from `liveEntry.port`)
    - `<agent>` — `claude` / `codex` / `opencode` / `terminal` (omitted
      for manual rows where `parsed.agent` is null)
    - `<project>` — project name (omitted when `parsed.project` is null)
    - target — clickable link to `/p/<project>/r/<slug>` or
      `/p/<project>/e/<slug>` for matchable rows; replaced by an inline
      `⚠ stale (<reason>)` indicator for stale rows; omitted entirely
      for manual rows.
    (Note: `<scope>` is no longer a standalone badge — it's encoded in
    the lead category badge.)
  - **Actions** (right-aligned, icon-only on narrow widths):
    - `Popup` — opens the row's terminal in a popup window (existing
      behavior, kept; hidden below `md` per existing convention).
    - `Kill` — opens the same confirmation dialog as today.
    - `Drawer` button is **REMOVED**. Clicking the row body itself
      selects the row, which is the new replacement for opening the
      drawer.
- The currently-selected row has a visible selected state (subtle
  `bg-accent` background + left border accent).
- Clicking a row body (not the action buttons) sets the selected
  session. The selection is reflected in the URL as `?session=<name>`
  so a refresh preserves which row is open.

### Right pane: inline terminal

- When no session is selected, shows an empty state — a centered
  placeholder reading "Select a session from the list" plus a brief
  hint about the new split-pane behavior on first visit.
- When a session is selected, renders `<TerminalView>` (the existing
  component) inline, filling the pane. The component is keyed on
  `sessionName` so React tears down and remounts when the user picks a
  different row.
- The pane has a slim header bar above the terminal iframe showing the
  full (un-stripped) session name as monospace plus a "Pop out"
  button that opens the same `/terminal-popup` URL the per-row popup
  uses, and a refresh / reattach button.
- `<TerminalView>` is invoked in **standard** mode for matchable rows
  (calls `POST /api/terminal/start` with `(project, scope, slug, agent)`)
  and in **raw** mode for manual rows (calls `POST /api/terminal/attach`
  with just `sessionName`), reusing the discriminated-props plumbing
  introduced by `attach-tmux-by-name`. Stale rows are not selectable
  (their card is render-only; the row body does not become a click
  target — consistent with their existing Kill-only treatment).

### Drawer entry point on `/manage/tmux` is gone

- The `useTerminalDrawer()` call is removed from
  `tmux-page.client.tsx`. The page renders the terminal inline in its
  own right pane, so the global drawer no longer participates.
- The `TerminalDrawerProvider` itself **stays mounted** in
  `providers.tsx` because other pages still use it
  (`components/open-with-button.tsx` opens it from run/exp pages).
  This change does not touch that surface.

### Capabilities

#### New Capabilities
<!-- none -->

#### Modified Capabilities
- `tmux-session-management`: page layout becomes split-pane;
  per-row action set drops `Drawer`; left-pane row is a card with
  conditional badges and a stripped `memon-` prefix; URL persists
  selection; localStorage persists pane sizes.

## Impact

### Dependencies

- New runtime dep: `react-resizable-panels` (pulled in by
  `pnpm dlx shadcn@latest add resizable --yes`). This is the canonical
  resizable primitive shadcn ships and is safe to add — `components.json`
  is already a real shadcn init (style: `radix-mira`, baseColor:
  `mist`, css-vars on).

### Files (web)

- `apps/web/components/ui/resizable.tsx` (NEW, shadcn) — the
  `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle` shells.
- `apps/web/app/manage/tmux/page.tsx` — drop the
  `max-w-[1400px] p-6` wrapper in favor of a full-bleed container that
  fills the SidebarInset.
- `apps/web/app/manage/tmux/tmux-page.client.tsx` — rewritten layout:
  remove the table + drawer call, add the split pane, the card-style
  list, the selection state (URL-backed), and the inline terminal pane.
- `apps/web/app/manage/layout.tsx` — minor tweak: the `<SidebarInset>`'s
  child wrapper currently uses `flex-1`; the tmux page wants
  `h-[100dvh]` to give Resizable a parent height. Either add a height
  utility class scoped to the tmux page, or have the page set its own
  height. Decision deferred to design.md.
- `apps/web/components/terminal-drawer-provider.tsx`,
  `apps/web/components/terminal-view.tsx`,
  `apps/web/app/terminal-popup/page.tsx`,
  `apps/web/app/terminal-popup/terminal-popup-client.tsx` —
  **unchanged** (the existing standard/raw discriminated plumbing is
  reused as-is).
- `apps/web/lib/api.ts` — unchanged.

### Specs

- `openspec/specs/tmux-session-management/spec.md` — modified
  requirement: page layout, per-row card, action set, selection
  persistence.
