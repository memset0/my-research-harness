## ADDED Requirements

### Requirement: Expanded run panel surfaces full run information

The expanded run panel inside the v3 exp detail page SHALL render
every piece of information shown on the legacy run-as-experiment
page (`/p/<project>/experiments/<id>`), so that users do not need to
follow a "(legacy)" link to see standard run metadata, edit run
status, browse logs, or manage warnings. The panel SHALL render the
following blocks in this top-to-bottom order:

1. **Status + frontmatter header** — A bordered block at the top of
   the panel containing:
   - The editable `<StatusEdit>` pill bound to the run's id, status,
     and current mtime.
   - A 2-column-on-mobile / 4-column-on-desktop grid of frontmatter
     fields. Each field uses a `text-[10px] uppercase tracking-wide
     text-muted-foreground` label. The fields displayed are: name,
     project (only when it differs from the URL's project), created
     timestamp, finished timestamp, host, pid, gpus, entry, command
     (full-width), wandb (full-width, as a link), tags
     (full-width, as Badges), hypotheses (full-width, as linked
     Badges).
2. **Action bar** — Buttons in this order:
   `<TerminalButton>`, `<AddNoteButton>`,
   `<EditMarkdownButton target={kind:'run'}>`, and
   `<OpenClaudeCodeButton kind='run'>`.
3. **Setup** + **Result** sections — small section headings followed
   by the rendered markdown body. Empty bodies SHALL render the
   `to fill` italic placeholder.
4. **Warnings card** — `<WarningsCard runId=… readmePath=… initialWarnings=… initialMtime=…>`,
   passing the same props the legacy page uses.
5. **Per-run Artifacts** — a small `<ul>` listing this run's
   artifacts. The page-level (exp-doc-level) Artifacts card stays
   unchanged and aggregates across all runs; the per-run block here
   is a duplicate-but-narrower view scoped to this one run.
6. **Log viewer** — `<LogViewer expPath={run.path}>`, the same
   component used on the legacy page (NO new log-rendering
   implementation).
7. **Files in run dir** — the existing `<FileTree>` widget with the
   reworked basename + counts + collapse behavior (already pinned
   in the `experiment-edit` spec).

The previously-existing "Open run page (legacy)" `<Link>` SHALL NOT
appear in the panel (the panel is now the canonical run view; the
legacy URL still works but no longer needs an inline escape hatch).

#### Scenario: Status pill editable inline
- **GIVEN** the user has expanded a run panel for a run whose
  status is `RUNNING`
- **WHEN** the panel renders
- **THEN** the top of the panel shows a `<StatusEdit>` control
  bound to the run's id and current mtime — the user can change
  the status without leaving the page

#### Scenario: Frontmatter fields are visible at the top
- **GIVEN** a run whose README frontmatter has `host: hyperion`,
  `gpus: [0,1]`, `entry: train.py`, `command: 'python train.py …'`
- **WHEN** the panel is expanded
- **THEN** the top of the panel renders a frontmatter grid showing
  the host, gpus, entry, and command fields with the literal
  values above

#### Scenario: Warnings card lives inside the panel
- **GIVEN** a run whose README has a `## Warnings` table
- **WHEN** the panel is expanded
- **THEN** the panel renders a `<WarningsCard>` keyed on the run's
  id and current mtime, with the parsed warnings already populated

#### Scenario: Log viewer reuses the legacy component
- **GIVEN** a run whose dir contains log files (per
  `/api/log-files?expPath=…`)
- **WHEN** the panel is expanded
- **THEN** the same `<LogViewer>` component used by the legacy
  run page is rendered inside the panel — there is exactly one
  log-viewer component implementation in the web app, used by
  both routes

#### Scenario: No legacy escape hatch
- **GIVEN** the user has expanded the panel
- **WHEN** the panel renders
- **THEN** there is NO `<Link>` whose visible text is "Open run
  page (legacy)" inside the panel. The panel is intended to
  contain everything the legacy page surfaces.
