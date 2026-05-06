## Context

The v3 page lives at `apps/web/components/experiment-page.tsx`. Its
`RunBody` reads the run via `fetchExperiment(runId)` (returns a
`FullExperiment` with `frontMatter`, `sections`, `warnings`, etc.)
plus the file tree via `fetchRunFiles`. Both the data and the
sub-components needed are already there:

- `StatusEdit({ id, status, stale, expectedMtime })` — the legacy
  status editor; works against the v3 `PATCH /api/runs/:id/status`
  endpoint.
- `TerminalButton({ runId, projectName })` — ttyd browser terminal;
  unchanged in v3.
- `AddNoteButton({ project, runId })` — opens the AddEventModal;
  unchanged in v3.
- `EditMarkdownButton({ path, target })` — v3 id-addressed dialog
  editor (already used by the v3 page, so this just stays).
- `OpenClaudeCodeButton({ kind, id, projectName })` — v3 POST-based
  command-copy variant (already used).
- `WarningsCard({ runId, readmePath, initialWarnings, initialMtime })`
  — already extracted, used by the legacy page.
- `LogViewer({ expPath })` — already extracted, used by the legacy
  page.

So the change is purely composition — no new component file is
needed. The information density of the v3 panel goes from sparse to
"matches legacy" without growing the component graph.

## Goals / Non-Goals

**Goals:**
- v3 panel reaches information parity with the legacy run page.
- Frontmatter is at the top of the panel.
- Status edit works inside the panel.
- LogViewer is reused from its existing module (not duplicated).
- Tighter text — `text-xs` baseline, `text-[10px]` muted labels.

**Non-Goals:**
- Don't delete the legacy page in this change. The user said
  "after we delete the legacy page, IF the time is right" — that's
  a separate, riskier change.
- Don't extract a "shared run blocks" file. The v3 panel and the
  legacy page render the same data slightly differently (legacy
  uses `Card`/`CardHeader`/`CardContent`; the v3 panel renders
  inline because it's already inside a `<details>` of the parent
  Runs card). Forcing a single component to handle both layouts
  adds props and switches without long-term value once the legacy
  page is removed.
- Don't add `AskClaudeCodeButton` to the v3 panel. v3 has its own
  `OpenClaudeCodeButton` for the same intent; these are not
  alternatives but generations.
- Don't refactor the file-tree component (already done in
  `run-file-tree-rework`).

## Decisions

**D1. Inline rendering, not a shared component.** Two reasons:
(a) the v3 panel sits inside `<details>` which constrains layout;
(b) the legacy page is on a deletion track, so any shared
abstraction would be temporary. The frontmatter "card" in the v3
panel is rendered as a plain bordered div (not a nested Card
because we're already inside a Card's CardContent).

**D2. Reuse `LogViewer` and `WarningsCard` directly.** Both already
take their data via props. No props-shape change needed to drop them
into the v3 panel.

**D3. Drop the "Open run page (legacy)" link.** The panel now
contains everything that link took users to. Keeping the link would
muddle the v3 → legacy migration intent.

**D4. Per-run Artifacts block stays small.** The page-level
Artifacts card aggregates all runs; the per-run block here is a
simpler list filtered to this run. Avoid duplicating data between
the two by making the per-run block a flat `<ul>` under a small
section heading, NOT another Card. The page-level Artifacts card
remains for when a user wants to see everything at once.

**D5. Initial warnings + mtime for `WarningsCard`.** The component
takes `initialWarnings` + `initialMtime`. The v3 `fetchExperiment`
returns `warnings` (the parsed table) and `mtime` (the run README
mtime) — same shape as the legacy page passes. Pass them through.

## Risks / Trade-offs

- [Risk] The panel becomes very tall — easy to lose context when a
  run has a long log file. → Mitigation: `LogViewer` has its own
  internal scrolling and tabbing across log files; users can scroll
  back up to the panel header which itself sits inside the parent
  Runs card's `<details>` element.
- [Risk] First-paint cost grows with all these sub-components
  rendered inline. → Mitigation: the panel is `<details>`-folded
  by default; sub-components only mount when the user clicks the
  panel open. Inside, each query has its own loading state.
- [Risk] `EditMarkdownButton` opens a Dialog (modal) — different UX
  from the legacy `EditReadmeButton` which uses a side panel on
  desktop. → Mitigation: that's the v3 way; users on mobile already
  saw a Dialog from the legacy page anyway. Side-panel behavior can
  be revisited in a separate change if user feedback comes in.

## Migration Plan

Code-only edit. No data or schema migration.

## Open Questions

None.
