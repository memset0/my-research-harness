## Why

`/manage/tmux` lists `memon-*` tmux sessions but offers no way to
**create** one. Users who want a quick scratch tmux session (e.g., to
run an ad-hoc command, pin some long-running output) currently have
to shell out and run `tmux new-session` manually.

A second issue: the current classifier marks every non-conforming
session name as `stale` (with reasons `old-format` or `unparseable`).
That's wrong — a user-created session like `memon-foo` doesn't fit
the `memon-<agent>-<project>--<scope>--<slug>` convention but is
perfectly intentional, not stale. Marking it stale (and hiding
Drawer / Popup) misclassifies user-created work.

## What Changes

### Add a "New session" affordance on `/manage/tmux`

- A `New session` button at the top of the page opens a Dialog with a
  text input.
- The user types a name; the server prepends `memon-manual-` to form
  the full sessionName.
- Submit → `POST /api/tmux-sessions { name }` → server runs
  `tmux new-session -A -d -s memon-manual-<name> -c <process.cwd()>`.
- The `-A` flag makes the call idempotent: existing name → no-op
  attach (the response carries `alreadyExisted: true` so the toast can
  say "joined existing session"); fresh name → creates detached.
- Default cwd is `process.cwd()` of the running `memon serve`
  process (typically the repo root). No project root choice — manual
  sessions are intentionally cross-project.

### Reclassify legacy / unparseable rows from "stale" to "manual"

- Names that don't parse as the new convention (legacy
  `memon-<agent>-<runId>` or anything else not matching) SHALL no
  longer be classified as `stale`. They're treated as a new
  **manual** category.
- The `staleReason` enum drops `old-format` and `unparseable`. Only
  `unknown-project` and `unknown-target` remain — those still
  represent a parsed name where the project / target lookup failed
  and are genuinely stale.
- Rendering: manual rows show `—` in the Target cell (no warning
  badge), and have only the `Kill` action (Drawer / Popup require a
  parsed `(agent, project, scope, slug)` to construct a startTerminal
  call — manual rows don't have one). This matches the recent
  stale-no-open UX, just without the "⚠ stale" label.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `tmux-session-management`: add `POST /api/tmux-sessions` (create);
  add a `New session` button on the inventory page; reclassify
  legacy / unparseable rows from stale to manual; trim the
  `staleReason` enum to project/target-only values.

## Impact

- `apps/web/lib/terminal/tmux-discover.ts` — classifier emits
  `staleReason: null` for legacy and unparseable rows (was
  `'old-format'` / `'unparseable'`).
- `apps/web/lib/terminal/tmux-discover.ts` — new
  `createManualTmuxSession({ name })` helper that validates +
  spawns `tmux new-session -A -d -s memon-manual-<name> -c <cwd>`.
- `apps/web/app/api/tmux-sessions/route.ts` — add `POST` handler
  alongside the existing `GET`.
- `apps/web/app/manage/tmux/tmux-page.client.tsx` — `New session`
  button + Dialog + form; render manual rows with `—` Target and
  Kill-only actions.
- `apps/web/lib/api.ts` — new `createTmuxSession({ name })` client;
  trim `staleReason` type.
- `openspec/specs/tmux-session-management/spec.md` —
  modified inventory + stale-classification requirements; new
  POST-create requirement.
