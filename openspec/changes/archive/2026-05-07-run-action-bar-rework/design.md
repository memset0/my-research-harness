## Context

Today's terminal flow is hardcoded around a single agent (`claude`):

```
TerminalButton (per-run-panel) — local React state
  └─ <TerminalSheet open onOpenChange runId projectName/>
      └─ on open: POST /api/terminal/start { runId, projectName }
          └─ manager.ts: spawn ttyd → tmux new-session -A -s memon-claude-<runId> claude
      └─ on close: POST /api/terminal/stop { sessionName }
          └─ manager.ts: SIGTERM the ttyd child
```

Three things are baked in: (a) one button per run = one drawer
state per run, (b) the agent is `claude`, (c) close = stop. This
change touches all three.

## Goals / Non-Goals

**Goals:**
- One `Open with` combo button replaces the old `Terminal` +
  `Open Claude Code` pair.
- Backend supports four agents.
- Drawer state is layout-scoped, persists across panel-close until
  route change.
- Popup mode opens the same terminal in a chrome-less window.

**Non-Goals:**
- True multi-session (multiple concurrent ttyd processes). v1
  single-port stays.
- A "session manager" UI listing active sessions. The existing
  `GET /api/terminal/list` is sufficient for v1; the future tmux
  management change can build a UI on top.
- Detecting whether `codex` / `opencode` binaries exist before
  showing the picker option. Just include them; if the CLI is
  missing, the existing early-stderr capture surfaces a warning.

## Decisions

**D1. `OpenWithButton` is a split-button via shadcn.** Two adjacent
buttons sharing visual treatment: the left (main) face shows the
default agent's label and is the click action; the right is a
chevron that opens a `DropdownMenu`. Default agent persists in
localStorage so power-users get one-click access to their preferred
CLI.

**D2. Session-name prefix is parameterized.** Move from the
hardcoded `SESSION_PREFIX = 'memon-claude-'` to
`getSessionPrefix(agent)` which returns:
- `'memon-term-'` for `none`
- `'memon-claude-'` for `claude` (preserves any existing tmux
  sessions a user has running)
- `'memon-codex-'` for `codex`
- `'memon-opencode-'` for `opencode`

This means switching agents on the same run keeps the previous
agent's tmux alive in the background (visible via `tmux ls`),
while the ttyd-bound active session is the new one. This matches
the existing "tmux survives ttyd kill" model.

**D3. The agent maps directly to the trailing tmux argv.** No
intermediate "command resolver" abstraction:

| agent | tmux argv tail |
|---|---|
| `none` | `tmux new-session -A -s memon-term-<runId>` |
| `claude` | `tmux new-session -A -s memon-claude-<runId> claude` |
| `codex` | `tmux new-session -A -s memon-codex-<runId> codex` |
| `opencode` | `tmux new-session -A -s memon-opencode-<runId> opencode` |

The leading `-A` flag means "attach to existing session if name
matches, else create" — so reopening the drawer for the same
agent + run reattaches.

**D4. The drawer state moves to a `TerminalDrawerProvider` in
the project layout.** Use a small React Context with one slot:

```ts
type DrawerState = null | {
  runId: string
  projectName: string
  agent: AgentKind
}
```

The `OpenWithButton` calls `setDrawerState({...})` to open. The
drawer reads the state and mounts/dismounts accordingly. On route
change (`usePathname()` value differs from previous), the provider
calls `stopSession(state.sessionName)` and clears the slot.

The drawer's `<X>` close handler now only sets `setDrawerState(null)`
WITHOUT calling stop — the session stays alive. A separate
`Close + stop session` button in the drawer header IS the
explicit kill path.

**D5. Popup mode opens the existing ttyd proxy URL directly.** The
proxy URL is same-origin, basic-auth is already cached in the
browser, ttyd serves a complete xterm UI on its own. So the popup
route is minimal:

```tsx
// app/terminal-popup/page.tsx
export default function TerminalPopupPage({ searchParams }) {
  const { runId, projectName, agent } = await searchParams
  return <TerminalView runId={runId} projectName={projectName} agent={agent} fullscreen />
}
```

`TerminalView` is the extracted iframe + start logic. In
`fullscreen` mode it occupies 100vh / 100vw with no chrome.

**D6. Window.open target = stable.** Using a target name pattern
like `memon-terminal-<runId>-<agent>` means clicking
`Open in new window` twice for the same combo refocuses the
existing popup instead of stacking duplicates.

## Risks / Trade-offs

- [Risk] Drawer-persistence flips a long-standing model (close =
  stop). A user who relied on close=stop to free GPU/CPU now sees
  the agent keep running. → Mitigation: the explicit
  `Close + stop session` button covers that case; tmux + ttyd
  themselves are extremely lightweight when idle (just shell +
  pty). The session also dies on route change.
- [Risk] Popup window may be blocked by browser popup blockers.
  → Mitigation: `window.open` triggered inside a click handler
  is allowed by all major browsers; the click on the
  `Open in new window` menu item satisfies the user-gesture
  requirement.
- [Risk] Codex / OpenCode binaries may not exist on the host.
  → Mitigation: the early-stderr capture in `manager.ts` already
  catches `command not found` and surfaces it via `warnings[]`.
  The user sees the warning in the drawer header.
- [Risk] Two callers of `startTerminal` (drawer + popup) for the
  same combo race on the single-port. → Mitigation: the
  `SERIALIZER_KEY` chain in `manager.ts` already serializes
  startSession calls. The second call wins; the popup's iframe
  reloads to the new sessionName.
- [Risk] The legacy `experiment-detail.tsx` page still imports the
  old `<TerminalButton>`. → Mitigation: leave `TerminalButton` as
  a thin shim that re-exports `<OpenWithButton>` with the
  `claude` default, OR leave the legacy page unchanged. We'll
  pick the latter — the legacy page is on a deletion track and a
  shim makes the legacy file harder to delete cleanly later.

## Migration Plan

Code-only edit. New routes / components are additive. The single
backend signature change (start endpoint adds optional `agent`)
is back-compat: existing callers without `agent` get
`'claude'` (the previous behavior).

## Open Questions

None blocking. The behaviors above are the simplest working
combinations; we can tune defaults (e.g. whether `none` should be
the default instead of `claude`) once the user has lived with it.
