## Context

The current terminal manager owns one ttyd child per canonical tmux session and
the root drawer/popup both render a `TerminalView` that starts or attaches that
session. Herdr already supplies its own persistent server, workspace topology,
and direct CLI control surface. It must therefore sit behind ttyd rather than
inside tmux; nesting Herdr in a tmux session would leave tmux owning the outer
lifecycle and defeat the requested separation.

The frontend learns only git polling cadence at runtime today. Backend
enablement must be serialized to the client so disabled controls can disappear
without probing ttyd or attempting shell APIs.

## Goals / Non-Goals

**Goals:**

- Keep ttyd allocation, proxy authentication, and cleanup shared across
  terminal backends.
- Preserve byte-for-byte tmux command construction and existing default-on
  behavior when tmux is enabled.
- Make Herdr workspace selection idempotent and safe under concurrent browser
  opens.
- Deploy without migrating or ending existing tmux or Herdr processes.

**Non-Goals:**

- Reimplementing a Herdr workspace inventory or lifecycle-management page in
  memon.
- Stopping, deleting, renaming, or restoring Herdr workspaces.
- Supporting remote Herdr servers or separate named Herdr session namespaces
  in this change.
- Starting a coding agent automatically inside a newly-created Herdr workspace.

## Decisions

### D1. Configuration uses default-on tmux plus an opt-in Herdr CLI argv

`terminal.tmux_enabled` defaults to `true`. `terminal.herdr` is absent by
default; when present it requires `cli: string[]`. An argv array supports an
absolute binary, launcher, or wrapper without shell parsing. The first element
is the executable and later elements are fixed prefix arguments; memon appends
Herdr TUI or workspace-control arguments directly.

This additive shape keeps every old config valid. Replacing `terminal.commands`
with a nested tmux object would create unnecessary migration work, while a
single command string would require quoting rules or a shell.

### D2. One logical ttyd entry attaches to the default Herdr server

The manager reserves a stable proxy key (`memon-herdr`) and spawns ttyd with
the configured Herdr CLI as its child command. Drawer and popup views reuse that
entry exactly as two tmux views reuse a session entry. LRU, idle TTL, drawer
close, and memon exit can end that Herdr client, but never invoke
`herdr server stop`; pane processes remain owned by Herdr.

Named Herdr sessions are excluded because workspace subcommands target the
default running server, and the user asked for same-name panels inside one
Herdr surface rather than isolated server namespaces.

### D3. Open-with maps targets to Herdr workspaces

Herdr calls its top-level project/work context a workspace. Memon resolves the
target cwd using the same rules as tmux, then derives the label as project name,
experiment ID, or run ID. It starts/reuses the Herdr ttyd client, waits for the
server socket to become responsive, lists workspaces, and focuses an exact
label match or creates one with `--cwd`, `--label`, and `--focus`.

Create-or-focus operations are serialized by target label so simultaneous
opens cannot both observe absence and create duplicates. Matching exact label
implements the requested visible identity and keeps memon independent of
Herdr's opaque workspace IDs.

### D4. Herdr control is a bounded child-process protocol

Workspace commands use the configured argv through `spawn`/`execFile` without
a shell, capture bounded stdout/stderr, enforce a short timeout, and parse the
documented JSON response. A short bounded retry covers the first-client server
startup race. Invalid responses and non-zero exits become typed start errors;
there is no fallback to tmux because that could create a process under the
wrong lifecycle owner.

### D5. Drawer state becomes a backend-discriminated union

The root provider adds a `herdr` state carrying an optional target. The shared
view selects the tmux start/attach APIs or the Herdr start API by mode. Popup
URLs use `integration=herdr` and the same target fields; global sidebar opens
omit the target fields. The header copy explicitly says Herdr owns persistence.

The Open-with stored default widens to include `herdr`. At render time it is
validated against runtime-enabled choices, which prevents stale local storage
from launching a disabled backend.

### D6. Tmux disablement is enforced at UI and route boundaries

Runtime config hides tmux choices and the management link. Tmux routes check
the resolved flag before dynamically loading discovery or manager operations,
so disabled deployments avoid tmux commands and unnecessary route work. Direct
requests still receive an explicit disabled response; authorization remains
owner-only. Existing tmux code paths and tests remain unchanged behind the
enabled branch.

## Risks / Trade-offs

- **Duplicate Herdr labels created outside memon** → focus the first exact
  server-ordered match; memon-created requests are serialized, and no existing
  workspace is mutated.
- **Herdr CLI response changes** → parse only the documented result fields,
  bound output, surface a useful error, and cover representative fixtures.
- **Initial Herdr server startup races workspace control** → start the ttyd
  client first and retry only within a short fixed deadline.
- **Focusing a workspace affects every attached Herdr client** → this is Herdr's
  global focus model and the requested switch behavior; document it and never
  alter panes or commands.
- **Dirty worktree overlaps other active changes** → restrict edits to terminal,
  config, sidebar, and Open-with files and preserve unrelated experiment/report
  work already present.

## Migration Plan

1. Ship with `tmux_enabled` defaulting to true and Herdr absent, producing no
   behavior change for existing configs.
2. Add `terminal.herdr.cli` to the production config while leaving tmux enabled,
   build, then restart the existing 3737 service using its current supervisor.
3. Verify runtime health, enabled sidebar actions, Herdr create/focus, ttyd
   proxy/WebSocket attachment, and one existing tmux path.
4. Rollback by removing `terminal.herdr`, rebuilding/restarting the previous
   code, and leaving all Herdr/tmux durable processes untouched.
