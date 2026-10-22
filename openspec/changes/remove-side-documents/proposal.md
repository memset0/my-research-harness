## Why

Reports and Wiki pages can open "on the side" of the current page, in a drawer or a resizable right split, with their own quick switcher. The side workspace keeps its state in four URL parameters (`report`, `reportSurface`, `wiki`, `wikiSurface`) and gives every in-document link a source-surface/target-kind navigation matrix. The owner no longer wants this feature: every document already has its own full page, and the side workspace is the main reason links and routes are hard to reason about before the planned route clean-up.

## What Changes

- **BREAKING** (UI only) Remove the side Report and side Wiki surfaces: the drawer, the right split and its divider, the move/close/full-page controls, the side quick switchers and the shared right-side slot.
- Artifact links in Markdown (bare `E`/`R`/`W` identifiers and resolved file links), from any page, navigate to the target's canonical full page. The "Cited by wiki" entries on an Experiment link to the Wiki page.
- The URL parameters `report`, `reportSurface`, `wiki` and `wikiSurface` are retired. A page URL that still carries any of them redirects to the same URL without them, so old links keep opening their page.
- Tables of contents keep their document-prefixed heading ids; only the side-pane wording goes.

## Capabilities

### New Capabilities

### Modified Capabilities
- `report-workspace`: side Report surface, its URL state and quick switcher are removed; artifact links open full pages; legacy side parameters redirect away.
- `wiki-workspace`: every requirement (side Wiki surface, URL state, quick switcher, navigation matrix) is removed.
- `wiki-viewer`: the generated table of contents no longer has a side-pane variant; "Cited by wiki" entries navigate to the Wiki page.
- `inbox-viewer`: the Report table of contents no longer has a side-pane variant.

## Impact

`apps/web/components/workspace-pane-provider.tsx`, `report-pane.tsx`, `wiki-pane.tsx`, `workspace-resize-handle.tsx`, `hooks/use-report-workspace.ts`, `use-wiki-workspace.ts`, `use-workspace-panel-width.ts`, `lib/report-workspace-url.ts`, `wiki-workspace-url.ts`, `workspace-url-params.ts`, the project and manage layouts, `providers.tsx`, `project-footer.tsx`, `experiment-wiki-citations.tsx`, the Markdown artifact-link plumbing, `middleware.ts` and their tests. Central-only: PATCH release. The "Cited by wiki" requirement is also modified by `remove-wiki-review`; this delta is written on top of that change's text, so archive `remove-wiki-review` first.
