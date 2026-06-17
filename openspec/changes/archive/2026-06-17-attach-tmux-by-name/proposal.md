## Why

The previous change `create-manual-tmux-session` (just shipped) introduced
the **manual** category — sessions whose names don't parse to the
`memon-<agent>-<project>--<scope>--<slug>` convention. They're either
legacy (pre-tmux-session-rework) or user-created via the new dialog.

That change shipped with manual rows showing **only the `Kill` action**
in `/manage/tmux`. Drawer/Popup were withheld because the existing
`startTerminal` API requires a parsed `(project, scope, slug, agent)`
tuple to construct a sessionName — and manual sessions don't have
parseable parts.

The user expected manual rows to be openable in the browser. This
change adds a **raw-attach** path: open ANY existing tmux session in
the drawer / popup just by its sessionName, no parsed-target needed.

## What Changes

### Backend: raw-attach manager API + endpoint

- New `manager.ts` export `attachExistingSession({ sessionName })` that
  reuses the existing `Map<sessionName, Entry>`, port allocator, LRU
  cap, idle TTL, and serializer — only the tmux argv differs:
  `tmux new-session -A -s <sessionName>` (no `-c`, no agent CLI).
  The `-A` flag attaches to the existing session; if the session
  doesn't actually exist on the host, tmux creates a new bare-shell
  session at the host's default cwd. (We don't gate this on
  `tmux has-session` first — existing sessions stay attached, missing
  ones are just freshly created. This matches the user's expectation
  that "the row is on /manage/tmux so I can open it.")
- New `POST /api/terminal/attach` endpoint with body
  `{ sessionName: string }`. Validates the name (must match
  `^memon-[A-Za-z0-9._-]+$`), forwards to `attachExistingSession`,
  returns the same response shape as `POST /api/terminal/start`:
  `{ sessionName, url, port, startedAt, warnings }`.

### Frontend: raw-mode drawer + popup

- `TerminalDrawerProvider` gains an `openRaw({ sessionName })` API
  alongside the existing `open({ project, scope, slug, agent })`. The
  drawer's internal state becomes a discriminated union:
  `{ kind: 'standard', ... } | { kind: 'raw', sessionName }`.
- `TerminalView` props become a discriminated union:
  `{ mode: 'standard', project, scope, slug, agent }` or
  `{ mode: 'raw', sessionName }`. The component branches on `mode` to
  call either `startTerminal(...)` or the new `attachTerminal({ sessionName })`
  client.
- `/terminal-popup` route accepts an alternate query-param shape:
  `?sessionName=<name>` (for raw mode). When present, it takes
  precedence over `project / scope / slug / agent`.
- The drawer header for raw mode shows just the sessionName as the
  title (no agent prefix), since "agent" doesn't apply.
- The `Pop out` button on the drawer header uses the same shape:
  raw drawer pops out to `/terminal-popup?sessionName=<name>`.

### `/manage/tmux`: manual rows regain Drawer + Popup

- Manual rows (matchable=false, staleReason=null) SHALL render
  `Drawer` + `Popup` + `Kill` (where `Popup` keeps the existing
  `hidden md:inline-flex` mobile-hide rule).
- Manual rows' Drawer button calls `drawer.openRaw({ sessionName: row.sessionName })`.
- Manual rows' Popup button opens
  `/terminal-popup?sessionName=<encoded-sessionName>`.
- **Stale rows are unchanged** — `Kill` only. That's the explicit
  decision from `manage-tmux-stale-no-open` and stays.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `browser-terminal`: add `POST /api/terminal/attach` for raw-attach
  by sessionName; the drawer + popup gain a raw-mode branch that
  routes through this endpoint instead of the parsed-target
  `startTerminal` flow.
- `tmux-session-management`: manual rows render the full action set
  (`Drawer` + `Popup` + `Kill`) again. Stale rows stay Kill-only.

## Impact

- `apps/web/lib/terminal/manager.ts` — add `attachExistingSession`.
- `apps/web/app/api/terminal/attach/route.ts` (NEW) — POST endpoint.
- `apps/web/lib/api.ts` — `attachTerminal({ sessionName })` client.
- `apps/web/components/terminal-drawer-provider.tsx` — add `openRaw`
  to the API; widen state to discriminated union; render raw mode.
- `apps/web/components/terminal-view.tsx` — discriminated props.
- `apps/web/app/terminal-popup/page.tsx` — accept `sessionName`
  query param.
- `apps/web/app/terminal-popup/terminal-popup-client.tsx` — pass
  through raw mode.
- `apps/web/app/manage/tmux/tmux-page.client.tsx` — manual rows
  render full action set; wire Drawer/Popup to raw mode.
- `openspec/specs/browser-terminal/spec.md` — modified + added
  requirements.
- `openspec/specs/tmux-session-management/spec.md` — modified
  requirement.
