## Why

The v3 exp detail page (`/p/<project>/e/<E-id>`) replaced the legacy
run page as the canonical view, but its expanded run panel is
information-poor compared to what the legacy page used to surface. A
user opening the v3 panel sees only:

- Two action buttons (Edit markdown, Open Claude Code)
- The `command` field
- Setup + Result markdown
- The files-in-run-dir tree
- A "Open run page (legacy)" escape hatch back to the v2 page

Whereas the legacy run page (still served at
`/p/<project>/experiments/<id>`) carries:

- A status pill that's also an editor (`StatusEdit`)
- Full frontmatter grid: name / project / created / finished / host /
  pid / gpus / entry / command / wandb / tags / hypotheses
- More action buttons: `Terminal`, `+ Note`, `Ask Claude Code` (the
  v2 form of the new `Open Claude Code`), `Edit README`
- `WarningsCard` (per-run warnings table with append/resolve/reopen)
- Per-run `LogViewer` (Anser-colored log file browser)
- Artifacts list

The user wants the legacy page eventually deleted, but only after the
v3 panel surfaces all of its information. This change does that — the
v3 expanded run panel SHALL render every piece of the legacy run-level
information (the legacy page stays for now as the migration falls back
to it).

Beyond breadth, the user also asked for tighter text sizes (the v3
panel currently uses `text-sm` headings; matching the rest of the
dashboard means `text-xs` and `text-[10px]` for muted labels), and
explicitly: "frontmatter info goes at the top of the expanded panel".

## What Changes

The v3 expanded run panel (`RunBody` in
`apps/web/components/experiment-page.tsx`) SHALL render in this
top-to-bottom order:

1. **Status + frontmatter header** — a compact card showing the run
   id, the editable `StatusEdit` pill, and a 2-column-on-mobile /
   4-column-on-desktop grid of: name, project, created, finished,
   host, pid, gpus, entry, command, wandb, tags, hypotheses (same
   data as the legacy page's frontmatter grid).
2. **Action bar** — `TerminalButton`, `AddNoteButton`,
   `EditMarkdownButton (run)`, `OpenClaudeCodeButton (run)`. (The
   legacy `EditReadmeButton` and `AskClaudeCodeButton` stay only on
   the legacy page; the v3 panel uses their v3 replacements which
   are id-addressed and POST-based.)
3. **Setup** + **Result** sections — unchanged.
4. **Warnings** — `<WarningsCard>` for the run.
5. **Per-run Artifacts** — small block listing this run's artifacts
   (the page-level Artifacts card aggregates ALL runs; this one
   filters to just this run for inline review).
6. **Log Viewer** — `<LogViewer expPath={run.path} />` reusing the
   existing component (no new log-viewing implementation).
7. **Files in run dir** — unchanged (already reworked in
   `run-file-tree-rework`).

The "Open run page (legacy)" link SHALL be removed from the v3 panel
because the panel now contains everything the legacy page shows.

Card-content text size SHALL default to `text-xs` (the existing Card
primitive's default) with `text-[10px] uppercase tracking-wide
text-muted-foreground` for tiny labels — matching the legacy
ExperimentDetail's typography, NOT the v3 panel's previous
`text-sm`-heavy style.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `experiment-edit`: extend the "Run-panel actions inside the exp
  detail page" requirement (and add scenarios) to lock in the new,
  richer run panel contract.

## Impact

- `apps/web/components/experiment-page.tsx` — substantial rework of
  `RunBody` to add status + frontmatter card, action bar, warnings,
  log viewer, and per-run artifacts. Drop the legacy escape hatch.
- No backend changes. No new shadcn components. No new shared file
  (the LogViewer / WarningsCard / StatusEdit / AddNoteButton /
  TerminalButton / EditMarkdownButton / OpenClaudeCodeButton are
  already separate modules — this change just imports and composes
  them).
- The legacy `ExperimentDetail` page (`/p/<project>/experiments/<id>`)
  is untouched; it remains a fully functional fallback until a future
  change deletes it.
