## Why

After `run-action-bar-rework` landed, the terminal subsystem still has
five pain points compounded together:

1. **Single-port ttyd** — switching between any two `(agent, run)` combos
   kills + respawns ttyd. Drawer-for-A + popup-for-B can't coexist;
   each switch eats the previous ttyd and respawns.
2. **No exp-level terminal** — `Open with` is run-only. Exp doc detail
   pages have no terminal affordance.
3. **No conversation resume** — every fresh `claude` / `codex` /
   `opencode` start is from scratch, even when a resumable conversation
   exists in the CLI's local storage.
4. **Restart-fragile** — the existing `closeAndStop` on route change /
   drawer close, plus `memon serve` restart killing all ttyds, tear
   down tmux too. Long-running agent state evaporates on every restart.
5. **Sessions invisible** — `memon-*` tmux sessions accumulate on the
   host with no UI to see or clean them up; the user must shell out
   to `tmux ls` and `tmux kill-session`.

This rework makes tmux durable (only user-explicit kill ends it),
multi-ports the ttyd layer, adds exp scope, auto-resumes conversations,
and exposes a machine-level management page.

## What Changes

### Naming convention (BREAKING)

- Session name format: `memon-<agent>-<project>--<scope>--<slug>` where
  `<scope> ∈ {exp, run}`. The double-hyphen pairs are reserved as the
  scope delimiter; slugs SHALL NOT contain `--`. Old format
  `memon-<agent>-<runId>` is retired.
- Existing tmux sessions in the old format SHALL NOT be auto-migrated.
  The user lists and kills them via the new management page.

### Project name validation (BREAKING)

- Config schema SHALL constrain `projects[].name` to `^[A-Za-z0-9-]+$`.
  Existing example names (`project-a`, `project-b`, `sparse-fsdp`)
  comply. The constraint is necessary because project names are
  embedded in tmux session names (above) and in URL paths.

### Multi-port ttyd architecture

- `manager.ts` becomes `Map<sessionName, { child, port, lastActiveAt }>`
  keyed by sessionName.
- Port allocator scans from 7682 upward and assigns the first free port.
- LRU eviction at `terminal.ttyd_max_concurrent` (default 16).
- Idle TTL (`terminal.ttyd_idle_ttl_minutes`, default 30; 0 disables)
  kills ttyd whose WebSocket has had zero connected clients for that
  duration. Both LRU and TTL kill ONLY ttyd; tmux is preserved.
- `apps/web/lib/server-core.ts` proxy resolves `<sessionName>` from the
  URL prefix and looks up the port from the manager; the static
  `http://127.0.0.1:7682` target is replaced by per-request lookup.

### tmux durability

- A tmux session ends only when (a) the user explicitly clicks `Kill`
  on the management page, or (b) the user exits the agent / shell from
  inside a connected ttyd (the session ends naturally when its last
  window exits — default tmux behavior, no special wiring required).
- `memon serve` restart no longer affects tmux state. Reopening the
  same `(agent, project, scope, target)` after restart spawns a fresh
  ttyd that reattaches via `tmux new-session -A` and shows the prior
  scrollback + agent state.

### Conversation auto-resume

- On the FIRST `startSession` for a `(claude | codex | opencode, target)`
  combo (i.e. when no matching tmux session exists yet), the manager
  probes the CLI's local conversation storage for a resumable id keyed
  by the run / exp directory. When found, it appends `--resume <id>`
  to the agent argv before tmux spawns it.
- `terminal` (`none`) has no conversation concept and is unaffected.

### Drawer changes

- `TerminalDrawerProvider` is lifted from `apps/web/app/p/[project]/layout.tsx`
  to `apps/web/app/layout.tsx` (root). The drawer is reachable from
  every page including `/manage/tmux`.
- Drawer header: `[X]` (hide only — does NOT touch ttyd or tmux) and a
  new `[Pop out]` button that opens the same session in a popup window
  via `/terminal-popup?...`, then closes the drawer. Both views share
  the same ttyd thanks to the singleton `Map<sessionName, port>` dedup.
  The previous `[Close + stop session]` button is removed (the
  management page is the only path that kills tmux).
- Route change no longer calls `closeAndStop`; ttyd, tmux, and drawer
  state all persist across navigation.

### Management page `/manage/tmux`

- Top-level cross-project route — first page under `/manage/`. Future
  machine-level management pages can sit alongside.
- Lists every `memon-*` tmux session on the host via `tmux ls`. The
  page sees sessions across all projects and even sessions whose
  project / target cannot be matched in the current config.
- Per-row columns: full session name; parsed `(agent, scope, project,
  slug)`; ttyd port (or `—` if no live ttyd is bound); last activity
  (`tmux ls`'s `#{session_activity}`); a Target cell that is either a
  link to the matched `/p/<project>/r/<slug>` or `/p/<project>/e/<E-id>`,
  or an inline `⚠ stale (...)` indicator when the project / slug
  cannot be matched; actions `[Open in drawer] [Open in popup] [Kill]`.
- `Open in popup` is hidden on viewports below the Tailwind `md`
  breakpoint (mobile browsers don't honor popup chrome).
- `Open in drawer` works on every row including stale ones, because
  the drawer is mounted at the root layout and is reachable from
  `/manage/tmux` itself.
- Filter tabs `[All] [Active in memon] [Stale]`; default is `All`.
- API endpoints: `GET /api/tmux-sessions` (list with stale
  classification) and `DELETE /api/tmux-sessions/:name` (kill via
  `tmux kill-session -t <name>`). Both gated by HTTP Basic auth.

### Sidebar entry

- `apps/web/components/app-sidebar.tsx` gains a `<SidebarFooter>` with
  a single `SidebarMenuButton` linking to `/manage/tmux` (icon
  `Terminal`, label "Manage tmux"). The footer scaffolds future
  `/manage/<other>` entries.

### Config additions

```yaml
terminal:
  ttyd_max_concurrent: 16     # LRU evicts beyond this; default 16
  ttyd_idle_ttl_minutes: 30   # 0 disables; default 30
```

Both fields and the whole `terminal:` block are optional. The defaults
apply when absent.

## Capabilities

### New Capabilities
- `tmux-session-management`: machine-level inventory and lifecycle UI
  for `memon-*` tmux sessions — listing, classifying (matchable vs.
  stale), navigating to the corresponding run / exp page, and killing.

### Modified Capabilities
- `browser-terminal`: new naming convention with project + scope + `--`
  delimiters; multi-port ttyd; LRU + Idle TTL ttyd lifecycle; tmux
  durability across `memon serve` restart; conversation auto-resume
  for claude/codex/opencode; project-name format constraint; drawer
  header changes (`Pop out` replaces `Close + stop`); route change no
  longer kills; `TerminalDrawerProvider` lifts to root layout; popup
  mode receives a sessionName-derived target identifier.
- `web-layout`: `AppSidebar` gains a footer with the management-page
  link.

## Impact

- `apps/web/lib/terminal/manager.ts` — singleton → Map; port allocator;
  LRU; idle TTL; conversation resume probe; new sessionName builder.
- `apps/web/lib/server-core.ts` — proxy target resolved per-request via
  manager lookup instead of the static `7682` constant.
- `apps/web/app/api/terminal/start/route.ts` — request body shape gains
  `scope ∈ {exp, run}` and `slug` (replaces `runId`); back-compat NOT
  preserved (the parallel `OpenWithButton` is updated in lock-step).
- `apps/web/app/api/terminal/stop/route.ts` — kept; only invoked by the
  `Kill` action of the management page indirectly (via the tmux-sessions
  DELETE endpoint, which then frees the port in manager).
- `apps/web/app/api/tmux-sessions/route.ts` (NEW) — `GET` + `DELETE`.
- `apps/web/app/manage/tmux/page.tsx` (NEW) + client component.
- `apps/web/app/layout.tsx` — mount `TerminalDrawerProvider` here.
- `apps/web/app/p/[project]/layout.tsx` — remove the
  `TerminalDrawerProvider` mount.
- `apps/web/components/terminal-drawer-provider.tsx` — drop
  route-change `closeAndStop`; replace `Close + stop` with `Pop out`;
  preserve drawer state across pathname changes.
- `apps/web/components/open-with-button.tsx` — pass `(scope, slug,
  project)` into `startTerminal`.
- `apps/web/components/app-sidebar.tsx` — `SidebarFooter` with link.
- `apps/web/lib/api.ts` — `startTerminal` body shape; new
  `listTmuxSessions` / `killTmuxSession` clients.
- `packages/core/src/schemas.ts` — `ProjectConfigRawSchema.name`
  regex; new `TerminalConfigRawSchema`.
- `packages/core/src/types.ts` — `TerminalConfig` interface.
- `packages/core/src/config/load.ts` — read `terminal:` section; defaults.
