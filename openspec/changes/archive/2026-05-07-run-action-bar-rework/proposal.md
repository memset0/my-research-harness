## Why

The expanded run panel's action bar today shows four flat buttons:
`Edit markdown`, `Open Claude Code`, `Terminal`, `+ Note`, plus
`StatusEdit`. Two pain points:

1. **One-of-many "open with X" choices.** The `Terminal` button
   always launches a `tmux + claude` session — there's no way to
   open the same run dir in a *plain* shell, or in a `codex`-CLI
   session, or in an `opencode`-CLI session. The user wants a single
   `Open with …` combo button with four picker options
   (terminal default, claude code, codex, opencode), each launching
   a tmux session that runs the chosen CLI (or just a shell for
   `terminal`).
2. **Drawer destruction on close + no popout.** The terminal drawer
   currently kills its tmux session as soon as the user closes the
   sheet, so flipping it open again restarts the agent from scratch.
   And there's no way to pop the terminal into a separate browser
   window.

Both pain points compound — they're about the same `Open with` flow.
Combined into a single change here.

## What Changes

### A — Action bar UI: `Edit / Open with [picker] / Note`

- The action bar SHALL render exactly three primary controls in
  this left-to-right order: `Edit markdown`,
  `Open with [picker]`, `+ Note`. `StatusEdit` and the
  parse-errors Badge stay where they are (action stripe right end,
  per the run-panel-flatten layout).
- `Open with` SHALL be a split-button or a button with a chevron
  trailing icon: clicking the main face launches the **default**
  agent (terminal); clicking the chevron opens a `DropdownMenu`
  with all four choices. The default SHALL be remembered across
  sessions in `localStorage` under
  `memon:terminal:default-agent` so a user who picks `claude code`
  once gets it as the default thereafter.
- Picker choices: `Terminal`, `Claude Code`, `Codex`, `OpenCode`.
  The dropdown SHALL also include an `Open in new window` option
  that opens the **current default agent** in a popup window
  instead of the side drawer (see C).

### B — Backend: agent parameter on `/api/terminal/start`

- `POST /api/terminal/start` SHALL accept an optional
  `agent: 'none' | 'claude' | 'codex' | 'opencode'` field
  (default `'claude'` to preserve back-compat with existing
  callers). Each value maps to a tmux command:
  - `none`: `tmux new-session -A -s memon-term-<runid>` (no
    trailing command — shell only)
  - `claude`: `tmux new-session -A -s memon-claude-<runid> claude`
    (existing behavior)
  - `codex`: `tmux new-session -A -s memon-codex-<runid> codex`
  - `opencode`: `tmux new-session -A -s memon-opencode-<runid> opencode`
- The session name prefix SHALL include the agent
  (`memon-<agent>-<runid>`) so different agents on the same run
  get distinct tmux sessions instead of colliding.
- The single-port `ttyd` constraint stays (v1 still allows only
  one ttyd at a time). Switching agents tears down the previous
  ttyd before starting the new one — same as switching runs today.
- The endpoint SHALL surface a clear warning when the chosen CLI
  binary isn't on PATH (e.g. user picks `codex` without the
  `codex` CLI installed). This reuses the existing
  `warnings: string[]` channel; the early-stderr capture already
  in `manager.ts` will fire if the CLI exits immediately.

### C — Drawer persistence + popup-window mode

**C1. Persistence-until-route-change.** Closing the drawer SHALL
NOT call `/api/terminal/stop`. The tmux + ttyd session stays alive
so reopening the drawer reattaches instantly. The session SHALL be
torn down when:
- The user navigates to a different route (`pathname` changes via
  `usePathname()`), OR
- The user explicitly clicks a `Close + stop session` button in
  the drawer header (a NEW affordance distinct from the `X` /
  outside click which now just hides), OR
- A different `Open with` invocation requests a different agent or
  run (the existing single-port constraint).

To make this work the drawer state SHALL move from per-button
local state to a shared `TerminalDrawerProvider` mounted in the
project layout (`apps/web/app/p/[project]/layout.tsx`). The
`Open with` button publishes `{open, runId, projectName, agent}`
to the provider; the provider mounts a single `<TerminalSheet>`
rooted in the layout.

**C2. Popup-window mode.** Selecting `Open in new window` from the
picker SHALL call `window.open(<terminal-popup-url>, target,
features)` with:
- `target = 'memon-terminal-' + sessionName` so repeat-clicks
  focus the same window instead of creating duplicates.
- `features = 'popup,width=1200,height=800'` (chrome-less).
- The URL points at a NEW route `/terminal-popup` that takes
  `runId`, `projectName`, `agent` as query params, mounts only a
  thin shell with no AppBar / Sidebar, and renders the same
  `TerminalSheet` body as the drawer (extracted into a shared
  `TerminalView` component).
- Auth: the popup is same-origin, so `Authorization: Basic` is
  already present in the browser's auth cache for that origin —
  the popup inherits credentials.
- The popup window's tmux session is independent from the
  drawer's; opening Window then Drawer (same agent, same run) is
  a no-op only if the existing single-port constraint matches.

### Out of scope (explicit defer)

- True multi-session ttyd / multi-port management. The user said:
  "之后关于tmux的管理会另外propose一个改动". The single-port
  constraint stays.
- Terminating the ttyd session when the *browser tab* closes
  without route change. The tmux session naturally outlives the
  browser; that's the whole point of using tmux.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `browser-terminal`: extend the start endpoint with the `agent`
  parameter, define the four agent variants, allow the popup-mode
  consumer alongside the drawer consumer.
- `experiment-edit`: amend the run-panel action bar requirement so
  the `Open with` combo is the only "open in browser" affordance —
  the previous separate `TerminalButton` + `OpenClaudeCodeButton`
  pair is no longer the contract.

## Impact

- `apps/web/components/experiment-page.tsx` — replace the inline
  `<TerminalButton>` + `<OpenClaudeCodeButton>` in the action stripe
  with a new `<OpenWithButton>` combo.
- `apps/web/components/open-with-button.tsx` (NEW) — the split
  button + DropdownMenu.
- `apps/web/components/terminal-drawer-provider.tsx` (NEW) — the
  layout-scoped state holder that owns the single `TerminalSheet`
  + listens for route changes.
- `apps/web/components/terminal-view.tsx` (NEW) — extract the
  ttyd-iframe + start/stop logic from `TerminalSheet` so both the
  drawer and the popup route can reuse it.
- `apps/web/app/p/[project]/layout.tsx` — mount the new provider.
- `apps/web/app/terminal-popup/page.tsx` (NEW) — the chrome-less
  popup route.
- `apps/web/lib/api.ts` — `startTerminal` gains the optional
  `agent` field; the response shape is unchanged (already returns
  `sessionName` etc.).
- `apps/web/lib/terminal/manager.ts` — accept `agent`; vary the
  tmux command + session prefix; loosen the
  `SESSION_PREFIX = 'memon-claude-'` hardcode.
- `apps/web/app/api/terminal/start/route.ts` — accept the field
  via the zod schema; pass through to `startSession`.
- `apps/web/components/terminal-sheet.tsx` — slim down to be a
  shadcn `<Sheet>` wrapper around `<TerminalView>`. The provider
  owns the open state.
- `apps/web/components/terminal-button.tsx` — removed (or kept as
  a thin alias for `<OpenWithButton>` until call sites migrate;
  the only call site outside this change is on the legacy
  `experiment-detail.tsx` page, which is on a deletion track).
