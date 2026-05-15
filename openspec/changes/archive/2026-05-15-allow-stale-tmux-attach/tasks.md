## 1. UI: unblock stale rows in `/manage/tmux` (client-only)

- [x] 1.1 In `apps/web/app/manage/tmux/tmux-page.client.tsx`, modify `popupUrl(row)`:
  - Remove the `if (row.staleReason === null)` gate that returns `null` for stale rows.
  - Stale rows SHALL return `/terminal-popup?sessionName=<encoded>&stale=<reason>`.
  - Manual rows continue to return `/terminal-popup?sessionName=<encoded>` (no `stale=` param).
  - Matchable rows continue to return the project/scope/slug/agent URL.
- [x] 1.2 In the same file, modify `SessionCard`:
  - Drop the `if (stale) return` early-outs in `handleSelect` and `handleKey` so stale rows can be selected by click and by Enter / Space.
  - Restore `role="button"`, `tabIndex={0}`, `cursor-pointer hover:bg-accent/40`, `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` for stale rows.
  - Keep `opacity-75` on stale cards.
  - Allow `selected && 'border-primary'` to apply when the stale row is the selected row (currently gated by `!stale`).
- [x] 1.3 In the same file, modify `RightPane`:
  - Drop `if (stale) return <RightPaneEmpty />`.
  - When `row.staleReason !== null`, mount `<TerminalView mode="raw" sessionName={row.sessionName} />` (the same path manual rows use today).
  - Render a one-line stale warning banner between the existing slim header bar and the iframe-host `<div className="flex flex-1 flex-col min-h-0">`. Banner shape (per the spec):
    - `<div>` with `flex items-center gap-2`, full width, amber palette (`bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200`).
    - Leading `<AlertTriangle className="size-3 shrink-0" />` icon.
    - Text: `Stale: <reason> — memon links won't resolve. ttyd is still attached.`
    - Trailing `<span className="ml-auto truncate font-mono">{row.sessionName}</span>`.
    - No close button, no `Dismiss` state.

## 2. UI: render the stale banner in `/terminal-popup`

- [x] 2.1 In `apps/web/app/terminal-popup/page.tsx`, extend the `searchParams` typing and validation to read `stale?: 'unknown-project' | 'unknown-target'`. Define a local `VALID_STALE_REASONS = ['unknown-project', 'unknown-target'] as const` and validate before pass-through. Ignore unknown values.
- [x] 2.2 In `apps/web/app/terminal-popup/terminal-popup-client.tsx`, extend the `TerminalPopupClientProps` `'raw'` variant to optionally carry `staleReason?: 'unknown-project' | 'unknown-target' | null`. When present, render the same banner shape as task 1.3 above (factor a small `StaleBanner` component used by both `tmux-page.client.tsx` and `terminal-popup-client.tsx` to keep the markup in lockstep).
- [x] 2.3 The banner SHALL NOT consume scroll space inside the iframe — wrap the page in a `flex flex-col min-h-svh` layout so the banner takes its content height and the `TerminalView` (still `fullscreen`-styled internally) takes the remainder. Re-test that the popup still renders with no banner when `stale=` is absent (the existing manual-popup case must not regress).
- [x] 2.4 The popup page's `generateMetadata` SHALL stay unchanged — title is derived from `sessionName` regardless of staleness.

## 3. Verification

- [x] 3.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 3.2 Build the prod web app per the CLAUDE.md restart sequence (kill old `pnpm start` first, then `pnpm --filter @memon/web build`, then `pnpm start`). Confirm the dev server still serves `/manage/tmux` with `200 OK`.
- [x] 3.3 With at least one stale `memon-*` tmux session present on the host (create one ad-hoc: `tmux new-session -d -s memon-claude-doesnotexist--run--foo-260101-000000`), perform the F1 two-curl verification on `/manage/tmux`:
  - Confirmed the stale row's outer `<div>` carries `role="button"`, `tabindex="0"`, `cursor-pointer`, `focus-visible:ring-*`, and `opacity-75` together (one element, one class list).
  - Confirmed compiled CSS includes `.bg-amber-100` / `.text-amber-900` / `.opacity-75` / `.cursor-pointer` rules and the `--color-amber-900 / --color-amber-200` oklch tokens used by the banner palette.
  - SSR HTML for `/manage/tmux?session=<stale>` includes the banner copy ("Stale: ...", "ttyd is still attached") and `/terminal-popup?sessionName=<n>&stale=unknown-project` SSR-renders the same banner. `?sessionName=<n>` alone and `?sessionName=<n>&stale=garbage` SSR-render NO banner (preserving manual behavior).
- [x] 3.4 In a real browser, on the dashboard: SSR-side curl checks above prove the markup and CSS are correct (per CLAUDE.md F1 minimum bar). Live click-through (right-pane mount on stale click, popup open-from-row, switching to matchable clears banner, Kill clears `?session=`) needs a human in front of a browser — flagged for user verification post-merge.
- [x] 3.5 Sweep for unit/component tests that assert "stale rows are non-selectable" and update them to assert the new behavior. `grep -rn 'staleReason' apps/web/test/` returns ZERO test-side assertions about stale-row selectability (classifier tests in `tmux-discover.test.ts` are unrelated; `manage-tmux-split-defaults.test.tsx` has 17 tests covering layout only, all passing). Nothing to flip.

## 4. Spec sync

- [x] 4.1 Re-run `openspec validate allow-stale-tmux-attach --type change` after any prose edits to confirm the change still validates.
- [x] 4.2 Cross-check the CLAUDE.md "OpenSpec workflow → Keep spec in sync during apply" rule: no scope drift occurred — banner is non-dismissible per spec, no in-flight scope shifts, specs reflect the shipped behavior.
