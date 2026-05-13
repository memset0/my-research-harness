## Why

The dashboard can show that a `memon-*` tmux session **exists** and that
a ttyd is bound to it, but it cannot show **what's actually running
inside** the session. The user wants to glance at `/manage/tmux` (or
later, the experiment / run / project header) and see at a glance:

- Is Claude Code running in this session, or did it exit back to a
  bare shell?
- If Claude Code is running, what does its current PTY-protocol window
  title say about its state (idle prompt, processing a tool, waiting
  for permission, etc.)?
- Did the user `cd` somewhere different from where the session was
  spawned?

All of this is already on tmux's side — `#{pane_title}` is the
xterm-OSC title set by the program currently in the pane (Claude Code,
shells with `PROMPT_COMMAND`, etc.), `#{pane_current_command}` is the
basename of the foreground process, and `#{pane_current_path}` is the
process' cwd. We simply need to plumb it from `tmux list-panes` into
the existing `GET /api/tmux-sessions` response and render it on the
session cards.

The reason to do this now: the user just started shipping `memon-*`
sessions hosting long-running agent loops (Claude Code, codex, etc.).
Without pane info, the only way to tell whether a session is "alive
with work" vs "an empty shell idling" is to click into it. That's a
real friction point for a user managing 5-20 sessions.

## What Changes

### Backend: expose pane info from tmux

- `apps/web/lib/terminal/tmux-discover.ts` SHALL extend
  `listMemonTmuxSessions` to enrich each `TmuxSessionRow` with a new
  `pane` field carrying the active pane's `title`, `currentCommand`,
  and `currentPath` (or `null` if the lookup failed). Data is sourced
  from one extra `tmux list-panes -a -F …` shell-out per refresh.
- A short in-process cache (default 800 ms) SHALL deduplicate the
  shell-out across simultaneous callers in the same tick (e.g. the
  /manage/tmux poll + a tab opened on a separate sessionName-lookup
  endpoint hitting the same Node process). Cache TTL is a constant in
  source.
- A new `GET /api/tmux-sessions/:name` endpoint SHALL return a single
  enriched row by sessionName (using the same cache). This lets
  per-target indicators on the experiment / run / project page poll
  one row without fetching the whole inventory.

### Frontend: surface in /manage/tmux

- Each session card on `/manage/tmux` SHALL render a thin **pane line**
  underneath the existing badge row, showing:
  - A small `Activity` lucide icon.
  - `pane.currentCommand` in monospace (e.g. `claude`, `node`, `bash`).
    Hidden when `pane.currentCommand === null` or matches a small
    deny-list of "uninformative shell" basenames (`bash`, `zsh`, `sh`,
    `fish`, `tmux`) UNLESS no title is available — in that case render
    the basename so the row isn't blank.
  - `pane.title` truncated to the available width, with the full value
    in the row's `title` (tooltip). Hidden when `pane.title === null`
    or equals the bare hostname (tmux's default when no program has
    set a title).
- The right-pane header on `/manage/tmux` (the slim bar showing the
  selected sessionName + `Pop out`) SHALL append the same
  `command · title` suffix when pane info is present.
- A new "Claude Code state hint" derived field is **out of scope** for
  this change. The raw `currentCommand` + `title` are enough for the
  user to read state at a glance. Later changes can layer specific
  parsing on top.

### Polling balance + config

- Pane info applies to **every** `memon-*` tmux session on the host,
  whether or not a ttyd is bound. `tmux list-panes -a` enumerates
  all of them — non-active sessions are first-class.
- `/manage/tmux` already polls `GET /api/tmux-sessions` every 5 s.
  Extending the existing payload is free (no new poll). The 800 ms
  server-side cache absorbs accidental sub-second poll storms.
- The new single-row endpoint exists for **future use** by the
  `OpenWithButton` (run / exp / project header). The recommended
  cadence for that future surface is **tiered**: 5 s when the named
  session has a live ttyd (user is engaged), 60 s when it does not
  (title rarely changes without user input).
- The two tiers SHALL be configurable via the existing `terminal:`
  block in `config.yml`:
  - `pane_info_active_poll_ms` (default `5000`)
  - `pane_info_idle_poll_ms` (default `60000`, must be `>=` active)
  - When the block (or any field) is absent, the defaults above
    apply. `config.example.yml` SHALL document both fields with their
    defaults so users can copy-uncomment-edit without consulting
    source.
- Concretely: this proposal **adds the config plumbing now** (schema
  + types + load.ts + example YAML), but does NOT yet consume the
  values in client code. Consumption is for the next change once the
  per-button indicator UI lands.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `tmux-session-management`: `TmuxSessionRow` gains a `pane` field;
  `GET /api/tmux-sessions` populates it; a new `GET
  /api/tmux-sessions/:name` returns one enriched row; the
  `/manage/tmux` cards and right-pane header render the new field.
- `browser-terminal`: the existing `terminal:` config block gains two
  new fields (`pane_info_active_poll_ms`, `pane_info_idle_poll_ms`)
  with documented defaults and a load-time `idle >= active` check.

## Impact

- **Code touched**: `apps/web/lib/terminal/tmux-discover.ts`,
  `apps/web/app/api/tmux-sessions/route.ts`,
  `apps/web/app/api/tmux-sessions/[name]/route.ts` (existing — adds
  `GET`), `apps/web/lib/api.ts`,
  `apps/web/app/manage/tmux/tmux-page.client.tsx`,
  `packages/core/src/schemas.ts`, `packages/core/src/types.ts`,
  `packages/core/src/config/load.ts`, `config.example.yml`,
  `config.yml`.
- **No new deps**. `tmux list-panes` is already required by the v3
  spec.
- **No new auth surface**. The new `GET` route inherits the existing
  `shell`-class classification of `/api/tmux-sessions/**` (owner-only;
  viewer share cookies are not decoded). See
  `apps/web/lib/auth/route-classes.ts:237`.
- **Performance**: one extra `tmux list-panes -a -F …` call (≈1 ms on
  a host with <50 sessions) per 5 s poll, deduplicated across callers
  by the 800 ms cache. Negligible.
- **Bounded data**: `pane.title` SHALL be truncated to 256 chars at
  the server side. Defensive — agents that set very long titles won't
  bloat the API response.
