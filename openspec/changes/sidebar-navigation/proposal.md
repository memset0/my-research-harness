## Why

Navigation is split across three places: projects grouped by Host in the sidebar, view tabs in the top bar, and a right-hand picker on Report and Wiki pages. The owner wants one tree in the sidebar that shows where the current page sits, a project order of their own, and full-width reading with searchable card indexes on the Report and Wiki list pages.

## What Changes

- The sidebar lists projects flat, each with a Host chip (Host id plus an availability dot) and its git pill, in the owner's own order: drag a project row to reorder it (user preference `memon:sidebar:project-order`).
- An expanded project shows Experiments, Journal, Reports, Code Review and Wiki, each linking to its list page (no counts). Experiments, Reports and Wiki expand to list their items.
- The current project, section and item open automatically, and the current item scrolls into view. Restored expansion still reads no project data off the project's routes.
- **BREAKING (UI)**: the top bar loses its view tabs and shows a Host / project / section breadcrumb beside the Share control.
- **BREAKING (UI)**: the Report and Wiki right rails, their visibility toggles and mobile drawers are removed. The list pages become filterable card grids (Reports: the three content filters; Wiki: those plus kind and text filters). A selected Report or Wiki page uses the full width and keeps the identity quick switcher.

## Capabilities

### New Capabilities

### Modified Capabilities
- `web-layout`: sidebar project tree with sections, ordering and auto-reveal; AppBar breadcrumb instead of tabs; no Host grouping.
- `inbox-viewer`: Report list page is a card index; no right rail.
- `wiki-viewer`: Wiki list page is a card index; no right rail.

## Impact

`apps/web/components/{app-sidebar,app-bar,inbox-shell,wiki-shell,wiki-page-card}.tsx` and their tests. Requirements describing the rail and tab details elsewhere in these specs are superseded where they conflict; reconcile them when this change is archived. Central-only: PATCH release.
