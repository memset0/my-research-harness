## Context

`/manage/tmux` is read-only today: list (GET) and kill (DELETE). Users
want a Create path. The page already has the right shape for a small
Dialog-based form alongside the table.

The classifier in `tmux-discover.ts` over-classifies as `stale`: any
non-conforming name (legacy or arbitrary) is flagged stale. With user
creation arriving, that's actively wrong — a name like `memon-foo`
typed by the user is intentional, not stale.

## Goals / Non-Goals

**Goals:**
- A simple Create dialog: name input, idempotent submit, toast on
  success.
- Cwd defaults to `process.cwd()` (memon's running dir) — no project
  root machinery.
- Idempotent on existing names — no error, just attach (covered for
  free by `tmux new-session -A -d`).
- Manual rows are visually distinct from stale rows in the table:
  Target cell is `—`, not `⚠ stale`.

**Non-Goals:**
- Drawer / Popup support for manual rows. They have no parsed
  `(agent, project, scope, slug)` to construct a startTerminal call.
  The user can `tmux attach -t <name>` from a real terminal.
- Customizing cwd in the dialog. Always `process.cwd()`. If the user
  needs a different cwd, they create the session manually.
- Customizing the agent CLI to launch inside the new session. Manual
  sessions are bare shells (no agent). The convention-following
  drawer flow already covers agent-bound creation.

## Decisions

### D1. Prefix `memon-manual-`

The full sessionName is `memon-manual-<user-input>`.

- `memon-` keeps it visible to the existing `tmux ls | grep memon-`
  filter.
- `-manual-` separator distinguishes manual sessions from
  agent-bound `memon-<agent>-...`.
- The user-typed segment cannot start with `memon-` (rejected at
  validation) so we never produce double-prefixes like
  `memon-manual-memon-...`.
- Slug constraint matches the run-slug rule: `[A-Za-z0-9._-]+`, no
  `--` (the scope delimiter; banned to avoid the manual name
  accidentally re-parsing as a malformed standard name).

Alternative considered: prefix `memon-x-` (shorter). Rejected
because `manual` is more self-documenting in `tmux ls` output and
the management page columns.

### D2. `tmux new-session -A -d -s <fullName> -c <cwd>`

- `-A` — attach if exists, else create.
- `-d` — detached (don't attach a client; ttyd / subsequent attaches
  are the client paths).
- `-s <fullName>` — name.
- `-c <cwd>` — start directory for the first window.

Combined: idempotent. Already-existing → no-op (since `-A` says
attach but `-d` says don't attach; net effect is "exists → fine").
Fresh → creates detached with the right cwd.

To distinguish "already existed" from "freshly created" for the toast,
we run `tmux has-session -t <name>` BEFORE the `new-session` call and
use that result for the response's `alreadyExisted` field.

### D3. Manual category replaces "stale (old-format)" and "stale (unparseable)"

`staleReason` enum is trimmed:
- **Before**: `'unknown-project' | 'unknown-target' | 'old-format' | 'unparseable' | null`
- **After**:  `'unknown-project' | 'unknown-target' | null`

Classification table:

| Parsed shape | Project lookup | Target lookup | matchable | staleReason |
|---|---|---|---|---|
| Standard | found | found | true | null |
| Standard | missing | — | false | `unknown-project` |
| Standard | found | missing | false | `unknown-target` |
| Legacy `memon-<agent>-<runId>` | n/a | n/a | false | null (manual) |
| Anything else `memon-*` | n/a | n/a | false | null (manual) |

Manual = `matchable: false, staleReason: null`. Distinct from stale
= `matchable: false, staleReason: <reason>`.

### D4. Rendering

The Target cell:
- matchable + href → clickable Link
- matchable=false + staleReason!==null → `⚠ stale (<reason>)`
- matchable=false + staleReason===null → `—` (the manual case)

Actions cell:
- matchable=true → `Drawer` + `Popup` + `Kill`
- matchable=false (regardless of staleReason) → `Kill` only

So manual rows behave like stale rows in the actions column —
Drawer / Popup absent — but the Target column reads "—" rather than
"⚠ stale".

### D5. POST /api/tmux-sessions endpoint shape

```
POST /api/tmux-sessions
Body: { name: string }
200:  { ok: true, sessionName: "memon-manual-<name>", alreadyExisted: boolean }
400:  { error: { code: "BAD_REQUEST", message: string } }
500:  { error: { message: string } } (tmux exec failure)
```

Auth: same Basic-auth gate as the rest of the dashboard. Classified
as `shell` route under `auth-system` (it executes a process).

Validation:
- `name` non-empty, matches `[A-Za-z0-9._-]+`, does NOT contain `--`,
  does NOT start with `memon-`.
- Reject otherwise with 400 + descriptive message.

## Risks / Trade-offs

- [Risk] User creates many manual sessions and forgets — they
  accumulate in `tmux ls`. → Mitigation: existing Kill action +
  filter tabs already cover cleanup. The Stale tab is unaffected
  (manual rows don't show there since `staleReason` is null).
- [Risk] Manual rows cannot be opened in browser — only Kill works.
  → Mitigation: documented; the user can `tmux attach -t <name>`
  in a real terminal. Future change can add raw-attach drawer mode
  if demand emerges.
- [Risk] User types a name that happens to match the standard
  format like `claude-project-a--run--foo`. After `memon-manual-`
  prefix, it becomes `memon-manual-claude-project-a--run--foo`,
  which has `--` so the parser tries the standard split → 4 parts
  (`memon-manual-claude-project-a`, `run`, `foo`) wait that's 3,
  with the prefix segment being `memon-manual-claude-project-a` —
  agent peel doesn't match (no agent prefix `manual-claude-...`),
  so parse returns null. Falls into manual category. ✓
- [Risk] The classifier change is a server-API behavior shift —
  clients that rely on the four-value `staleReason` enum will
  receive a narrower union. → Mitigation: only the in-tree client
  (`apps/web/lib/api.ts`) consumes this; we trim it in lock-step.
