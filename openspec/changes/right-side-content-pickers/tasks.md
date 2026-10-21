## 1. Layout

- [x] 1.1 Move the Report rail in `apps/web/components/inbox-shell.tsx` after the reading pane (border on its left edge, right-panel hide/show icons); verify `inbox-shell.test.tsx` asserts the rail follows the reading pane in DOM order and passes
- [x] 1.2 Move the Wiki rail in `apps/web/components/wiki-shell.tsx` after the reading surface (border on its left edge, right-panel hide/show icons); verify a `wiki-shell` component test asserts the rail follows the reading surface and passes

## 2. Filters

- [x] 2.1 Render `ContentFilters` in `apps/web/components/content-presentation.tsx` as one three-column row; each trigger shows a distinct lucide icon plus its value (`All` when unfiltered), keeps `aria-label` and gains a `title` naming the filter; verify with a component test of the row, icons, accessible names and the selected-value display

## 3. Verification

- [ ] 3.1 Run `pnpm --filter @memon/web typecheck`, the two component test files and Biome on touched files; after a prod rebuild, grep the served Report and Wiki markup for the rail after `<main` and confirm the CSS tokens per AGENTS.md §4.3
