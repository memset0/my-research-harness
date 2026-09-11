## 1. Contained fragment scrolling

- [x] 1.1 Add `apps/web/lib/scroll-to-fragment.ts` with the owning-scroller lookup and `scroll-margin-top` handling; verify with a focused vitest (jsdom) that only the nearest scrollable ancestor's `scrollTop` changes and a missing target returns false
- [x] 1.2 Intercept outline entries in `wiki-shell.tsx` and same-document fragment links in the shared Markdown `a` component; verify the wiki-shell test covers that activation leaves ancestor scroll offsets untouched and updates the fragment
- [x] 1.3 Position the heading named by the URL fragment inside the reading surface on page mount and reset drifted ancestor offsets; verify by opening a fragment deep link in the browser

## 2. Verification

- [x] 2.1 Run `pnpm --filter @memon/web typecheck`, the wiki-shell and scroll helper tests, then confirm in a headless browser on a real page that clicking the last outline entry leaves the sidebar inset and content scroller at zero and that scrolling back to top restores the toolbar
