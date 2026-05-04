## 1. Install the library

- [x] 1.1 In `apps/web`, add `nextjs-toploader` as a runtime dependency: `pnpm --filter @memon/web add nextjs-toploader`.
- [x] 1.2 Confirm the install pins a version compatible with Next 15.5 (latest stable as of 2026-05); commit the `package.json` and `pnpm-lock.yaml` changes.

## 2. Mount in root layout

- [x] 2.1 Edit `apps/web/app/layout.tsx`: import `NextTopLoader` from `nextjs-toploader` and render it once inside the `<body>`, alongside (sibling of) `<Toaster />`.
- [x] 2.2 Configure with `height={2}`, `showSpinner={false}`, `shadow={false}`, `crawlSpeed={200}`, `speed={200}`. Do NOT pass a `color` prop — color comes from the CSS override (Task 3) so it tracks `--primary` automatically.

## 3. Theme-bind via CSS override

- [x] 3.1 In `apps/web/app/globals.css`, add (under the existing `@theme inline` / token blocks, in a clearly-commented section):
   ```css
   /* nextjs-toploader: bind the bar to our --primary token, hide the peg/glow. */
   #nprogress .bar { background: var(--primary) !important; }
   #nprogress .peg { display: none !important; }
   ```
- [x] 3.2 Verify no other `#nprogress` selectors exist in the project (`grep -rn "#nprogress" apps/web` returns only the lines we just added).

## 4. Tests

- [x] 4.1 Add a smoke test `apps/web/app/layout.test.tsx` (vitest + RTL): render `<RootLayout>` (or a small harness importing the same children) and assert that an element with id `nprogress` is rendered into the document. (`nextjs-toploader` mounts its container immediately, even when idle.) If the library lazily creates the node only on first navigation, replace this test with a render-and-look-for-the-mounted-`<NextTopLoader />`-component test.
- [x] 4.2 Confirm existing tests (66 currently) still pass.

## 5. Verification (per CLAUDE.md F1)

- [x] 5.1 `pnpm --filter @memon/web typecheck` clean.
- [x] 5.2 `pnpm --filter @memon/web test` 100 % pass.
- [x] 5.3 `openspec validate add-top-progress-bar --type change` clean.
- [x] 5.4 With dev server running on `http://localhost:3737` (auth-protected — read `MEMON_USER` / `MEMON_PASS` from `config.yml` per CLAUDE.md), `curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/p/project-a` and grep the served HTML for `id="nprogress"` (the library's portal container).
- [x] 5.5 Curl `/_next/static/css/app/layout.css?v=$(date +%s)` and confirm:
   - `#nprogress .bar { background: var(--primary)` appears (our override is present);
   - `--primary:` is defined under `:root` and `.dark` (token resolves);
- [x] 5.6 Manual browser check: click a sidebar link → 2 px primary-color bar appears within ~50 ms at top of viewport, crawls forward, snaps to 100 % and fades when the destination renders. Cmd-clicking the same link → no bar. Toggling dark mode → bar color updates on next navigation.
