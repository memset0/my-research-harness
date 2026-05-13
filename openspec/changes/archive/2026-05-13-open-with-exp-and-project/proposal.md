## Why

`OpenWithButton` — the split-button that spawns a ttyd/tmux session and
optionally launches Claude Code / Codex / OpenCode — is currently the
only consistent entry point for "open an agent against this thing".
Today it only ships against runs. Exp doc pages still show the legacy
`OpenClaudeCodeButton` (which can only copy a `cd … && claude`
command to the clipboard — a placeholder from before
`tmux-session-rework` landed), and project pages have no entry point at
all. The user has to navigate down to a specific run before they can
actually open a browser terminal, which is the wrong level of
granularity when they want to inspect or operate on the whole project
or whole experiment.

This change extends the same shared component to two new scopes — exp
and project — and removes the clipboard-only placeholder, so every
level of the hierarchy uses **one** component group with the same
agent-picker, drawer-or-popup affordance, and ttyd-install fallback.

## What Changes

### Scope extension (backend + types)

- Extend `TerminalScopeKind` from `'exp' | 'run'` to
  `'exp' | 'run' | 'project'` in `apps/web/lib/api.ts` and propagate to
  every Zod schema and consumer that pins the closed enum.
- `POST /api/terminal/start`: accept `scope: 'project'`. Resolve `cwd`
  to the project's `root`; do NOT require a slug match against
  runs/experiments. Slug for project scope is a fixed sentinel
  `'root'` (see design.md for rationale).
- Terminal session name pattern stays
  `memon-<agent>-<project>--<scope>--<slug>`; for project scope the
  literal sessionName is `memon-<agent>-<project>--project--root`.
  Parser and prettifier in `apps/web/lib/terminal/manager.ts` learn the
  new scope value.
- `/terminal-popup` page accepts `scope=project` in its query-param
  whitelist.
- **BREAKING (web-internal):** `POST /api/open-claude-code` is removed.
  Its only caller was the placeholder `OpenClaudeCodeButton`, which
  this change deletes.

### UI placement (three call sites)

- **Project — new.** `AppBar` renders one `<OpenWithButton
  scope="project" slug="root" project={project} />` on the right side
  of the header row (mirror of the tab list on the left). On mobile it
  flex-wraps below the tabs like everything else in that header.
- **Exp — replace.** `experiment-page.tsx`: replace
  `<OpenClaudeCodeButton kind="exp" id={exp.id} … />` with
  `<OpenWithButton scope="exp" slug={exp.id} project={project} />` in
  the same action-bar slot (line 84).
- **Run — unchanged.** `experiment-page.tsx` line 259 already renders
  `<OpenWithButton scope="run" slug={runId} project={project} />`;
  this change does not move it.

### Cleanup (removals)

- Delete `apps/web/components/open-claude-code-button.tsx` and its
  named export `OpenClaudeCodeButton`.
- Delete `apps/web/app/api/open-claude-code/route.ts` (the
  copy-to-clipboard endpoint).
- Remove the `openClaudeCode()` helper and the `OpenClaudeCodeRequest`
  / `OpenClaudeCodeResponse` types from `apps/web/lib/api.ts`.
- Leave `TerminalButton` (used by the legacy v2 `experiment-detail.tsx`
  route at `/p/<project>/experiments/<id>`) alone — that route is
  out-of-scope and will be retired by a separate v3-cleanup change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `browser-terminal`: extend the `scope` enum at the `POST
  /api/terminal/start` body, popup URL whitelist, session-name format,
  and component contract to include `'project'`; replace the exp-page
  "Ask Claude Code" clipboard button with the `OpenWithButton` (the
  same component already used at the run header); add the project-scope
  `OpenWithButton` to the AppBar header. Add the convention that for
  `scope: 'project'` the slug is fixed to `'root'`.
- `tmux-session-management`: extend the `parsed.scope` type at the
  `/api/tmux-sessions` row shape and the management-page Target-cell
  deeplink resolver to include `'project'` (deeplink target is
  `/p/<project>`).

## Impact

### Code

- `apps/web/lib/api.ts` — `TerminalScopeKind` enum widens; remove
  `openClaudeCode()` and its types.
- `apps/web/app/api/terminal/start/route.ts` — accept new scope; cwd
  branch for project; slug-mismatch logic does not apply to project.
- `apps/web/lib/terminal/manager.ts` — `ScopeKind` widens, parser
  recognizes `'project'` in the sessionName, prettifier renders a
  human-readable label.
- `apps/web/app/terminal-popup/page.tsx` — extend `VALID_SCOPES`.
- `apps/web/components/app-bar.tsx` — add `OpenWithButton` to the
  right side of the header.
- `apps/web/components/experiment-page.tsx` — swap
  `OpenClaudeCodeButton` for `OpenWithButton` at the exp action bar.
- **Delete:** `apps/web/components/open-claude-code-button.tsx`,
  `apps/web/app/api/open-claude-code/route.ts`,
  `apps/web/app/api/open-claude-code/route.test.ts` (if present).
- Tests touching `TerminalScopeKind` or session-name parsing extend to
  cover the new `'project'` value.

### APIs

- `POST /api/open-claude-code` — **removed**. No external callers
  documented.
- `POST /api/terminal/start` — accepts new `scope: 'project'`.
  Backward-compatible additive change.
- `/terminal-popup?...&scope=project` — newly accepted.

### Dependencies

None added.

### Risk

- The shared `OpenWithButton` already handles all four agents,
  install/disabled states, drawer/popup modes — extending the scope
  enum is the only knob being turned, so the blast radius for the UI
  is small (the same component, just rendered at three call sites).
- Removing `OpenClaudeCodeButton` removes a feature (clipboard
  fallback). Users who relied on copying `cd … && claude` to paste
  into a local terminal lose that affordance. Mitigation: the same
  `OpenWithButton` dropdown offers "Open in new window", and the
  resulting browser tmux runs `claude` directly, so the local-terminal
  workflow has a one-click equivalent.
