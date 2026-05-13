## Context

`/manage/tmux` currently shows one card per `memon-*` tmux session on
the host, populated from `GET /api/tmux-sessions`. The backing data
comes from a single `tmux ls -F '#{session_name}|#{session_created}|#{session_activity}'`
shell-out (see `apps/web/lib/terminal/tmux-discover.ts:37`). For each
row we surface:

- the parsed `(agent, project, scope, slug)` from the session name,
- whether a live ttyd is bound (port from the manager's in-memory map),
- created / last-activity timestamps,
- a `matchable` / `staleReason` classification.

What's missing is what's actually running INSIDE the session. tmux
knows: every pane has `pane_title` (the OSC-set window title from the
program), `pane_current_command` (basename of the foreground process),
and `pane_current_path` (cwd of that process). These are exposed via
`tmux list-panes -F` (or `display-message -p -F` for a single target).

The user's primary use case: managing a fleet of `memon-claude-*`
sessions where each session hosts a Claude Code instance. Claude Code
sets a distinctive PTY title; bare shells don't. Surfacing the title
lets the user see "this one is in tool-permission prompt" vs "this one
exited back to bash" without clicking in.

## Goals / Non-Goals

**Goals:**

- Surface `pane_title`, `pane_current_command`, `pane_current_path` to
  the frontend for every `memon-*` session on the host.
- Render the info on `/manage/tmux` so it's visible at a glance.
- Keep the shell-out cost bounded under concurrent polls via a tiny
  in-process cache.
- Provide a per-session lookup endpoint so future per-page indicators
  (e.g. on the experiment-page `OpenWithButton`) can poll a single
  row instead of the whole inventory.

**Non-Goals:**

- Parsing Claude Code's title for specific states ("idle" vs "tool
  prompt" vs "processing"). The raw title is exposed; consumers can
  pattern-match later. Title formats change across Claude Code
  versions and we don't want a contract tied to that.
- Pushing pane updates via SSE. tmux doesn't emit pane-state events;
  any "push" path would still be a server-side poll. Polling on the
  client at the existing 5 s cadence is fine.
- Wiring the new single-row endpoint into `OpenWithButton` UI. That's
  a follow-up change; this proposal just lays the API.
- Multi-pane sessions: tmux sessions can have multiple windows /
  panes. We only surface the **active pane of the active window**
  (`window_active=1 AND pane_active=1`). Multi-pane intents (split-
  view monitoring) are out of scope.

## Decisions

### D1. Use `tmux list-panes -a -F …` once per refresh, not per-row `display-message`

**Decision**: Shell out to `tmux list-panes -a -F` once and parse
every line, then build a `Map<sessionName, PaneInfo>`. Merge into the
`TmuxSessionRow[]` returned by `listMemonTmuxSessions`.

**Alternative considered**: `tmux display-message -p -t <name> -F …`
per session. Rejected because each fork costs ~1 ms; with 20 sessions
that's 20 ms wall time even before deserialization. The bulk
`list-panes -a` is a single fork (~1-2 ms regardless of session count)
and tmux returns pane data for ALL sessions in one stdout stream.

### D2. Filter to active pane of active window per session

**Decision**: Include `#{window_active}|#{pane_active}` in the format
string; keep only rows where both are `1`. That maps 1:1 to "what the
user sees if they `tmux attach` to the session right now".

**Alternative considered**: Include the first pane regardless. Rejected
because a user might have a multi-window session where window 0 is
idle and the working window is 1 — the active markers give us the
right one.

### D3. Format string

```
#{session_name}|#{window_active}|#{pane_active}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}|#{pane_title}
```

`pane_pid` is included for future debugging (correlates with `ps`
output during incident investigation). It's optional — strip from the
client response shape to keep the public API surface small.

Title contains arbitrary characters (including the pipe `|` if a
program sets `\e]2;a|b\a` as its title). We mitigate by:

1. Placing `pane_title` **last** in the format string, so split-on-`|`
   yields N-1 splits plus one tail.
2. Rejoining all splits past position 6 with `|` to reconstruct the
   title verbatim.

### D4. Server-side 800 ms cache

**Decision**: Cache the `tmux list-panes -a` result in a module-local
`{ at: number; rows: Map<sessionName, PaneInfo> } | null` slot, valid
for 800 ms. Any call to the enrichment helper within that window
returns the cached map.

**Why 800 ms specifically**:

- Page polls every 5 s; cache rarely hits cross-poll on a single
  client.
- BUT: when the new `GET /api/tmux-sessions/:name` is wired up later
  alongside the inventory poll, multiple buttons on a page can fire
  simultaneously after a navigation. 800 ms ensures the first call
  primes and the rest read from cache (cache TTL > the typical
  intra-render burst latency).
- 800 ms < 1 s so a poll-once-per-second test loop still sees fresh
  data on the second tick.

The cache slot is pinned on `globalThis.__memonTmuxPaneCache` (mirrors
the existing pattern in `manager.ts`'s `getState()`) so Next.js HMR
doesn't drop it.

### D5. Pane title truncation at the server, 256 chars

**Decision**: Truncate `pane.title` to 256 chars (with a `…` suffix
when truncated) before serializing.

**Why**: defensive. Programs setting their PTY title from
user-controlled input (filename, message, etc.) can produce
multi-kilobyte titles. We don't want a misbehaving agent to bloat
every poll response. 256 chars is plenty for the user to read at a
glance; the full string lives only in tmux and is recoverable via
`tmux attach`.

### D6. Frontend rendering: thin sub-line below the badge row

```
┌─────────────────────────────────────────────┐
│ claude-project-a--run--foo-... [Pop][Kill]  │
│ 5m ago [:7683] [Agent claude] [Run foo-...] │
│ ⟳ claude · ✻ Building digest…              │  ← new line
└─────────────────────────────────────────────┘
```

The pane line sits on its own row below the existing badge row, in
muted text. Layout:

- A leading `Activity` icon (`size-3`, muted color).
- `pane.currentCommand` in `font-mono text-[10px]`. Suppressed when
  null OR matches the "uninformative shell" deny-list
  (`bash | zsh | sh | fish | tmux`) AND the title is also present —
  the deny-list keeps the line from saying "bash" for every idle
  shell.
- A separator `·` (with horizontal padding).
- `pane.title` truncated to fit. The full untruncated title is the
  `title` attribute (browser tooltip) for the row.

Special cases:

- Both null → render nothing (no empty line, no icon).
- Only command, no title → render `<icon> <command>`.
- Only title, no command → render `<icon> <title>`. Unlikely in
  practice but defensive.

### D7. Right-pane header gets the same suffix

The existing header bar on `/manage/tmux`'s right pane shows
`<sessionName> ………… [Pop out]`. We append `· <command> · <title>` to
the right of the sessionName so the user keeps seeing live pane info
even after a selection.

### D8. Per-session endpoint shape

```
GET /api/tmux-sessions/:name
→ 200 { row: TmuxSessionRow }
→ 404 { error: { code: 'NOT_FOUND', message } } when no memon-*
  session by that name exists on the host
→ 400 when :name doesn't match `^memon-[A-Za-z0-9._-]+$`
```

Reuses the same enrichment helper and cache. Auth: `shell` class —
owner-only, matching the existing `startsWith('/api/tmux-sessions')`
rule in `apps/web/lib/auth/route-classes.ts:237`. Viewer share
cookies are not decoded for this prefix; viewer requests fall through
to 401.

Note: this endpoint shares the path `/api/tmux-sessions/:name` with
the existing `DELETE /api/tmux-sessions/:name` handler (defined in
`apps/web/app/api/tmux-sessions/[name]/route.ts`). The two HTTP verbs
cohabit fine — we add a `GET` export alongside `DELETE`.

### D9. Non-active sessions are first-class, polled at a slower tier

The pane enrichment treats "active" (ttyd-bound) and "non-active"
(tmux session exists on the host but no ttyd is bound) sessions
identically — the data source is `tmux list-panes -a`, not the ttyd
manager. Every `memon-*` tmux session contributes one row to the
output regardless of `liveEntry` state. The user's intuition holds:
"they're all local tmux sessions; we should support them all".

What differs is the **recommended polling cadence per surface**. The
spec keeps `/manage/tmux` at the existing unified 5 s (the user is
actively staring at the page; cost is bounded by the 800 ms cache).
The future per-button surface — `OpenWithButton` on run / exp /
project pages, hitting `GET /api/tmux-sessions/:name` — SHALL use a
tiered cadence:

| State of the named sessionName | Recommended poll interval | Config field |
|---|---|---|
| Has live ttyd entry (`liveEntry !== null`) | `5000` ms | `terminal.pane_info_active_poll_ms` |
| Tmux session exists, no ttyd bound | `60000` ms | `terminal.pane_info_idle_poll_ms` |
| No tmux session yet (404) | `60000` ms | `terminal.pane_info_idle_poll_ms` (same as above — both "not active" cases share the idle tier) |

Rationale for the cold-tier default (60 s):

- A non-active session is by definition something the user isn't
  currently watching through ttyd. If the title changes, they'll see
  it on the next minute-boundary; that's acceptable latency.
- 60 s × N buttons on a page is still fine: the 800 ms server-side
  cache means one fan-out poll across many buttons collapses to a
  single shell-out.
- Network cost: ~200 B per row × 60 s = ~3.3 B/s steady-state per
  visible button. Trivial.

**Config wiring (this change)**:

- `packages/core/src/schemas.ts` — `TerminalConfigRawSchema` gains
  `pane_info_active_poll_ms` and `pane_info_idle_poll_ms`, both
  optional positive integers.
- `packages/core/src/types.ts` — `TerminalConfig` gains
  `paneInfoActivePollMs: number` and `paneInfoIdlePollMs: number`;
  `DEFAULT_TERMINAL` exports `5000` / `60000`.
- `packages/core/src/config/load.ts` — applies defaults; throws
  `ConfigError` if `paneInfoIdlePollMs < paneInfoActivePollMs` (the
  tier ordering is load-bearing for the future per-button surface).
- `config.example.yml` — extended with a commented `terminal:`
  example listing every field (including the existing
  `ttyd_max_concurrent` and `ttyd_idle_ttl_minutes` if they aren't
  already documented inline) with their default values.
- `config.yml` (user-local, gitignored) — mirrors the example: append
  a commented `terminal:` block documenting all four fields with
  defaults. The user can uncomment any line to override.

**Consumer (future change)**: the tiered cadence is client-side
advisory. The server endpoint serves identical responses regardless
of cadence — it's the React-Query (or equivalent) `refetchInterval`
that switches between the two tiers based on the row's `liveEntry`
state at the previous tick. The client reads the config values via
the same path other client-facing terminal values flow today
(server-rendered initial props or a small `GET /api/terminal/check`-
adjacent endpoint; final wiring deferred to the consuming change).
When the row transitions from no-ttyd to has-ttyd (e.g. user clicks
`Open with Claude`), the next render reads `liveEntry !== null` and
switches to the active interval.

This change is intentionally **server-side only** for the polling
config — wiring it into client code happens in the next change that
ships the per-button indicator. Persisting the config now ensures the
defaults are stable and the consuming change doesn't have to also
edit the schema.

## Risks / Trade-offs

- **[Title containing `|`]** → Mitigated by D3 (pane_title as last
  format field + rejoin-tail parsing).
- **[Title containing newlines]** → tmux strips embedded newlines from
  pane_title by default (per tmux docs: only printable UTF-8). If we
  see one anyway, we replace `\n` → ` ` at the server side. The format
  separator we choose (`|`) is per-LINE; tmux outputs one line per
  pane in `list-panes -F`.
- **[Cache staleness up to 800 ms]** → Acceptable. The user's
  perception of "the session went idle" doesn't change on sub-second
  scales.
- **[Title leaks user-set strings]** → Anyone with read access to the
  dashboard already sees the project layout and run dirs; the title
  doesn't add a new disclosure boundary. Plus the title comes from
  programs the user themselves runs.
- **[tmux not on PATH or daemon down]** → `listMemonTmuxSessions`
  already returns `[]` in that case. Enrichment helper SHALL likewise
  return `null` pane info and never throw.
- **[Sessions with no active pane visible]** → Skipped (no row in the
  pane map). The TmuxSessionRow falls back to `pane: null`. The UI
  renders nothing for the pane line, which is correct.
- **[Future per-button polling cost]** → Out of scope for this
  proposal, but the design accommodates it: 800 ms cache + per-row
  endpoint means even N concurrent buttons polling every 10 s cost
  one shell-out per ~5 s in the worst case.

## Open Questions

- Should the deny-list of "uninformative shell" basenames be
  configurable? Default `[bash, zsh, sh, fish, tmux]` is fine for now;
  if a user wants `node` suppressed (because they only care about
  agent state, not the language runtime), we can add a config knob
  later. Not adding now to keep scope tight.
- Should the pane line show `pane.currentPath` when it differs from
  the session's spawn cwd? Useful but adds complexity (we'd need to
  remember the spawn cwd per sessionName, which the manager doesn't
  currently track for raw-attached sessions). Deferred.
