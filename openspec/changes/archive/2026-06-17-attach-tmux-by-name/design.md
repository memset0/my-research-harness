## Context

Two recent changes set the stage:
- `create-manual-tmux-session` introduced the manual category and a
  `New session` button on `/manage/tmux`. Manual rows shipped with
  only `Kill` because there was no API path to open a session by
  sessionName alone.
- `manage-tmux-stale-no-open` made stale rows Kill-only as a
  deliberate UX choice (opening unmatched sessions surfaced confusing
  fallback warnings).

This change adds the missing API layer so manual rows can open in
the drawer / popup. Stale rows are explicitly out of scope.

## Goals / Non-Goals

**Goals:**
- Open ANY existing `memon-*` tmux session in the drawer/popup just
  by sessionName (no parsed-target required).
- Reuse 100% of the existing manager machinery (Map, port allocator,
  LRU, idle TTL, ttyd spawn, exit handlers). Only the tmux argv tail
  differs.
- Manual rows on `/manage/tmux` regain `Drawer` + `Popup` actions.

**Non-Goals:**
- Re-enable Drawer/Popup on stale rows. Different UX decision; stays
  Kill-only.
- Conversation auto-resume on raw-attach. There's no way to pick the
  right CLI without parsed-target metadata; manual sessions are
  bare-shell anyway. (The drawer iframe still shows whatever's
  running inside the tmux — including a CLI the user started
  manually — but the manager does not re-launch one.)
- Make raw-attach work for sessions whose name does NOT start with
  `memon-`. Out of scope for this management page.

## Decisions

### D1. New endpoint `POST /api/terminal/attach`, separate from `/start`

Two endpoints over one discriminated body:
- Cleaner type ergonomics (each endpoint has one body shape).
- Less risk of breaking the existing `/start` callers.
- The handlers' resolution logic is genuinely different (`/start`
  builds a sessionName from parts and resolves cwd; `/attach` takes
  the sessionName as-is and uses no cwd).

Body: `{ sessionName: z.string().regex(/^memon-[A-Za-z0-9._-]+$/) }`.
Response: same shape as `/start` (`{ sessionName, url, port, startedAt, warnings }`).

### D2. tmux argv: `tmux new-session -A -s <sessionName>`

- `-A`: attach if exists, else create.
- No `-d`: ttyd spawns this as its child; it's a real client (xterm
  via ttyd's PTY).
- No `-c`: existing session has its own cwd. If the session doesn't
  exist (and `-A` falls through to creating it), tmux uses the
  caller's cwd, which is `process.cwd()` of memon serve — a sensible
  fallback.
- No agent CLI tail: the manual session is whatever shell or process
  is already running inside; the manager doesn't impose one.

This is intentionally simpler than `startSession`'s tmux argv —
no resume probe, no cwd resolution, no agent injection.

### D3. Manager API: `attachExistingSession({ sessionName, maxConcurrent, idleTtlMinutes })`

Mirrors `startSession`'s signature (LRU/TTL knobs come from runtime
config), but takes a flat sessionName instead of `(agent, project, scope, slug)`.

Implementation reuses:
- The `state.sessions` Map (one entry per sessionName, regardless of
  whether the entry was made by `start` or `attach`).
- The `state.startChains` per-sessionName promise serializer (so
  concurrent `attach({ sessionName: 'X' })` and
  `start({ ... → 'X' })` calls don't double-spawn).
- `allocatePort`, `evictOnce`, `ensureIdleTimer`, `registerExitHandlers`.
- `killChild`, `toPublic`.

The Entry shape stays the same; for raw-attach entries, we synthesize
the `agent` / `project` / `scope` / `slug` fields by calling
`parseSessionName(sessionName)` (returns nulls for unparseable). This
keeps the response shape compatible with `/api/terminal/list`.

If parse returns no agent at all, we set `agent = 'none'` as a
sentinel in the entry (since the Entry type's `agent: AgentKind` is
non-nullable). The `project / scope / slug` remain whatever
`parseSessionName` returned (potentially nulls). The /list endpoint
already returns these as nullable in some sense (via the parse
result), so this is consistent.

### D4. Discriminated Drawer state + TerminalView props

DrawerState changes:
```ts
type DrawerState =
  | { kind: 'standard'; project; scope; slug; agent; sessionName: string | null }
  | { kind: 'raw'; sessionName: string }
```

API adds:
- `open(input: { project, scope, slug, agent })` — unchanged
- `openRaw(input: { sessionName })` — NEW
- `close()` — unchanged
- (`Pop out` button now checks `state.kind` and constructs the popup
  URL accordingly)

TerminalView props become a discriminated union, branching on
`mode: 'standard' | 'raw'`. The effect:
- `mode: 'standard'` → calls `startTerminal({ project, scope, slug, agent })`
- `mode: 'raw'` → calls `attachTerminal({ sessionName })`

Both paths produce `{ sessionName, url, ... }`; the iframe URL is the
same, only the API path differs.

### D5. Popup query-param dispatch

`/terminal-popup`'s `searchParams` accepts EITHER:
- `?project=...&scope=...&slug=...&agent=...` (standard) OR
- `?sessionName=...` (raw)

When `sessionName` is present, the page renders raw mode. Otherwise it
falls back to the standard mode. Backwards compatible.

The `Pop out` button on the drawer constructs the URL based on the
current drawer state's `kind`. The "Open in popup" action on
`/manage/tmux` rows uses raw mode for manual rows.

### D6. Manual row actions: Drawer + Popup + Kill

In `tmux-page.client.tsx`:
```
matchable    → Drawer (standard) + Popup (standard) + Kill   [unchanged]
stale        → Kill                                          [unchanged]
manual       → Drawer (raw) + Popup (raw) + Kill             [NEW: was Kill only]
```

Where the Drawer/Popup buttons for manual rows call the raw entry
points instead of the standard ones.

## Risks / Trade-offs

- [Risk] If someone calls `/api/terminal/attach { sessionName: '<X>' }`
  for a name that doesn't exist on the host, tmux creates a fresh
  session at memon's cwd. The user might expect 404. → **Mitigation**:
  this is the `-A` semantic; consistent with the New session dialog
  which is also idempotent. The /manage/tmux UI only ever calls
  `/attach` from a row that currently exists in the listing.
- [Risk] Concurrent `start({ → 'X' })` and `attach({ sessionName: 'X' })`
  could race. → **Mitigation**: the per-sessionName serializer in
  manager.ts already covers it; both code paths key on the same
  sessionName.
- [Risk] Raw-mode entries' `Entry.agent = 'none'` sentinel could
  surprise a future caller of `listSessions()` who reads `agent`. →
  **Mitigation**: the field's existing semantics for raw entries
  match the actual ttyd-attached-shell behavior (no agent CLI was
  spawned). Documented in code; no code outside tests reads this
  flag conditionally.
