## Why

The right-side terminal drawer currently sizes to
`w-[min(95vw,960px)] sm:max-w-[960px]` — capped at 960px on desktop,
95vw on small screens. 960px gets cramped when running an agent CLI
(claude code's UI, codex output, etc.) — the user wants more room
without sacrificing the rest of the page entirely.

## What Changes

- Bump the terminal drawer's `<SheetContent>` width to
  `w-[min(80vw,1280px)] sm:max-w-[1280px]`:
  - Desktop: 1280px (≈ 33% wider than 960px), comfortably under 80vw
    on any monitor 1600px+ wide.
  - Small screens: capped at 80vw (down from 95vw) so a sliver of
    the underlying page stays visible — useful when the user is
    cross-referencing the terminal with the page content.
- Only the new `apps/web/components/terminal-drawer-provider.tsx`
  changes. The legacy `apps/web/components/terminal-sheet.tsx`
  (used by the v2 detail page on a deletion track) is intentionally
  left untouched.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `browser-terminal`: amend the Drawer-state requirement to specify
  the new default width.

## Impact

- `apps/web/components/terminal-drawer-provider.tsx` — single
  className change on the `<SheetContent>`.
