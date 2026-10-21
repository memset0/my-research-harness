## Why

Markdown Report pages show a table of contents at the top of the document and Markdown Wiki pages show an outline column, and neither can be collapsed. Long contents push the Report body down and the Wiki outline takes width the reader may want back.

## What Changes

- The Report table of contents and the Wiki "On this page" outline become native disclosure widgets (`<details>`/`<summary>`): open by default, collapsed and expanded by clicking or keyboard on their title.
- A collapsed Wiki outline shrinks its column to the title so the document can use the width.

## Capabilities

### New Capabilities

### Modified Capabilities
- `web-dashboard`: Markdown tables of contents can be collapsed and expanded.

## Impact

`apps/web/components/markdown.tsx`, `wiki-shell.tsx` and their tests. Central-only: PATCH release.
