## Why

The current `AppSidebar` renders each project as a shadcn `Collapsible`
group whose expanded body is capped at the 5 most recently-active
experiments behind a "View more (N)" toggle. As projects grow, this
shape collides with the day-to-day flow:

- Users routinely have ≥5 active experiments per project and the
  "View more" affordance keeps disappearing behind a second click,
  hiding the very item they were looking for.
- When two or three projects are expanded simultaneously, the lists
  stack vertically and the screen runs out of room — the user has to
  manually collapse one project to reach another.
- The recently-added `<GitStatusPill>` is wedged between the project
  name and the chevron, fighting the chevron for end-of-row real estate.
- Launching a plain shell against an experiment's scratch folder
  (independent of `claude code`) still requires a copy-paste of the
  experiment directory into a separate terminal; there is no one-click
  per-experiment shell from the sidebar.

The owner wants a VSCode-Explorer-style sidebar: each project is a
section, multiple sections share the vertical space evenly when
expanded, lists scroll internally, and each experiment row has a
visible per-row terminal launcher (plain shell, owner-only).

## What Changes

- **MODIFY** `apps/web/components/app-sidebar.tsx`:
  - Project sections render with a header row laid out as
    `<chevron> <PROJECT-NAME uppercase tracking-wider text-xs> <GitStatusPill (right-aligned)>`
    instead of today's `<name> <pill> <chevron>` order. The entire
    header remains the `CollapsibleTrigger`.
  - Chevron is the indicator (right when collapsed → rotated down when
    expanded), reusing the existing `ChevronDown` + `rotate-180`
    transition pattern but placed on the LEFT of the project name.
  - `<SidebarContent>` becomes a flex column; expanded sections get
    `flex-1 min-h-0`, collapsed sections sit at intrinsic header
    height (`flex-none`). Available vertical space is split evenly
    across simultaneously-expanded sections.
  - Each section's body becomes `overflow-y-auto`; the experiment list
    is rendered in full (no 5-item cap, no "View more" affordance).
  - Each experiment row gains left padding (`pl-6`) so it visually
    indents under the project name, and a trailing icon-only terminal
    button (lucide `Terminal`) that opens a `TerminalSheet` with
    `agent: 'none'` (plain shell). The button is always visible (not
    hover-gated), hidden for viewer sessions, and disabled when the
    `['terminal','check']` probe reports ttyd is unavailable.
  - `<SidebarFooter>` gains a `border-t border-sidebar-border` so the
    `SlurmStatusWidget` + "Manage tmux" block is visually separated
    from the section list above it.
- **REMOVE** the `DEFAULT_VISIBLE = 5` constant and the local
  `showAll` state + "View more (N) / Show fewer" affordance in
  `ProjectExperimentDocs`. All active experiments are shown
  unconditionally; long lists scroll inside the section.
- **REUSE** the existing `TerminalSheet` flow
  (`apps/web/components/terminal-sheet.tsx`) and the
  `checkTerminal()` + `startTerminal()` plumbing
  (`apps/web/lib/api.ts`). The new per-row button passes
  `{ project, scope: 'exp', slug: <exp-id>, agent: 'none' }` to
  `startTerminal`, mirroring how `experiment-detail.tsx` invokes
  `TerminalButton` (`runId={exp.id} projectName={exp.project}`) but
  with `agent: 'none'` instead of the default `'claude'`.
- Persistence: `memon:sidebar:expanded` localStorage is unchanged.
  The `expanded: Set<string>` state machine and its hydration effect
  stay as-is — only the visual layout and item-cap removal change.

What's NOT changing:

- The TanStack query keys (`['projects']`, `['experiments', project]`,
  `['terminal','check']`, `['git-status', project]`) keep their
  existing shape and caching behavior.
- The SSE wire topics (`run-change`, `experiment-change`) and the
  cache invalidation rules in `apps/web/components/query-invalidator.tsx`
  are untouched — the sidebar still reacts to the same events.
- The shadcn `Sidebar` / `Collapsible` primitives stay; only the
  composition inside them changes.

## Capabilities

### New Capabilities

(none — this change reshapes an existing capability)

### Modified Capabilities

- `web-layout`: Replaces the per-project group's "at most 5
  experiments + View more" model with a VSCode-Explorer-style section
  model. Adds requirements for the new section-header layout, the
  multi-expand even-height distribution, internal section scrolling,
  the per-experiment-row terminal button, and the footer divider.
  Removes the "View more" requirement entirely.

## Impact

- **Code**:
  - `apps/web/components/app-sidebar.tsx` — restructured layout, new
    per-row terminal launcher subcomponent, removal of
    `DEFAULT_VISIBLE` / `showAll` logic.
  - `apps/web/app/globals.css` — no new tokens expected; the
    `--sidebar-border` / `--sidebar-foreground` tokens already exist
    (added during the original sidebar install) and are reused.
- **Tests**:
  - Update `apps/web/components/app-sidebar.test.tsx` (or add a sibling
    test) to cover: section header order (chevron-left, uppercase
    name, right-aligned pill), terminal-button presence per
    experiment row (owner only, hidden for viewer), absence of "View
    more" markup, and the `flex-1 min-h-0` class on expanded sections.
- **Dependencies**: none added. All `lucide-react` icons used
  (`ChevronDown` or `ChevronRight`, `Terminal`) are already imported.
- **System**: no new server route. The terminal button reuses
  `POST /api/terminal/start` with the existing payload shape (only
  `agent` changes from `'claude'` to `'none'`).
- **Performance**: lifting the 5-item cap means longer projects render
  more `<SidebarMenuItem>` rows. At our scale (≤ ~50 experiments per
  project in practice) the cost is negligible and the inner scroll
  container bounds the visible work. No new network calls.
- **Security**: viewer gating on the per-row terminal button matches
  the existing footer items in `app-sidebar.tsx` (`role !== 'viewer'`).
  The server-side terminal-start route already enforces owner-only
  auth, so this is defence-in-depth.
