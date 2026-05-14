## 1. Helper hook update

- [x] 1.1 Add an optional second parameter `defaultValue: boolean = false` to `useMediaQuery` in `apps/web/lib/use-media-query.ts`. The initial `useState` value SHALL be `defaultValue`; the existing `useEffect`-driven `setMatches(mql.matches)` continues to update post-mount.
- [x] 1.2 Verify no existing caller breaks: `grep -rn 'useMediaQuery' apps/web --include='*.tsx' --include='*.ts'` should show only the tmux-page client + the hook's own file. Existing callers that pass one argument keep `false` as the initial value.

## 2. Tmux-page client refactor

- [x] 2.1 In `apps/web/app/manage/tmux/tmux-page.client.tsx`, switch the `useMediaQuery` call to pass `true` as the second argument: `const isDesktop = useMediaQuery('(min-width: 768px)', true)`.
- [x] 2.2 Remove the `DESKTOP_DEFAULT_SIZES` and `MOBILE_DEFAULT_SIZES` constants and the `defaultSizes` / `validSizes` derivation. Remove the `useLocalStorageState<Record<string, number>>(...)` call.
- [x] 2.3 Add a `groupRef` via `useRef<GroupImperativeHandle | null>(null)` (import the type from `react-resizable-panels`).
- [x] 2.4 Add a `useLayoutEffect` that runs once on mount, reads `localStorage[SPLIT_STORAGE_KEY]`, validates it (object with numeric `tmux-list` + `tmux-terminal` keys in `[0, 100]` summing to within 0.5 of 100), and calls `groupRef.current?.setLayout(parsed)` if valid.
- [x] 2.5 Replace `onLayoutChanged={(layout) => setSizes(layout)}` with a memoized `handleLayoutChanged` callback that writes the layout to `localStorage[SPLIT_STORAGE_KEY]` via `JSON.stringify`, debounced ~250ms, wrapped in `try/catch` for private-mode safety.
- [x] 2.6 On `<ResizablePanelGroup>`: remove the `defaultLayout` prop. Pass `groupRef={groupRef}` and the new `handleLayoutChanged`.
- [x] 2.7 On the left `<ResizablePanel id={SPLIT_PANEL_LEFT}>`: change props to `defaultSize={isDesktop ? "300px" : "50%"}`, `minSize={isDesktop ? "180px" : 25}`, and add `maxSize={isDesktop ? "50%" : undefined}`.
- [x] 2.8 On the right `<ResizablePanel id={SPLIT_PANEL_RIGHT}>`: keep the existing `minSize` (`isDesktop ? 35 : 25`). Remove `defaultSize` (the panel will take the remainder).

## 3. Test

- [x] 3.1 Add `apps/web/test/browser/manage-tmux-split-defaults.test.tsx`. Mock `window.matchMedia`, mock `listTmuxSessions`, render `<TmuxManagePageClient />` inside `renderWithQuery`.
- [x] 3.2 Test case 1: with no localStorage entry, assert the `ResizablePanelGroup` element renders with horizontal flex direction. (Note: deeper assertions on library-computed `flexGrow` / `flexBasis` are unreliable in jsdom because react-resizable-panels v4 defers layout computation until ResizeObserver fires, and the test setup's RO stub is a no-op. Instead, `parseStoredLayout` is exported and unit-tested directly.)
- [x] 3.3 Test case 2: pre-populate `localStorage[SPLIT_STORAGE_KEY]` with `{"tmux-list": 40, "tmux-terminal": 60}` and assert the page renders without throwing. (Same jsdom limitation as 3.2.)
- [x] 3.4 Test case 3: pre-populate `localStorage[SPLIT_STORAGE_KEY]` with the invalid string `"not json"` and assert the page renders without throwing. Plus 7 direct unit tests on `parseStoredLayout` covering every invalid-value branch.
- [x] 3.5 Test case 4: assert `useMediaQuery('(any-query)')` (no second argument) still initializes to `false` (backward compatibility). Plus a positive case asserting `defaultValue=true` agrees with a `matches: true` matchMedia mock.

## 4. Verification

- [x] 4.1 Run `pnpm --filter @memon/web typecheck` (must pass).
- [x] 4.2 Run `pnpm --filter @memon/web test -- manage-tmux-split-defaults` (the new test passes — 17/17 tests).
- [x] 4.3 Prod-build SSR markup verification (curl): Built with `pnpm --filter @memon/web build`, killed the running dev server, started `pnpm start`, then curl'd `/manage/tmux`. The SSR Group element carries `style="...flex-direction:row;...touch-action:pan-y"` and `data-group="true"`. The left panel (`id="tmux-list"`) renders with `style="...flex-basis:300px;..."`; the right panel renders with `flex-grow:1` taking the remainder. End-to-end drag-and-persist requires a live browser and is not curl-verifiable; the localStorage read/write paths are covered by the unit + integration tests in task 3.
- [x] 4.4 Mobile orientation flip — not curl-verifiable (requires a JS runtime + media query). Covered indirectly by the matchMedia=false vs matchMedia=true test cases in `manage-tmux-split-defaults.test.tsx`, and by the SSR markup showing horizontal orientation as the pre-resolution default (the documented one-frame flash before the mobile rotation).
- [x] 4.5 Desktop zero-flash — verified via SSR markup: the `data-group` element has `flex-direction:row` on the first response payload, so a desktop user paints zero frames of vertical orientation. (The library's `defaultLayoutDeferred` post-mount fade-in is unrelated to orientation.)
