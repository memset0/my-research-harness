## MODIFIED Requirements

### Requirement: Files-in-run-dir tree display

The exp detail page's expanded run panel SHALL render a tree view of
the run dir contents (sourced from `/api/runs/:id/files?depth=…`)
with the following display rules:

- Each node SHALL render only the **last path segment** of its
  `path` (the basename), NOT the full relative path returned by the
  API. The root node (`path: '.'`) SHALL render as `(run dir)`.
- Icons SHALL use the lucide icon set (matching the rest of the
  dashboard), NOT Unicode emoji. Specifically:
  - File rows: `<File>` icon.
  - Directory rows: `<Folder>` (collapsed) or `<FolderOpen>`
    (expanded).
  - Directory rows SHALL NOT render a leading
    `<ChevronRight>` / `<ChevronDown>`. The Folder ↔ FolderOpen
    morph alone conveys the open/closed state, and dropping the
    chevron means folder rows align horizontally with file rows
    (single icon column at every depth).
- Per-depth indent SHALL be at least `16px` per level so hierarchy is
  scannable.
- Each directory row (excluding the root) SHALL display a recursive
  descendant count next to the basename, formatted as a small muted
  number (e.g. `(12)` or with a tabular-nums classed span). The
  count SHALL be the total of files and subdirectories at all
  depths beneath this node.
- Directory rows SHALL be clickable to toggle expand/collapse.
  Clicking anywhere on the directory row toggles its state. The
  initial state for a non-root directory SHALL be:
  - **Collapsed** if its recursive descendant count is **> 10**.
  - **Expanded** otherwise.
- The root row is always expanded; clicking it is a no-op.
- The pre-existing `(truncated)` indicator next to the section
  heading (when the API reports `truncated: true`) SHALL be
  preserved.

#### Scenario: Basename rendering, no path duplication
- **GIVEN** an API response where a directory has
  `path: "logs"` and a file inside it has `path: "logs/stdout.log"`
- **WHEN** the tree renders
- **THEN** the directory row's text is `logs` (NOT `logs/`-or-
  longer)
- **AND** the file row's text is `stdout.log` (NOT
  `logs/stdout.log`)

#### Scenario: Folder shows recursive descendant count
- **GIVEN** a directory whose subtree contains 4 files and 2
  sub-directories (the sub-directories together contain 5 more
  files), so 4 + 2 + 5 = 11 descendants
- **WHEN** the tree renders this directory row
- **THEN** the row displays a small muted `11` next to the basename

#### Scenario: Folder collapsed by default when recursive count > 10
- **GIVEN** a directory whose recursive descendant count is 11
- **WHEN** the tree first renders
- **THEN** the directory row is collapsed (its children are NOT in
  the DOM); the folder icon is `<Folder>` (no chevron)

#### Scenario: Folder expanded by default when recursive count ≤ 10
- **GIVEN** a directory whose recursive descendant count is 7
- **WHEN** the tree first renders
- **THEN** the directory row is expanded (its children ARE in the
  DOM); the folder icon is `<FolderOpen>` (no chevron)

#### Scenario: Click toggles a folder's expand state
- **GIVEN** a folder collapsed by default (count 11)
- **WHEN** the user clicks anywhere on its row
- **THEN** the folder expands (icon morphs Folder → FolderOpen,
  children render)
- **AND** clicking again collapses it back

#### Scenario: Folder and file rows align horizontally
- **GIVEN** a directory containing both a sub-directory and a file
  at the same depth
- **WHEN** the tree renders both rows
- **THEN** the leading icon (`<Folder>` for the dir, `<File>` for
  the file) starts at the same horizontal x-position — there is
  no chevron-width offset on the folder row
