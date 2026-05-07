## MODIFIED Requirements

### Requirement: Expanded run panel surfaces full run information

The expanded run panel inside the v3 exp detail page SHALL render every piece of information from the legacy run-as-experiment page (`/p/<project>/experiments/<id>`) that's still relevant under the v3 model — so users don't need to follow a "(legacy)" link to see standard run metadata, edit run status, or browse logs. The panel content sits below the trigger row inside the `<CollapsibleContent>` and is laid out as **three flat divider-separated stripes** in this top-to-bottom order:

1. **Action stripe** (`border-t p-3`) — three primary buttons in this order:
   - `Edit markdown`
   - `Open with [picker]` — a split-button whose main face launches the **default agent** (a localStorage-persisted choice; ships defaulting to `claude code`) and whose chevron opens a `DropdownMenu` with the four agent options (`Terminal`, `Claude Code`, `Codex`, `OpenCode`) plus an `Open in new window` action that opens the current default in a chrome-less popup.
   - `+ Note`
   Plus the `<StatusEdit>` control and the parse-errors `<Badge variant="destructive">` (when `run.parseErrors.length > 0`) at the right end of the stripe.
   The previous separate `<TerminalButton>` and `<OpenClaudeCodeButton>` are NOT used in this stripe; both are subsumed by the `Open with` combo.
2. **Frontmatter stripe** (`border-t p-3`) — a 2-column-on-mobile
   / 4-column-on-desktop dl grid of frontmatter fields:
   name, project (only when it differs from the URL's project),
   created, finished, host, pid, gpus, entry, command (full-width),
   wandb (full-width link), tags (full-width Badges), hypotheses
   (full-width linked Badges). Field labels use
   `text-[10px] uppercase tracking-wide text-muted-foreground`.
   The stripe SHALL NOT render an extra `<run.id>` + status row at
   its top — the trigger row above already shows id + status, and
   StatusEdit is now in the action stripe.
3. **Body stripe** (`border-t p-3`) — Setup, Result, per-run
   Artifacts, LogViewer (`<LogViewer expPath={run.path} />` — the
   same component the legacy page uses), and the Files-in-run-dir
   tree (with the reworked basename + count + collapse behavior).

The stripe `<div>`s SHALL be direct children of
`<CollapsibleContent>` so each stripe's `border-t` spans the full
width of the run panel — the divider's left and right ends connect
to the panel's outer border rather than sitting inside an outer
`p-3` wrapper.

The `<WarningsCard>` SHALL NOT appear inside the run panel.
Warnings management for an experiment lives on the exp doc's
`## Warnings` section only — the per-run warnings table was a v2
artifact and duplicating it inside each run panel was noise.

The previously-existing "Open run page (legacy)" `<Link>` SHALL NOT
appear in the panel.

#### Scenario: Three stripes with edge-to-edge dividers
- **GIVEN** a user has expanded a run panel
- **WHEN** the panel renders
- **THEN** the `<CollapsibleContent>` contains three direct child
  `<div>` blocks, each with `border-t p-3`, in this order: action
  stripe → frontmatter stripe → body stripe
- **AND** none of those blocks is wrapped inside an additional
  outer `p-3` div (so the `border-t` lines on the stripes span the
  full content-box width and visually connect to the run panel's
  outer border)

#### Scenario: Action stripe order
- **WHEN** the action stripe renders
- **THEN** its primary buttons appear in this order: `Edit markdown`, `Open with [picker]`, `+ Note` — followed by `StatusEdit` and (if applicable) the parse-errors Badge

#### Scenario: Open with picker has four agent options + popup option
- **WHEN** the user clicks the chevron on the `Open with` split-button
- **THEN** a `DropdownMenu` appears containing exactly these items in this order: `Terminal`, `Claude Code`, `Codex`, `OpenCode`, then a separator, then `Open in new window`
- **AND** clicking any of the four agent items launches the side drawer for that agent
- **AND** clicking `Open in new window` opens the default agent in a chrome-less popup window

#### Scenario: Action stripe no longer carries TerminalButton or OpenClaudeCodeButton directly
- **WHEN** the action stripe renders
- **THEN** there is exactly ONE button whose visible label starts with the text `Open with`
- **AND** there are NO buttons whose visible label is exactly `Open in browser` (the previous TerminalButton label) or `Open Claude Code` (the previous OpenClaudeCodeButton label)

#### Scenario: Action bar is above the frontmatter
- **WHEN** the panel renders
- **THEN** the order of children inside `<CollapsibleContent>` is
  action stripe FIRST, then frontmatter stripe, then body stripe

#### Scenario: StatusEdit lives in the action stripe
- **GIVEN** a run with status `RUNNING`
- **WHEN** the panel renders
- **THEN** the editable `<StatusEdit>` control appears inside the
  action stripe, NOT inside the frontmatter stripe

#### Scenario: Frontmatter stripe omits redundant id row
- **WHEN** the panel renders
- **THEN** the frontmatter stripe does NOT render a `<run.id>` +
  status row at its top — its first child is the dl grid of
  frontmatter fields

#### Scenario: WarningsCard is absent from the run panel
- **GIVEN** a run whose README has a `## Warnings` table
- **WHEN** the panel is expanded
- **THEN** there is NO `<WarningsCard>` rendered inside the panel
  (the panel does not import or reference WarningsCard at all)

#### Scenario: Log viewer reuses the legacy component
- **GIVEN** a run whose dir contains log files (per
  `/api/log-files?expPath=…`)
- **WHEN** the panel is expanded
- **THEN** the same `<LogViewer>` component used by the legacy
  run page is rendered inside the body stripe — there is exactly
  one log-viewer component implementation in the web app, used by
  both routes

#### Scenario: No legacy escape hatch
- **GIVEN** the user has expanded the panel
- **WHEN** the panel renders
- **THEN** there is NO `<Link>` whose visible text is "Open run
  page (legacy)" inside the panel
