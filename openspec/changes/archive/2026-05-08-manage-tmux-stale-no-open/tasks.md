## 1. UI change

- [x] 1.1 In `apps/web/app/manage/tmux/tmux-page.client.tsx`, refactor the row actions cell so `Open in drawer` and `Open in popup` only render when `row.matchable === true`. `Kill` always renders. Remove the existing `disabled={!p.agent || !p.project || !p.scope || !p.slug}` predicate from Drawer / Popup since the new conditional render already covers the unparseable case.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 `pnpm --filter @memon/web test` passes.
- [x] 2.3 Rebuild prod via the CLAUDE.md restart sequence; wait until prod is up.
- [x] 2.4 With at least one stale `memon-*` session present (legacy format counts), `curl -u <auth>` `/manage/tmux` HTML for stale rows: confirm only one `Kill` button per stale row (zero occurrences of `Drawer` / `Popup` button text within the stale row's `<tr>`). Use grep on the rendered table.
- [x] 2.5 Matchable rows still render `Drawer` + `Popup` + `Kill` (regression check).
- [x] 2.6 Browser check (described, not run via curl): on `/manage/tmux`, stale rows visually show only the `Kill` action; matchable rows show all three.
