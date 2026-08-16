## 1. Persisted Report picker preference

- [x] 1.1 Extend inbox browser coverage for default-open behavior, browser
  restoration of hidden/shown state, immediate local writes, remount/project
  continuity, and unchanged mobile/Digest behavior.
- [x] 1.2 Replace component-local Report picker visibility with the global
  `memon:reports:picker-open` user preference, defensively fall back from
  non-boolean stored values, and preserve the existing Hide reports and Show
  reports controls.

## 2. Collapsed-state quick switcher

- [x] 2.1 Add coverage proving the collapsed desktop identity combines ID and
  slug as an accessible trigger, opens a bounded Report-card list, marks the
  current route, exposes native destination links, closes on selection/Escape,
  and is absent in expanded/mobile/Digest contexts.
- [x] 2.2 Extract the selected Report identity presentation and add a controlled
  shadcn Popover for collapsed desktop mode, reusing `RailList` and closing it
  through the existing selection callback without expanding the rail; pass the
  relevant query's real loading state to every list surface.
- [x] 2.3 Add truncation, accessible full identity text, Popover labelling,
  bounded internal scrolling, visible focus, and semantic shadcn surface styles.

## 3. Verification and deployment

- [x] 3.1 Run focused Report inbox, user-preference, Markdown, and Report embed
  tests plus the web typecheck and production build.
- [x] 3.2 Inspect expanded/collapsed, reload/remount, quick-switch selection,
  long-list scrolling, keyboard dismissal, mobile Sheet, Digest, light-theme,
  and dark-theme behavior.
- [x] 3.3 Strictly validate the OpenSpec change, mark all tasks complete, restart
  the managed production service on port 3737, and verify the new bundle and
  health endpoint.
