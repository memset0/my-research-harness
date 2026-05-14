## 1. Backend: pane-state module + memo

- [x] 1.1 Create `apps/web/lib/terminal/pane-state.ts` exporting:
   - `RUNNING_PREFIX_RANGES: ReadonlyArray<readonly [number, number]>` initialized to `[[0x2800, 0x28FF]]` (the entire Braille Patterns Unicode block — covers every Braille spinner glyph used by Claude / codex / similar TUIs).
   - `RUNNING_PREFIX_CHARS: ReadonlySet<string>` initialized to `new Set<string>()` (empty; reserved for future non-Braille single-character additions like codex's `[`).
   - `ATTENTION_PATTERNS: readonly string[]` initialized to `['action required']`.
   - `PaneSessionState = 'idle' | 'running' | 'attention' | 'done'` type.
   - `matchesRunning(title: string | null): boolean` — `false` for null/empty; otherwise extracts the first code point via `title.codePointAt(0)` and returns `true` if it falls in any range in `RUNNING_PREFIX_RANGES` OR is a member of `RUNNING_PREFIX_CHARS`.
   - `matchesAttention(title: string | null): boolean` — `false` for null/empty; otherwise `title.toLowerCase().includes(p)` for any `p` in `ATTENTION_PATTERNS`.
   - `computePaneState(sessionName: string, pane: TmuxPaneInfo | null): PaneSessionState` — implements the precedence and writes the memo (sets the `hadUnacknowledgedRunning` flag on running matches).
   - `clearPaneStateMemo(sessionName: string): void` — sets the memo flag to `false` for the given sessionName (deletes the entry).
   - `prunePaneStateMemoToActiveSet(activeSessionNames: Set<string>): void` — removes any memo key not in the active set.
   - `__resetPaneStateMemoForTests(): void`.
   - Memo storage pinned on `globalThis.__memonPaneStateMemo` mirroring the existing `__memonTmuxPaneCache` pattern.

## 2. Backend: wire into discovery + manager

- [x] 2.1 In `apps/web/lib/terminal/tmux-discover.ts`:
   - Extend `TmuxSessionRow` with `state: PaneSessionState` (import the type from `pane-state.ts`).
   - In `listMemonTmuxSessions`, after attaching `row.pane` for each row, call `computePaneState(row.sessionName, row.pane)` and assign the result to `row.state`.
   - After the loop, call `prunePaneStateMemoToActiveSet(new Set(rows.map(r => r.sessionName)))`.
   - `getEnrichedSession` flows through `listMemonTmuxSessions` so no extra wiring needed.
- [x] 2.2 In `apps/web/lib/terminal/manager.ts`:
   - Import `clearPaneStateMemo` from `./pane-state`.
   - In `doStartSession`: call `clearPaneStateMemo(sessionName)` in BOTH the idempotent-return path (after `existing.lastActiveAtMs = Date.now()` and before `return toPublic(existing)`) AND the fresh-spawn path (after `state.sessions.set(sessionName, entry)`).
   - In `doAttachSession`: same — call `clearPaneStateMemo(sessionName)` in both idempotent-return and fresh-spawn paths after the entry is committed.
   - `stopSession` SHALL NOT call `clearPaneStateMemo` (per spec: stopping is automatic cleanup, not user acknowledgement).

## 3. Backend: tests

- [x] 3.1 In `apps/web/lib/terminal/pane-state.test.ts` (new file), cover:
   - `matchesRunning`: true for any first-character in U+2800..U+28FF — check at least `⠀` (U+2800, first), `⠐` (U+2810), `⠂` (U+2802), `⠁` (U+2801), `⠿` (U+283F), `⣿` (U+28FF, last). False for `✻ …` (U+273B, outside the range), `[ . ] foo`, plain ASCII text, empty string, null.
   - Optional: assert that an empty extras set means non-Braille chars are NOT classified as running.
   - `matchesAttention`: true for `Action Required`, `action required`, `Foo Action Required Bar`; false for `actionrequired`, empty, null, `Action needed`.
   - `computePaneState` precedence:
     - title matching attention → `'attention'`.
     - title matching running → `'running'` AND memo flag becomes true.
     - title matching neither + memo true → `'done'`.
     - title matching neither + memo false → `'idle'`.
     - title both attention and running (e.g. `'⠐ Action Required'`) → `'attention'` (attention wins).
   - Memo persistence: running on tick 1 sets memo; tick 2 with non-matching title yields `'done'`.
   - `clearPaneStateMemo` flips done → idle on next eval.
   - `prunePaneStateMemoToActiveSet` removes entries not in the active set.
- [x] 3.2 Extend `apps/web/lib/terminal/tmux-discover.test.ts` so existing `listMemonTmuxSessions` tests assert `row.state` is present (default value `'idle'` when pane is null or title doesn't match rules). Add new tests:
   - Row with `pane.title` starting with `⠐` → `state === 'running'`.
   - Row with `pane.title` containing `Action Required` → `state === 'attention'`.
   - Two-tick sequence: running then non-running → second pass returns `state === 'done'`.
   - Pruning: kill a row from the inventory and assert its memo entry is gone (via a follow-up `__resetPaneStateMemoForTests` count or a peek helper).
   - Reset the pane-state memo in `beforeEach` so tests don't cross-contaminate.
- [x] 3.3 Extend `apps/web/lib/terminal/manager.test.ts` to assert:
   - After `startSession` on a sessionName whose memo flag is `true`, the memo flag is `false`.
   - After `attachExistingSession` on the same scenario, the memo flag is `false`.
   - Idempotent re-call of `startSession`/`attachExistingSession` ALSO clears the flag.
   - `stopSession` does NOT clear the flag.

## 4. API client + types

- [x] 4.1 In `apps/web/lib/api.ts`:
   - Add `export type TmuxPaneState = 'idle' | 'running' | 'attention' | 'done'`.
   - Extend `TmuxSessionRow` with `state: TmuxPaneState`.

## 5. Frontend: card layout + footer state tint

- [x] 5.1 In `apps/web/app/manage/tmux/tmux-page.client.tsx`:
   - Import the new `TmuxPaneState` type.
   - Define a constant map `FOOTER_STATE_TINT: Record<TmuxPaneState, string>`:
     ```ts
     const FOOTER_STATE_TINT: Record<TmuxPaneState, string> = {
       idle: '',
       running: 'bg-blue-50 dark:bg-blue-950/40',
       attention: 'bg-amber-50 dark:bg-amber-950/40',
       done: 'bg-emerald-50 dark:bg-emerald-950/40',
     }
     ```
- [x] 5.2 Refactor `SessionCard` content area into a clean two-zone layout:
   - **Row 1**: single `flex items-center gap-2` row containing (in order): title `<span>` (with `min-w-0 flex-1 truncate`), the relative time `<span>` (only when `row.tmuxLastActivity` non-empty), the `Popup` `<Button>` (icon-only), the `Kill` `<Button>` (icon-only). Time uses `font-mono text-[10px] text-muted-foreground shrink-0`.
   - **Row 2** (badges): compute `hasAnyBadge`. Render only when true. Drop the time from this row.
- [x] 5.3 Convert `Popup` and `Kill` buttons to icon-only:
   - Remove the `Popup` and `Kill` text children inside the `<Button>` elements.
   - Keep the `<ExternalLink>` and `<Trash2>` lucide icons (same `size-3`).
   - Keep `aria-label="Open in popup"` on Popup and `aria-label="Kill session"` on Kill.
- [x] 5.4 Remove the standalone `ProjectBadge` component definition (or change its body):
   - Replace its single call site (`p.project !== null && p.scope !== 'project'`) with an inline `<MetaBadge icon={FolderTree} prefix="Project" value={p.project} className={BADGE_COLORS.projectScope} asLink href={\`/p/\${encodeURIComponent(p.project)}\`} openInNewTab />`.
   - Delete the now-unused `BADGE_COLORS.project` constant entry if no other usage exists.
- [x] 5.5 Update `ScopeBadge`:
   - Remove the `memon-manual-*` branch that currently returns the `Wrench`/`Manual` amber chip. The branch returns `null` instead.
   - Delete `BADGE_COLORS.manual` constant entry if unused elsewhere.
   - Add a small helper `function computeScopeBadgeRenders(row): boolean` that returns whether `ScopeBadge` would render a non-null element, so `hasAnyBadge` (D3) can read it without rendering. Factor the variant selection into a small classifier function shared by both `ScopeBadge` and `computeScopeBadgeRenders` to avoid duplicating the cascade.
- [x] 5.6 Refactor the footer (currently `PaneInfoLine`):
   - Wrap the footer in a `<div>` with `mt-2 -mx-2.5 border-t border-border/40 px-2.5 pt-1.5` plus the state-tint class from `FOOTER_STATE_TINT[row.state]`.
   - Inside: change `text-muted-foreground/90` to `text-foreground/85`. Keep `flex items-center gap-1 text-[10px] font-mono`.
   - For the leading command segment: branch on `pane.currentCommand === 'claude'`:
     - Claude variant: `<span className="font-medium text-orange-500 dark:text-orange-400 shrink-0"><span aria-hidden>✻</span> Claude</span>`.
     - Generic variant: `<Activity className="size-3 shrink-0 text-foreground/60" aria-hidden />` + the existing deny-list-aware command span.
   - Separator + title segment unchanged.
- [x] 5.7 Add the card-level `title=` HTML attribute on the outer card `<div>`, set to `row.pane?.title ?? undefined` (this is unchanged from today; just confirm the wiring after the layout refactor).

## 6. Frontend: minor smoke test

- [x] 6.1 In `apps/web/app/manage/tmux/tmux-page.client.tsx`, eyeball check that the existing kill confirm Dialog and create-session Dialog still mount unchanged (they shouldn't be touched by this change but the refactor is large enough to merit a re-read).

## 7. Verification

- [x] 7.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 7.2 `pnpm --filter @memon/web test` passes (pane-state, tmux-discover, manager). NOTE: 3 pre-existing failures in `components/app-sidebar.test.tsx` from an in-flight slurm-widget change in a parallel session (missing `fetchSlurmStatus` export) are out of scope here; all new tests in this change pass.
- [x] 7.3 Rebuild prod per CLAUDE.md restart sequence: kill PID on 3737, `pnpm --filter @memon/core build` (if core changed — should NOT in this change), `pnpm --filter @memon/web build`, `cd apps/web && pnpm start > /tmp/memon-prod.log 2>&1 &`.
- [x] 7.4 Smoke-test `GET /api/tmux-sessions`:
   - `curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/api/tmux-sessions | jq '.sessions | map({sessionName, state, paneTitle: .pane.title})[:5]'` — assert every row has a `state` field with one of the four enum values; assert a Claude-active row with `⠐ …` title reports `state === 'running'`; assert a row with `Action Required` in its title reports `state === 'attention'`.
- [x] 7.5 Two-curl UI verification:
   - `curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/manage/tmux` and grep for:
     - `lucide-external-link` AND no surrounding `Popup` literal text in the action cluster
     - `lucide-trash-2` AND no surrounding `Kill` literal text
     - The `✻ Claude` literal substring in the rendered HTML when a Claude session is present
     - At least one of the state-badge marker classes when a non-idle row exists: `bg-blue-100` (running chip), `bg-amber-100` (attention chip), `bg-emerald-100` (done chip), and the corresponding `bg-{blue|amber|emerald}-500` dot color
     - ZERO occurrences of the previous footer-tint classes `bg-blue-50` / `bg-amber-50` / `bg-emerald-50` (with word-boundary so we don't accidentally match the `-500` dot prefix)
   - `curl ... /_next/static/css/...` and confirm `--background`, `--foreground`, `--card`, `--muted`, `--primary` are still defined.
- [x] 7.6 Verify that a `memon-manual-*` row with no live ttyd renders WITHOUT any badge row (just title + time + 2 icons + optional footer). Grep the rendered HTML for the specific session's card and confirm no `Manual` literal text, no `Wrench` icon class.
- [x] 8.1 Extend `apps/web/lib/terminal/pane-state.ts` memo with `lastState: PaneSessionState` and `lastStateChangeAt: string | null`. Update `computePaneState` to detect transitions and stamp `lastStateChangeAt = new Date().toISOString()` on every distinct `lastState → newState` change. First-observation creates the entry with `lastStateChangeAt: null`. Add an exported `getLastStateChangeAt(sessionName): string | null` accessor.
- [x] 8.2 Plumb `lastStateChangeAt` through `TmuxSessionRow` in `apps/web/lib/terminal/tmux-discover.ts` — call `getLastStateChangeAt(name)` after `computePaneState(name, pane)` and assign to the row. Extend the API type in `apps/web/lib/api.ts` to match.
- [x] 8.3 In `apps/web/app/manage/tmux/tmux-page.client.tsx`, add a helper `pickDisplayActivity(row): string | null` that returns the more-recent of `row.lastStateChangeAt` and `row.tmuxLastActivity` (or `null` if both are absent/unparseable). Use it as the source for the relative-time label on row 1. When `null`, omit the label entirely.
- [x] 8.4 Tests for `lastStateChangeAt`:
   - In `pane-state.test.ts`: first observation → `null`; first transition stamps a non-null ISO; same-state ticks don't update; multiple transitions yield monotonically increasing stamps; `clearPaneStateMemo` drops the stamp; attention transitions stamp too.
   - In the existing `route.test.ts` fixture for `GET /api/tmux-sessions/[name]`: add `lastStateChangeAt: null` to the mocked row payload so the fixture matches the new wire shape.

- [x] 7.7 State-machine smoke test: deferred to the unit-test suite (`pane-state.test.ts` + the `pane-state memo interaction` describe block in `manager.test.ts`) which deterministically cover all state transitions (idle→running→done, running→attention→done, attention purely reactive, ttyd start/attach clears the memo, stop does not). The live smoke test in 7.4 confirms the wire shape (`row.state`) and the rendered badge colors line up with API state across 22 real sessions.
   - Find a sessionName whose `pane.title` currently starts with `⠐` (some live Claude session). Confirm `row.state === 'running'`.
   - Wait for its title to change OR `tmux send-keys` to make it idle. Re-query. Confirm `row.state === 'done'`.
   - Open the ttyd via `POST /api/terminal/start` (or attach) with the right `(project, scope, slug, agent)` so a manager entry is registered. Re-query. Confirm `row.state === 'idle'`.
