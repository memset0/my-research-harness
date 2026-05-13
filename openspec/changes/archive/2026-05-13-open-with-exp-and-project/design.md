## Context

The `OpenWithButton` component (`apps/web/components/open-with-button.tsx`)
landed in `2026-05-07-tmux-session-rework` as the unified replacement
for the old `TerminalButton` + `OpenClaudeCodeButton` pair. It already:

- Renders a split button with a default agent on the main face and a
  chevron-triggered `DropdownMenu` to pick agent or "Open in new window".
- Handles ttyd `available / downloadable / unavailable` states with
  one-click install and a tooltip explanation.
- Wires the drawer (via `useTerminalDrawer()`) and popup-window
  (via `window.open(popupUrl(), popupTarget(), ...)`) modes off the
  same input tuple `{ project, scope, slug, agent }`.
- Persists the user's last-picked agent in `localStorage` under
  `memon:terminal:default-agent`.

The component is **already scope-parameterised** — its `OpenWithButtonProps`
accepts `scope: TerminalScopeKind`. So the work in this change is not
"add a new component"; it is "widen the closed enums at every
checkpoint along the path" and "render the existing component at two
new call sites".

The hard rule from the user: **all three placements must reuse the
same component group, no scope-specific copies, no near-duplicates.**

## Goals / Non-Goals

**Goals:**

- Place `OpenWithButton` at exactly three call sites — AppBar (project),
  exp-page action bar (exp), run-panel action bar (run) — and have all
  three render identically except for the underlying `(scope, slug)`
  prop pair.
- Allow `scope: 'project'` end-to-end:
  - `POST /api/terminal/start` accepts it, resolves cwd to the project
    root, spawns a tmux session named
    `memon-<agent>-<project>--project--root`.
  - The session parser and prettifier in `manager.ts` recognise
    `project` as a valid `ScopeKind`.
  - The `/terminal-popup` page accepts `?scope=project`.
- Delete the clipboard-only `OpenClaudeCodeButton` placeholder and
  the `POST /api/open-claude-code` endpoint that backed it.

**Non-Goals:**

- Modifying the legacy v2 `experiment-detail.tsx` (at
  `/p/<project>/experiments/<id>`) to also use `OpenWithButton`. That
  route is on the v3-cleanup retirement path; touching it here would
  expand the diff for no current benefit.
- Introducing per-scope cwd-rewrite hints (e.g. opening the exp doc
  file at `claude --resume <expdoc>`). The existing tmux-session
  startup already runs `claude` in the resolved cwd; the user can
  navigate from there.
- Persisting per-scope "last-used agent". The existing global
  `memon:terminal:default-agent` localStorage key is fine — users who
  prefer Codex for project work will set it once, and the same default
  flows to exp/run too. Per-scope persistence is a YAGNI.
- Changing the `/manage/tmux` page contract. The parser change in
  `manager.ts` automatically gives that page a deeplink target for
  project-scope sessions; no special-cased UI is needed.

## Decisions

### D1. Project-scope slug is the literal `'root'`

The tmux session name format is fixed at
`memon-<agent>-<project>--<scope>--<slug>` (per
`tmux-session-management` spec, enforced by the `'--'` split in
`parseSessionName`). The format is load-bearing — both the parser and
the `/manage/tmux` deeplink resolver depend on every name having all
four parts. So `'project'` scope still needs a slug.

**Alternatives considered:**

- **Use `slug = <project name>`** (e.g.
  `memon-claude-projectA--project--projectA`). Pros: zero-collision
  with run slugs. Cons: redundant — the project is already in the
  name. The session-name UI display in `/manage/tmux` would render
  "Project: projectA / Project: projectA", which reads as a bug.
- **Use `slug = '_'` or `slug = '.'`.** Pros: distinctive sentinel.
  Cons: `_` looks like a placeholder bug; `.` violates the slug regex
  `[A-Za-z0-9._-]+` only at the leading position (and is currently
  allowed elsewhere), which makes it surprising to readers.
- **Use `slug = 'root'`.** Pros: reads naturally — "project / root",
  matches the cwd semantic (we're opening at `project.root`).
  Mnemonic. Cons: a user could theoretically name a run `root-<ts>`,
  but the `<scope>` segment disambiguates: `--project--root` vs
  `--run--root-251112-120000` parse differently.

**Decision:** `'root'`. Hard-code it as a `PROJECT_SCOPE_SLUG`
constant in `apps/web/lib/api.ts` (or co-located with
`TerminalScopeKind`) and reference it from the AppBar call site. The
constant prevents the magic string from drifting and makes future
changes (if we ever go to `<project>` as slug) a single edit.

### D2. Server cwd resolution for project scope

`POST /api/terminal/start` currently has this branch (paraphrased):

```ts
if (scope === 'run') { resolve cwd from runs index; fall back to project.root with a warning }
else /* exp */     { cwd = project.root; warn if exp doc missing }
```

For `scope === 'project'` the resolution is the simplest: `cwd =
project.root`, no slug-existence check (slug is always `'root'`, no
artefact to validate against). If the project itself is missing from
config, the existing fallback to `homedir()` with a warning applies.

The same simplification applies to the **session-name → deeplink**
mapping used by `/manage/tmux`: a project-scope row links to the
project's overview page `/p/<project>` (which exists as the
project-root route). The parser already returns
`{ project, scope, slug }`; the deeplink resolver picks the URL based
on `scope`. We extend the conditional to handle `scope === 'project'`.

### D3. AppBar placement: right side, post-tabs flex item

The AppBar today is a single flex row:

```
[SidebarTrigger (mobile)] [nav: tabs] [(empty)]
```

The `<nav>` carries `flex-1 min-w-0 flex-wrap` so tabs can wrap to a
second line on narrow viewports. We want the new button at the **right
side**, vertically centred, NOT wrapping into the tab row.

**Decision:** Render `<OpenWithButton …/>` as a sibling of `<nav>`,
AFTER it in DOM order, with `ml-auto` (or just rely on the flex
container's default justification — `<nav>` has `flex-1` so the button
will be pushed to the right naturally). On mobile, the nav's
`flex-wrap` may push the tabs to a second line; the button stays on
the first line on the right (matching `2026-05-06-appbar-mobile-wrap`
behaviour for the tab list itself).

**Why not a separate header row?** A second row adds vertical chrome
that doesn't pay rent on desktop and steals viewport height on mobile.
The shadcn `Button size="sm"` is ~30px tall and matches the existing
tab heights, so it integrates visually with no extra container.

**Why not in the sidebar?** The sidebar is for navigation between
projects; the action is per-current-project. Putting it in the
sidebar would either require duplicating it for every listed project
or making it position-shift as the active project changes. The AppBar
already carries the "I am at project X" context.

### D4. Keep `TerminalButton` (legacy) in tree

The legacy v2 `experiment-detail.tsx` (route
`/p/<project>/experiments/<id>`) still imports `TerminalButton`. It's
on a separate retirement path and out-of-scope for this change.
Touching it here would risk an unrelated regression for a route
nobody hits in normal v3 usage.

The component itself stays in the tree as dead-code-once-detail-route-
gets-retired, not removed. The `terminal-button.test.tsx` test stays
green; nothing in this change breaks it. A future v3-cleanup change
deletes both together.

### D5. Hard-delete `OpenClaudeCodeButton` and `/api/open-claude-code`

The only callers of `OpenClaudeCodeButton` in v3 are:

- `experiment-page.tsx:84` — replaced by this change.
- (No `kind="run"` usage exists — grep returns nothing.)

So the component is unused after the swap. The matching server route
`/api/open-claude-code` has no other callers either. Delete both, plus
the `openClaudeCode()` helper / types in `lib/api.ts`.

**Rationale:** Per `CLAUDE.md` "no backwards-compatibility hacks", we
remove dead code rather than leaving a re-export shim. Search for
external callers (none found in `apps/`, `packages/`, the CLI, or
skills docs) — safe to delete.

### D6. Tests

- `manager.test.ts`: extend `parseSessionName` and
  `buildSessionName` cases to include `scope: 'project'` (round-trip:
  build → parse → match).
- `/api/terminal/start/route.test.ts` (if present): add a case
  asserting the project-scope POST resolves cwd to `project.root` and
  spawns with the expected sessionName.
- `apps/web/components/app-bar.tsx` does not have a dedicated test
  today; we add a smoke render test only if a sibling component test
  already exists nearby (otherwise rely on the verification protocol
  in `CLAUDE.md` — typecheck + curl-the-rendered-HTML + check the
  button markup is in the served page).
- Delete `apps/web/components/open-claude-code-button.tsx` and any
  associated test file.

## Risks / Trade-offs

- **[Risk]** Hard-coding `slug = 'root'` for project scope could
  collide with a future run named `root-<ts>` (slug pattern is
  `[A-Za-z0-9._-]+` and includes `'root'` as a valid first segment).
  → **Mitigation:** the `<scope>` segment of the session name is
  separately compared, so `--project--root` and `--run--root-<ts>`
  never collide. Plus the parser yields a `scope` field directly; no
  caller needs to disambiguate by slug alone.
- **[Risk]** Users who relied on the clipboard-copy fallback (`cd …
  && claude`) lose that one-click path. → **Mitigation:** the
  "Open in new window" dropdown item gives them a chrome-less popup
  with the same `claude` running against the same cwd — equivalent or
  better UX. Documented in proposal.md and called out in the commit
  message.
- **[Risk]** Adding a button to the AppBar increases the minimum
  header content width and could push the rightmost tabs off-screen
  on very narrow viewports. → **Mitigation:** the existing AppBar
  flex-wrap layout (per `2026-05-06-appbar-mobile-wrap`) handles
  overflow gracefully — tabs wrap to a second line while the button
  stays on the first row. Verify in the curl-rendered-HTML check.
- **[Trade-off]** Persisting a single global `default-agent` instead
  of per-scope means a user who prefers Claude for run debugging and
  Codex for whole-project edits has to either pick from the dropdown
  each time or accept one as the global default. Acceptable; can
  revisit if it becomes friction.

## Migration Plan

No data migration. Single deploy:

1. Land the runtime change.
2. Verify in browser (per `CLAUDE.md` verification protocol — fetch
   project page, exp page, run panel; grep markup for the expected
   `Open with` button at each level).
3. No rollback ladder needed — the API additions are additive
   (`scope: 'project'` is a new accepted value), and the deletion of
   `/api/open-claude-code` is internal-only with no external callers.

## Open Questions

None. The design is straightforward enum-widening + two new call sites
+ dead-code removal.
