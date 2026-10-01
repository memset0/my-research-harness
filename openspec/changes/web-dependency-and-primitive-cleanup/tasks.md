## 1. Unused dependencies

- [ ] 1.1 Grep each audited candidate (`@radix-ui/react-*` x8, `@hugeicons/*`, `date-fns`, `date-fns-tz`, `cn`, `tailwindcss-animate`, `@tanstack/react-table`) across Web `.ts/.tsx/.css/.mjs` sources; confirm zero references, that every `components/ui/*` imports from `radix-ui`, and that `globals.css` imports `tw-animate-css`
- [ ] 1.2 Check whether `js-yaml` and `yaml` are both imported by Web code; keep both if so and record the reason in proposal.md
- [ ] 1.3 Remove the zero-reference packages from `apps/web/package.json`, run `pnpm install`, and verify `pnpm -r typecheck` passes and `pnpm --filter @memon/web build` succeeds

## 2. Regenerate shadcn primitives

- [ ] 2.1 Back up the current `context-menu`, `popover`, `table`, `hover-card` primitives to scratch space and record their git history
- [ ] 2.2 Run `pnpm dlx shadcn@latest add context-menu popover table hover-card --overwrite --yes` in `apps/web`; verify only those four files (and no theme tokens or unrelated files) changed
- [ ] 2.3 Reconcile every app import of the four primitives against the generated exports; move any non-upstream export or styling into a wrapper outside `components/ui/` and update importers; verify `pnpm --filter @memon/web typecheck` passes and the results-table, wiki, report, inbox, journal, datatable, and permalink-preview tests pass

## 3. AlertDialog confirmations

- [ ] 3.1 Install `alert-dialog` with `pnpm dlx shadcn@latest add alert-dialog --yes` and verify the file is CLI output importing `radix-ui`
- [ ] 3.2 Replace `window.confirm` in `git-history-dialog.tsx` with a controlled AlertDialog; add render tests for confirm and cancel paths and verify they pass
- [ ] 3.3 Replace `window.confirm` in `wiki-review-panel.tsx` with a controlled AlertDialog; add render tests for confirm and cancel paths and verify they pass; verify `grep -rn "window.confirm" apps/web --include=*.tsx` returns nothing outside tests

## 4. Render verification (F1)

- [ ] 4.1 Build the Web app in the checkout (after confirming the live host does not serve from it) and start an isolated host on a spare port with a scratch config pointing at scratch copies of the mock projects; verify `/login` returns 200
- [ ] 4.2 Fetch authenticated pages that use the regenerated primitives and grep the served HTML for their `data-slot` markers (or assert them in render tests where they only appear after interaction)
- [ ] 4.3 Fetch the page's linked stylesheet and verify `--background:`, `--foreground:`, `--card:`, `--popover:`, `--muted:` each carry an `oklch(` value
- [ ] 4.4 Run the full Web test suite (`pnpm --filter @memon/web test`) and verify it passes; stop the isolated host and delete the scratch projects and config
