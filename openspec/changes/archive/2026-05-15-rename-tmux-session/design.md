## Context

`tmux rename-session -t <old> <new>` is well-defined: it renames the
session in place WITHOUT disconnecting attached clients. The pane,
the foreground process, the scrollback, the `pane_pid`, and the
`session_created` timestamp all carry over. The new name has the
same validation surface as a new session: it must be unique on the
host, and it must not collide with another tmux client name.

However, **the memon terminal manager** keys its `Map<sessionName,
Entry>` by sessionName. After a tmux-level rename, the ttyd child
that's attached to the (renamed) session is still alive and still
serving HTTP/WS on the same port — but the manager now has a key
pointing at a name that no longer exists from tmux's perspective.
Future calls to `lookupSession(oldName)` will succeed (manager still
holds the entry) but the next attach for the NEW name will see no
entry and spawn a fresh ttyd. We end up with two ttyd children for
one tmux session, the old one slowly hanging on until the manager's
idle TTL reaps it.

The cleanest fix is to tear down the manager's entry for the OLD
name BEFORE issuing the tmux rename. Any browser tab currently
attached to the popup/right-pane ttyd will get a WS disconnect, see
the standard "starting ttyd…" loader, then re-POST `/api/terminal/
attach` for the (new) sessionName and land back inside the renamed
session. End-user experience: a half-second flicker on whichever tab
was attached. Acceptable for an explicit user action.

The terminal manager exposes `stopSession(sessionName)` which deletes
the Map entry and `SIGTERM`s the ttyd child. That's the right primitive.

## Goals / Non-Goals

**Goals:**

- Single-button rename on every row of `/manage/tmux` (matchable,
  manual, AND stale).
- The renamed session keeps its pane / process / scrollback. The
  rename is genuinely in-place from tmux's perspective.
- The currently-selected row (`?session=<old>`) refocuses to
  `?session=<new>` automatically after a successful rename, so the
  user doesn't have to re-click.
- The manager doesn't leak a ttyd pointing at the old name.

**Non-Goals:**

- Bulk rename. One session at a time.
- Renaming a session AS another session (i.e., merging into an
  existing target). `tmux rename-session` fails with "duplicate
  session" if the new name already exists; we surface that as a
  409 to the client and don't try to merge.
- Renaming via drag-and-drop or inline-edit. Dialog only.
- CLI surface (`memon tmux rename`). Web-only for now.
- Renaming the on-disk run/exp slugs that the tmux session
  references. That's a memon-side operation; this change is purely
  about tmux state.

## Decisions

### Endpoint shape: `POST /api/tmux-sessions/:name/rename`.

The kill endpoint is `DELETE /api/tmux-sessions/:name` (no body).
The create endpoint is `POST /api/tmux-sessions` with `{ name }` in
the body. Rename is a stateful side-effect on an existing resource,
so `POST .../rename { newName }` (named action) reads more clearly
than `PATCH /api/tmux-sessions/:name { newName }`. Both shapes work;
the named action wins on grep-ability — "find me where tmux rename
happens" → endpoints with `rename` in the path.

Alternative considered: `PATCH /api/tmux-sessions/:name { newName }`.
Rejected because the broader `PATCH` verb implies "edit any field",
and tmux sessions don't have other writable fields. A rename-only
PATCH is misleading.

### Manager teardown sequence: stop BEFORE rename.

Three sequences are possible:

1. **stop, then rename** — manager Map entry for `<old>` is gone
   before `tmux rename-session` runs. The ttyd child is killed; if
   tmux's rename succeeds, the new name has NO live entry; if it
   fails (e.g., the new name already exists), we have a small
   inconsistency: the ttyd is gone but the old session still exists.
   Recovery: the user immediately re-clicks the row, attach spawns
   a fresh ttyd, status quo ante. Mild annoyance, not data loss.
2. **rename, then stop** — `tmux rename-session` runs first. If it
   succeeds, the manager's entry under `<old>` is now an orphan
   pointing at a session that doesn't exist by that name. If we
   then call `stopSession(<old>)` the entry is removed but the
   actual ttyd child was attached to a still-living session and
   killing it forces a brief WS disconnect on whoever was watching.
3. **rename, then re-key the manager entry** — most invasive,
   requires adding `manager.renameKey(old, new)`. Possible but
   pulls in subtle concerns (start-chain dedup keys, idle-LRU
   bookkeeping).

I picked option 1. The failure window is small (tmux-rename takes
~50ms), the recovery is trivial (re-click), and the implementation
is a one-liner.

### Name validation: both old and new must match `^memon-[A-Za-z0-9._-]+$`.

Identical to the existing `tmuxHasSession` / `killTmuxSessionByName`
surface. We don't enforce any internal structure (don't require
`memon-<agent>-<...>--<scope>--<...>`) because the user might be
intentionally renaming TO a non-matchable form (e.g., turning a
stale row into a manual one) or vice versa. The classifier on the
next refetch sorts it out.

We DO enforce:
- new name MUST start with `memon-` (the universal prefix is the
  only invariant we treat as load-bearing across the codebase),
- new name MUST be different from old (a no-op rename is a 400 with
  a clear message),
- new name MUST NOT already exist on the host (409). Without this
  check `tmux rename-session` would itself fail with `duplicate
  session`; we surface that as a structured client error.

### Pre-fill the dialog with the full current name.

Some users will want to rename `memon-claude-old-proj--run--foo-...`
to `memon-claude-new-proj--run--foo-...` (rebind a stale session).
Others will want to rename `memon-manual-scratch` to
`memon-manual-debug`. Pre-filling the full name keeps both flows
easy (just edit the substring that's wrong). Mode-switching the
prefix (e.g., a separate "rename the manual suffix only" UX) is
extra mental load for marginal benefit.

### Selection refocus uses `router.replace`.

When the renamed session was selected (right-pane visible), update
the URL via `router.replace(/manage/tmux?session=<new>)` so:
- The `?session=` deep-link is consistent.
- Browser history isn't polluted with intermediate states.
- The page's existing "select from URL" effect (which keys the
  right-pane `<TerminalView>`) picks up the new name and re-mounts
  cleanly.

We rely on the existing teardown effect when `key={sessionName}`
changes on `<TerminalView>` — that fires the cleanup, then re-mounts
with the new key and re-runs the `attachTerminal` effect. No new
imperative code needed.

### Toast on success.

The list refetch + URL update are silent operations. A `sonner` toast
`renamed <old> → <new>` is the user-facing acknowledgement, matching
the existing "created `memon-manual-<name>`" / "joined existing
`memon-manual-<name>`" pattern in the New session flow.

## Risks / Trade-offs

[Risk] A user renames a session attached in a separate popup window
(or a different browser tab). → Mitigation: the popup tab's WS
disconnects when we `stopSession(<old>)`; the popup's `TerminalView`
shows the existing error state ("starting ttyd…" briefly, then a
reconnect on next click). The user can reopen the popup with the new
name from the manage page. We don't try to detect-and-update popup
windows from the server side — too invasive.

[Risk] Concurrent rename + kill from two browser tabs. → Mitigation:
both endpoints are auth-gated and serialized through the runtime's
single Node process. If the kill wins, rename gets 404 (session
doesn't exist). If the rename wins, kill targets the new name (404
since the kill endpoint still references the old name). Both paths
return a clear 404; the page refetches and shows the truth.

[Risk] tmux rename succeeds on the host but the manager teardown
errors. → Mitigation: `stopSession` already wraps its child-kill in
`killChild(...)` which is best-effort; if it throws, we catch and
log, but the tmux side is already renamed. The orphan manager entry
will be reaped by the idle-LRU TTL within the next ~30 minutes
(default `ttydIdleTtlMinutes`). No data loss; the worst case is one
extra ttyd lingering until the TTL.

[Risk] Spec drift: the existing
`tmux-session-management` spec scenarios about "actions group
contains exactly two icon-only buttons" need to change to three. →
Mitigation: the delta in this change uses explicit MODIFIED markers
for the affected requirement and its scenarios.

## Migration Plan

UI + endpoint-only change, no data migration. Ship in a single
deploy. Rollback is a revert of the four code files plus the new
route file.

## Open Questions

None that block implementation.
