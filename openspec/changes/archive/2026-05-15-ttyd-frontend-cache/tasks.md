## 1. TerminalView: add `source` prop + BroadcastChannel post on ready

- [x] 1.1 In `apps/web/components/terminal-view.tsx`, extend `TerminalViewProps` with an optional `source?: 'manage' | 'drawer' | 'popup' | 'unknown'` field (in the shared `& {…}` portion alongside `fullscreen` and `onSessionReady`). Default to `'unknown'` when reading inside the component.
- [x] 1.2 In the same file, add a module-private constant `const ATTACH_BROADCAST_CHANNEL = 'memon:terminal-attached'` and a top-level helper:
  ```ts
  function postAttached(sessionName: string, source: NonNullable<TerminalViewProps['source']>): void {
    if (typeof BroadcastChannel === 'undefined') return
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(ATTACH_BROADCAST_CHANNEL)
      channel.postMessage({ sessionName, source, attachedAt: Date.now() })
    } finally {
      channel?.close()
    }
  }
  ```
  (The per-broadcast-create-then-close pattern keeps the implementation simple and avoids module-local state. Performance is fine — we broadcast once per mount.)
- [x] 1.3 Inside `TerminalView`'s mount-lifecycle `useEffect` (the one that calls `startTerminal` / `attachTerminal` and `setPhase('ready')`), call `postAttached(res.sessionName, source ?? 'unknown')` immediately after the `setPhase('ready')` call (and after `setIframeUrl(res.url)` etc. — order within the same `.then` block is fine). Do NOT broadcast in the `.catch` branch (failed start / attach must not broadcast). Do NOT broadcast on subsequent re-renders that don't re-run the effect.
- [x] 1.4 Verify the `onSessionReady` callback contract is preserved — add the broadcast as an additional side-effect; do not replace `onSessionReady`. The two are independent surfaces (one is opt-in via prop; the other is global cache coordination).
- [x] 1.5 Add a unit test at `apps/web/components/terminal-view.test.tsx` (create the file if absent) covering: (a) successful mount fires exactly one BroadcastChannel post with the expected `{sessionName, source, attachedAt}` shape; (b) failed start fires zero posts; (c) `source` defaulting to `'unknown'` when the prop is omitted; (d) the post is skipped when `BroadcastChannel` is mocked as `undefined`. Use `vi.stubGlobal('BroadcastChannel', …)` patterns matching the surrounding test files.

## 2. Wire `source` at the three known call sites

- [x] 2.1 In `apps/web/components/terminal-drawer-provider.tsx`, locate the `<TerminalView ... />` render (or the path through which the drawer mounts the terminal) and pass `source="drawer"`. If the drawer uses `<TerminalSheet>` instead of `<TerminalView>` directly, trace down to the actual `<TerminalView>` mount and update at that boundary. Confirm by grepping that exactly one source attribution per drawer instance is emitted on mount.
- [x] 2.2 In `apps/web/app/terminal-popup/terminal-popup-client.tsx`, pass `source="popup"` to BOTH `<TerminalView>` renders (`mode='raw'` and `mode='standard'` branches; the stale-banner wrapper variant; and the bare popup variant).
- [x] 2.3 The `apps/web/app/manage/tmux/tmux-page.client.tsx` `<TerminalView>` renders are replaced by the cache stack in section 3 below — `source="manage"` is added there, not here.
- [x] 2.4 Audit other `<TerminalView>` call sites (`grep -rn 'TerminalView' apps/web/`) and confirm no production call site is left without a `source` prop. The default `'unknown'` is acceptable for any test/storybook usage; production code SHALL pass an explicit value.

## 3. /manage/tmux right pane: replace single mount with LRU cache stack

- [x] 3.1 In `apps/web/app/manage/tmux/tmux-page.client.tsx`, add a top-level constant `export const MANAGE_TMUX_CACHE_CAP = 4` near the existing `SPLIT_*` exports.
- [x] 3.2 Inside `TmuxManagePageClient`, introduce cache state:
  ```ts
  type CacheEntry = { sessionName: string; lastSeenAt: number }
  const [cache, setCache] = useState<CacheEntry[]>([])
  ```
  Cache invariants the implementation MUST maintain:
  - Each entry's `sessionName` is unique within the cache.
  - `cache.length <= MANAGE_TMUX_CACHE_CAP`.
  - `lastSeenAt` for the currently-selected entry (if cached) is the global maximum.
- [x] 3.3 Add a `useEffect` keyed on `selectedName` that updates the cache:
  - If `selectedName === null` → no-op (the cache may keep its entries; the pane just shows `RightPaneEmpty`).
  - If the cache already contains `selectedName` → bump that entry's `lastSeenAt` to `Date.now()` (in-place clone; do NOT push duplicates).
  - If the cache does NOT contain `selectedName` AND the row exists in `all` (i.e. it's actually a row we can render) → append a new `{ sessionName: selectedName, lastSeenAt: Date.now() }`. If the resulting size exceeds `MANAGE_TMUX_CACHE_CAP`, drop the entry with the oldest `lastSeenAt` AMONG THE NON-SELECTED ENTRIES.
  - Skip insertion if `selectedRow === null` (the URL points at a sessionName that doesn't currently exist) — let the existing "redirect away" effect handle the cleanup.
- [x] 3.4 Add a second `useEffect` keyed on `all` (the refetched session list) to evict cache entries whose sessionName no longer appears in `all`. This handles kill (server-side disappearance), kill from another tab, and external `tmux kill-session`.
- [x] 3.5 Update `handleRefresh` and the `killMutation.onSuccess` and `renameMutation.onSuccess` paths so that a known-removed sessionName is dropped from the cache eagerly (don't wait for the next refetch round-trip). For rename, drop the OLD name from the cache; the URL update (existing rename code) will trigger 3.3 to insert the NEW name on the next render.
- [x] 3.6 Replace the `RightPane` component implementation. The new render shape:
  ```tsx
  function RightPane({
    cache,
    rowsByName,
    selectedName,
  }: {
    cache: CacheEntry[]
    rowsByName: Map<string, TmuxSessionRow>
    selectedName: string | null
  }) {
    const selectedRow = selectedName ? rowsByName.get(selectedName) ?? null : null
    if (cache.length === 0) return <RightPaneEmpty />
    return (
      <div className="relative h-full w-full">
        {cache.map((entry) => {
          const row = rowsByName.get(entry.sessionName)
          if (!row) return null  // refetch effect will evict on next tick
          const isVisible = entry.sessionName === selectedName
          return (
            <div
              key={entry.sessionName}
              className={cn(
                'absolute inset-0 flex flex-col',
                isVisible ? '' : 'hidden',
              )}
            >
              <CachedTerminalView row={row} />
            </div>
          )
        })}
        {selectedRow === null && <RightPaneEmpty />}
      </div>
    )
  }
  ```
  Notes:
  - Each cached entry SHALL include the existing right-pane chrome (header bar with `sessionName + paneCmd + paneTitle`, `Pop out` button, `<StaleBanner>` if applicable). Extract the previous `RightPane` body into a `CachedTerminalView` (or inline equivalent) so each cached entry renders the same chrome.
  - The `<TerminalView>` mount inside `CachedTerminalView` SHALL pass `source="manage"`.
  - The `key={entry.sessionName}` is critical — React MUST treat each cached entry as a stable instance so the iframe is preserved across visibility flips.
- [x] 3.7 Update `TmuxManagePageClient`'s render to pass the new `cache` and `rowsByName` props instead of the old `row` prop:
  ```tsx
  <RightPane cache={cache} rowsByName={allByName} selectedName={selectedName} />
  ```
  Reuse the existing `allByName` memo.
- [x] 3.8 Verify that `selectedRow`-derived UI elsewhere (e.g. there is no other consumer of the old `selectedRow` outside the right pane in the current code; double-check) is unaffected.

## 4. /manage/tmux: BroadcastChannel listener for cross-page release

- [x] 4.1 Inside `TmuxManagePageClient`, add a `useRef<string | null>(null)` for `selectedName` and update it in a `useEffect([selectedName])` so the listener can read the latest value without re-subscribing on every selection change. Pattern:
  ```ts
  const selectedNameRef = useRef<string | null>(null)
  useEffect(() => { selectedNameRef.current = selectedName }, [selectedName])
  ```
- [x] 4.2 Add a `useEffect([])` (mount-only) that subscribes to `BroadcastChannel('memon:terminal-attached')`:
  - Guard with `if (typeof BroadcastChannel === 'undefined') return` — no-op on unsupported browsers.
  - Inside the message handler:
    - Validate the message shape minimally (`typeof data?.sessionName === 'string'`, `typeof data?.source === 'string'`); discard otherwise.
    - If `data.sessionName === selectedNameRef.current` → no-op.
    - Else `setCache((prev) => prev.filter((e) => e.sessionName !== data.sessionName))` — drop the entry if present; no-op if not.
  - Cleanup: `channel.close()`.
- [x] 4.3 Verify the ordering guarantee: when the page selects a fresh row, `selectedName` updates first (via `writeSelection`), the right pane re-renders with the new entry mounted, the new `<TerminalView>` reaches `ready`, and the broadcast fires. By that point `selectedNameRef.current === newName`, so the self-broadcast is correctly a no-op. If timing tests show otherwise, switch the listener to read `selectedName` via a closure in a `useEffect([selectedName])` re-subscribe pattern.

## 5. UI: per-cache-entry chrome

- [x] 5.1 Confirm the cached entry chrome renders correctly when its row data updates between refetches (e.g. pane title changes, ttyd lastActiveAt bumps). The `rowsByName.get(entry.sessionName)` lookup SHALL re-pick the latest row record on every render so the header line stays in sync — even for cached-but-hidden entries (cheap because they're `display: none`). Do NOT capture the row at first selection.
- [x] 5.2 Visually verify the `StaleBanner` renders correctly for the cached entry (and only when the entry's row.staleReason !== null at render time).

## 6. Verification

- [x] 6.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 6.2 Build the prod web app (kill old `pnpm start` → `pnpm --filter @memon/web build` → `pnpm start`). Confirm `/manage/tmux` returns 200.
- [x] 6.3 With at least three matchable `memon-*` tmux sessions on the host, perform the F1 two-curl verification:
  - Fetch `/manage/tmux` and grep the HTML for the right-pane container shape — confirm at least the expected `<div class="relative h-full w-full">` wrapper exists when no session is selected (cache empty → `RightPaneEmpty` rendered as today).
  - After clicking three rows in the browser, refetch the served HTML for the page and confirm three iframes are present in the DOM with two of them carrying the `hidden` Tailwind class (only one visible).
  - Confirm compiled CSS includes the `display: none` rule for `.hidden` and that no new theme tokens are referenced beyond what's already defined.
- [x] 6.4 Real-browser interactive checks (Chromium, ttyd locally available):
  - **Cache hit**: Click row A, wait for terminal, click row B (new), wait, click row A again. Confirm A's terminal appears instantly with NO `starting ttyd…` loader, NO new POST `/api/terminal/start` (verify in DevTools Network).
  - **LRU eviction**: Click rows A, B, C, D, E in sequence. Confirm A's iframe is removed from the DOM after E is selected (DevTools Elements shows 4 iframes total).
  - **Kill releases cache**: With A, B, C cached and B selected, click Kill on row A. After the row disappears (~5s refetch), confirm A's iframe is removed from the DOM.
  - **Rename releases cache**: With A, B cached and A selected, rename A to a new name. Confirm the old-name iframe is removed and the new-name iframe appears as the visible entry.
  - **Popup release**: With A, B cached and A selected, click `Open in popup` on row B. Confirm B's iframe in the manage page right pane is unmounted (DevTools shows one fewer iframe). Subsequently re-clicking B on the manage page is a fresh mount (cache miss) — see a `starting ttyd…` flash, then it's cached again.
  - **Selected-not-evicted on broadcast**: With A selected, click `Open in popup` on row A. Confirm A's iframe in the manage page right pane STAYS mounted and STAYS visible (no flicker). Both iframes show the same terminal content (verify by typing in the popup — text echoes to both).
  - **Two manage-page tabs**: Open `/manage/tmux` in two tabs. Cache rows differently. Confirm the cross-tab broadcast eviction matches the spec scenario (T1 selecting C broadcasts, T2 doesn't have C, no-op; T2 selecting B broadcasts, T1 has B as cached-not-selected, T1 evicts B).
- [x] 6.5 Run `pnpm --filter @memon/web test apps/web/components/terminal-view.test.tsx` — broadcast unit tests pass.
- [x] 6.6 If a browser-level integration test exists for `/manage/tmux` (search `apps/web/test/browser/`), add a case for cache-hit-no-attach-fires. If no such suite exists for this page, document the manual checks above as the verification baseline.

## 7. Spec sync

- [x] 7.1 Re-run `openspec validate ttyd-frontend-cache --type change --strict` after any prose edits — must be clean.
