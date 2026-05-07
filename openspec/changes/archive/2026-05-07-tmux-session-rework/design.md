## Context

After `run-action-bar-rework` landed, the terminal subsystem is:

```
OpenWithButton (per-run)
  └─ TerminalDrawerProvider  ← mounted in /p/[project]/layout.tsx
      └─ <Sheet> + <TerminalView>
          └─ POST /api/terminal/start { runId, projectName, agent }
              └─ manager.ts (single global slot):
                    spawn ttyd → tmux new-session -A -s memon-<agent>-<runId> [agent]
              └─ ttyd binds 127.0.0.1:7682  (single port)
              └─ proxy at apps/web/lib/server-core.ts forwards
                  /api/terminal/proxy/* → http://127.0.0.1:7682  (static target)
```

Three things compound to the pain points listed in the proposal:

1. The single-port, single-slot design means switching `(agent, run)`
   tears down ttyd. The drawer's `closeAndStop` policy on route change
   then takes the tmux down too.
2. The session-name format `memon-<agent>-<runId>` doesn't carry
   project (collisions across projects with same `runId`) or scope
   (no exp-level sessions).
3. There's no UI surface that knows about `memon-*` tmux sessions
   that the running `manager.ts` slot doesn't currently hold — they're
   "ghosts" until the user shells out.

This change replaces all three at once because they're tightly
coupled: a multi-port manager, a richer session-name format, and a
management page that owns the listing/killing UI.

## Goals / Non-Goals

**Goals:**

- Multiple terminal sessions can coexist (drawer for A, popup for B,
  both alive). LRU keeps the count bounded.
- tmux sessions are durable across `memon serve` restart. The user
  can come back to long-running agent work after a server bounce.
- Conversations in `claude` / `codex` / `opencode` auto-resume on
  first open of a `(agent, target)` combo where prior conversation
  exists.
- A management page enumerates every `memon-*` tmux on the host,
  classifies each row as matchable / stale, and supports
  open / kill operations.
- The project-name format becomes safe for inclusion in tmux session
  names and URL paths.

**Non-Goals:**

- Cross-host management. The page only lists sessions on the host
  running `memon serve`. Sessions on other GPU nodes are invisible.
- ttyd version pinning / upgrade UX changes. The ttyd binary self-
  install logic from the existing `browser-terminal` spec is
  unchanged.
- Migrating existing old-format `memon-<agent>-<runId>` tmux sessions
  to the new format. They show up on the management page as stale
  (or "old format") and the user kills them at their convenience.
- A "session manager" inside the drawer. The drawer stays a single-
  session viewer; multi-session inventory is the management page's
  job.

## Decisions

### D1. Session-name format with double-hyphen scope delimiter

Format: `memon-<agent>-<project>--<scope>--<slug>` where
`<scope> ∈ {exp, run}`. Slugs SHALL NOT contain `--`. Parsing:

```
split('--')  →  ['memon-<agent>-<project>', '<scope>', '<slug>']
```

For the first segment, `<agent>` is one of four closed values
(`terminal | claude | codex | opencode`); we strip the
`memon-` prefix, then match the longest known agent prefix to peel
agent off the front, leaving `<project>` as the remainder.

**Why not single-hyphen `memon-<agent>-<project>-<scope>-<slug>`?**
Project names contain hyphens (`project-a`, `sparse-fsdp`), so a
single-hyphen scope delimiter is ambiguous. Run slugs include the
timestamp suffix `<base>-<YYMMDD>-<HHMMSS>` so they also have
hyphens. Reserving `--` as the scope delimiter is the cheapest
unambiguous parse since `--` doesn't naturally appear in either
piece.

**Slug constraint addition.** Run slug = the run dir basename, e.g.
`foo-260507-103000`. Exp slug = the exp doc filename minus `.md`,
e.g. `E0042-bar`. Both naturally avoid `--`. The validator on the
manager-side input rejects slugs containing `--` defensively, with a
clear error.

**Old format migration.** Old sessions named
`memon-<agent>-<runId>` are NOT auto-renamed. They appear on
`/manage/tmux` and are individually killable. The parser tolerates
the old format for listing (recognizes `memon-<agent>-` prefix; if
no `--` is present in the rest, classify as "old format" and treat
as stale).

### D2. Multi-port manager via `Map<sessionName, Entry>`

`manager.ts` swaps the single global slot for:

```ts
type Entry = {
  child: ChildProcess
  port: number
  startedAt: string
  lastActiveAt: number      // updated by proxy on WS open / close
  sessionName: string
  // session metadata
  agent: AgentKind
  project: string
  scope: 'exp' | 'run'
  slug: string
  warnings: string[]
}
const sessions = new Map<string, Entry>()
```

`startSession({ agent, project, scope, slug })`:
1. Compute `sessionName` per D1.
2. If `sessions.has(sessionName)` and child is healthy → return
   existing entry (idempotent).
3. If `sessions.size >= maxConcurrent`, evict via LRU (D4).
4. Allocate the next free port (D2a).
5. Probe resume id (D7).
6. Spawn ttyd; on early exit < 500ms, throw.
7. Insert into map; return public shape.

**Concurrency safety.** A per-sessionName promise chain (replaces the
single `SERIALIZER_KEY`) prevents duplicate ttyd spawns when two
calls race on the same sessionName. The chain is keyed by
sessionName, so different sessionNames proceed in parallel.

#### D2a. Port allocator

Scan from 7682 upward; pick the first port not in `sessions`'
in-use set AND not bound externally (use `node:net` `createServer`
listen-then-close probe to verify). Cap the scan at e.g. 7682 + 256
so we don't loop forever on a misconfigured host. Released ports
go back into the pool but the next allocation prefers an unused
larger port (counter strategy) to reduce the chance of a stale
client hitting a freshly-rebound port.

#### D2b. Proxy refactor (`apps/web/lib/server-core.ts`)

Replace the static `proxyTarget = http://127.0.0.1:7682` with a
sessionName-keyed lookup:

```ts
function resolveTarget(reqUrl: string, sessions: SessionRegistry):
  string | null {
  const m = reqUrl.match(/^\/api\/terminal\/proxy\/([^/]+)\//)
  if (!m) return null
  const entry = sessions.get(decodeURIComponent(m[1]))
  return entry ? `http://127.0.0.1:${entry.port}` : null
}
```

The proxy path (`/api/terminal/proxy/<sessionName>/...`) is also the
ttyd `-b` base path, so ttyd emits asset URLs prefixed with
`/api/terminal/proxy/<sessionName>/static/...` etc. — these route
back through the same lookup automatically.

The proxy also tags the WebSocket upgrade with the sessionName so
that on `ws.open` it bumps `entry.lastActiveAt` and on `ws.close`
it does the same — those timestamps drive the idle-TTL killer.

### D3. ttyd ↔ tmux lifecycle (decoupled)

| Trigger | ttyd | tmux |
|---|---|---|
| First `Open with` | spawn | spawn (`-A`) |
| Same sessionName re-open | reuse | already exists |
| Drawer / popup close (X) | keep | keep |
| `memon serve` restart | all killed (process group) | all preserved (tmux daemon) |
| LRU eviction | kill | preserve |
| Idle TTL expiry | kill | preserve |
| User clicks `Kill` on `/manage/tmux` | kills (cascades, since ttyd's child = tmux client) | kill (`tmux kill-session`) |
| User exits agent / shell from inside ttyd | exits naturally | session ends naturally |
| Route change | keep | keep |

Core invariant: tmux daemon outlives `memon serve` and ttyd. The new
manager assumes nothing about the tmux daemon — only that it's running
on the host (it usually is once any session has ever existed).

### D4. LRU + Idle TTL coexist

**LRU** triggers at `startSession` when `sessions.size >= maxConcurrent`.
The eviction picks the entry with the smallest `lastActiveAt` whose
WebSocket is currently disconnected. (We don't evict entries whose
WS is connected — that would yank the rug from the user.) If all
entries are connected, we fall back to LRU regardless and the user's
oldest tab gets a "Disconnected" iframe; they reload to spawn a new
ttyd from the (still-alive) tmux.

**Idle TTL** is a 1-minute polling loop in manager.ts that walks the
map, computes `now - lastActiveAt` for each entry without a connected
WS client, and kills any whose age > `ttydIdleTtlMinutes`. A value
of `0` disables the killer.

Both kill ttyd only; tmux is untouched. Re-opening the same
sessionName reattaches via `-A`.

### D5. `TerminalDrawerProvider` lifts to root layout

Currently mounted in `apps/web/app/p/[project]/layout.tsx`. Lift to
`apps/web/app/layout.tsx` so it's mounted on every page including
`/manage/tmux`.

**Why root?** The drawer is fundamentally a session viewer, not a
project-scoped concept. Multi-port lets sessions outlive any one
project view; the drawer state should survive cross-project
navigation. Lifting also makes `Open in drawer` from `/manage/tmux`
trivial (no cross-route open-by-querystring dance needed).

**Side effect.** The drawer state persists across `pathname` changes
(was: `closeAndStop` on path change). The user keeps the same
session visible while clicking around. This is the desired UX.

### D6. Promote-to-popup mechanics

The drawer header's `Pop out` button:
1. Reads the current drawer state `{agent, project, scope, slug}`.
2. `window.open('/terminal-popup?agent=...&project=...&scope=...&slug=...',
   target, 'popup,width=1200,height=800')` with `target =
   memon-popup-<sessionName>` (stable so repeat clicks refocus).
3. Calls `drawer.close()`.

The popup's mount calls `startTerminal(...)` which hits manager's
existing entry and returns the same `(sessionName, url, port)`. The
popup iframe loads that URL → connects WebSocket to the same ttyd
that the drawer was using. ttyd accepts the second WS connection,
shares the PTY, cursor is shared (this is ttyd's default with
`--writable`). The drawer's iframe unmounts when its parent
component unmounts, which closes its WS cleanly.

**There is no "transfer".** Both views use the same ttyd entry by
construction.

### D7. Conversation auto-resume probe

On `startSession` for `(claude | codex | opencode, target)`, before
spawning ttyd, the manager probes the CLI's local conversation
storage for a resumable id keyed by the absolute path of the run /
exp directory.

- `claude`: `~/.claude/projects/<encoded-cwd>/` exists and is
  non-empty (jsonl files indicate prior conversations in this cwd).
  Encoding: claude code uses absolute path with `/` → `-` (and other
  special-char rules confirmed at implementation time). When non-
  empty, append `--continue` to the agent argv to resume the most
  recent conversation in that cwd.
- `codex`: invocation form `codex resume --last`. Probe TBD at
  implementation time (likely a similar local store under
  `~/.codex/`); if probe finds something, use the resume form,
  else plain `codex`.
- `opencode`: invocation form via `opencode session ...` is TBD.
  Probe location TBD.

For each CLI, the probe is a synchronous `fs.readdir` (cheap) wrapped
in a try/catch — failures are silently treated as "no resume",
falling back to fresh `<agent>` with no flag.

The agent runs with **cwd set to the target directory** so its
in-process "current directory" matches what claude / codex etc. use
to key their session store. This is achieved by passing `-c <cwd>`
to `tmux new-session`:

- run scope cwd: the run's absolute dir.
- exp scope cwd: the project root (no exp-specific dir; the agent
  has access to the whole project for cross-run exp-level work).

### D8. Management page `/manage/tmux`

Top-level route — first under `/manage/`. Implementation:

- `apps/web/app/manage/tmux/page.tsx` (server component): fetches
  `GET /api/tmux-sessions` (or pre-renders via `getRuntime()` direct
  call for SSR speed) and dehydrates into TanStack Query.
- `apps/web/app/manage/tmux/tmux-page.client.tsx` (client component):
  table + filter tabs + actions.
- TanStack key: `['tmux-sessions']`. Refetch every 5s while page is
  visible (and on focus). Refresh button manually invalidates.
- Actions:
  - `Open in drawer` → calls `useTerminalDrawer().open({agent,
    project, scope, slug})` (drawer is at root, so this works on
    any page).
  - `Open in popup` (hidden below Tailwind `md`) → `window.open` per D6.
  - `Kill` → `DELETE /api/tmux-sessions/<sessionName>` (with
    confirm dialog to avoid accidental clicks); on success
    invalidate `['tmux-sessions']`.

**Filter tabs:** `[All] [Active in memon] [Stale]`. `Active in memon`
means the session has a live ttyd entry (i.e. memon's manager
currently holds a port for it). `Stale` is per D9 below.

### D9. Stale detection

A row is **matchable** if all of:

1. The parsed `<project>` is in `runtime.config.projects` (by name).
2. For `<scope> = run`: the matched project has a run dir whose
   basename equals `<slug>` (existing `discoverRuns` index hit).
3. For `<scope> = exp`: the matched project has an exp doc with id
   `<slug>` (existing `discoverExperiments` index hit).
4. The sessionName parses cleanly (i.e., follows the new
   `memon-<agent>-<project>--<scope>--<slug>` form).

Otherwise the row is **stale**. Sub-reasons (shown in the inline
text) include `unknown-project`, `unknown-target`, `old-format`,
or `unparseable`. Stale rows still allow `Open in drawer` /
`Open in popup` / `Kill` — the operation just doesn't navigate
anywhere on Open.

The check runs server-side on `GET /api/tmux-sessions` so the row is
classified at fetch time. It uses the existing run / exp indexes,
so cost is per-row O(1) hash lookup.

### D10. Project name format constraint

`packages/core/src/schemas.ts` ProjectConfigRawSchema gains
`.regex(/^[A-Za-z0-9-]+$/)` on `name`. `config/load.ts` surfaces a
clear error: `invalid config: projects[i].name must match
[A-Za-z0-9-]+ (got "bad name")`. No first / last char constraint —
intentionally permissive for now (`-foo`, `foo-`, `--` are ugly but
not unsafe under our parser; if they cause real grief later we
tighten the regex).

The constraint is BREAKING for any user with non-conforming names;
the migration is "rename in config.yml". We don't auto-rename.

### D11. tmux argv with `-c` for cwd

```
tmux new-session -A -s <sessionName> -c <cwd> [<agent-cmd> [args]]
```

The `-c` flag sets the new session's first window's start directory.
Reattach via `-A` ignores `-c` (the existing session's cwd is what
it had at create time — that's fine since it was already set
correctly).

### D12. Server-restart resume

After `memon serve` restarts:

- All ttyd entries are gone (process group died).
- All tmux sessions on host are still alive.
- `manager.ts.sessions` map is empty.
- User clicks `Open with claude` for run-A → manager has no entry,
  spawns a fresh ttyd, runs `tmux new-session -A -s <name> ...`
  → `-A` reattaches to the existing session → user sees prior
  scrollback + agent in its prior state (claude is still running
  inside the session if it hadn't exited).

This is exactly the durability the user wants. No special "restore
state on boot" logic is needed.

## Risks / Trade-offs

- **[Risk]** Port range exhaustion if user's host has many other
  services in 7682–7937 → **Mitigation**: LRU cap (default 16) keeps
  active ttyds bounded; allocator probes for free ports rather than
  blindly counting; on cap-hit the scan fails fast and surfaces a
  clear error.

- **[Risk]** Stale detection has false positives when project is
  temporarily commented out of `config.yml`; user might then bulk-
  kill via UI (we don't add a bulk button initially though) →
  **Mitigation**: stale is informational; ops always work; user
  re-enables the project and the same row becomes matchable again
  on next refresh.

- **[Risk]** Auto-resume CLI compatibility — the resume mechanic for
  codex / opencode is researched at implementation time and may
  differ from claude. → **Mitigation**: per-CLI probe is best-effort
  in a try/catch; on failure we fall back to fresh agent. If a CLI
  changes its storage layout in a future version, the worst case is
  resume stops working silently and the user sees fresh sessions;
  no data loss.

- **[Risk]** Breaking session-name change — old `memon-<agent>-<runId>`
  tmux sessions still on host don't match the new manager's dedup
  → **Mitigation**: parser tolerates both formats for listing
  (old-format rows show on `/manage/tmux` as stale "old format");
  user can `Kill` them at their convenience.

- **[Risk]** Drawer lift to root means provider state survives across
  `/p/<project>/`-scoped concerns (TanStack hydration, project
  permissions); could leak project-A's session into a `/p/<project-B>/`
  view → **Mitigation**: the drawer is a session viewer keyed by
  sessionName, which already encodes `<project>`; the user sees the
  session for whatever they last clicked Open on. If that's
  project-A while they're on a project-B page, that's fine — it's
  one session, the user opened it deliberately.

- **[Risk]** Two browser windows pointing at the same sessionName
  share cursor → **Mitigation**: this is the documented UX (D6); the
  invariant "same tmux ↔ same ttyd ↔ shared cursor" matches the
  user's mental model.

- **[Risk]** ttyd's WebSocket close event fires asynchronously; idle
  TTL might evict an entry the user is about to click on →
  **Mitigation**: 30-min default leaves a wide margin; user always
  recovers by re-clicking Open (which reattaches to the live tmux).

## Migration Plan

Code-only edit. No on-disk schema bump (this is web/runtime, not
the v3 fs convention).

1. Land the change behind no flag — implementation lands all-or-
   nothing.
2. The first `memon serve` startup after upgrade reads `config.yml`
   with the new project-name regex; non-conforming users get a
   clear error and rename their projects.
3. On user's first `Open with` post-upgrade, manager spawns a new
   tmux session with the new naming. Old sessions remain visible
   on `/manage/tmux` as stale ("old format"). User can kill them.

Rollback: revert the change. Old single-port flow comes back. New
sessions from the time the new code ran will outlive the rollback
on the host as `memon-<agent>-<project>--<scope>--<slug>` tmux
sessions; they're inert under the old code (don't match the old
naming) and need manual `tmux kill-session` to clean up. The user
can do this.

## Open Questions

1. **Codex / OpenCode resume mechanics.** Specific resume command
   form and storage path TBD at implementation time. Plan: research
   each CLI's `--help`, source, or docs; if a probe is unreliable,
   default to fresh start without resume (no loss compared to
   today's behavior).
2. **Should `/api/tmux-sessions` use SSE for live updates instead
   of poll?** Decision deferred — start with 5s poll; add SSE later
   if the user finds the lag annoying.
3. **Should `Open in drawer` from `/manage/tmux` ALSO navigate to
   the matched run/exp page (when matchable), or stay on `/manage/tmux`?**
   Default per current design: stays on `/manage/tmux`; the user
   clicks the Target column link separately if they want to jump.
   Revisit after the user lives with it.
