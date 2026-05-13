## 1. Backend: pane-info enrichment helper + cache

- [x] 1.1 In `apps/web/lib/terminal/tmux-discover.ts`, add a new exported type:
   ```ts
   export interface TmuxPaneInfo {
     title: string | null
     currentCommand: string | null
     currentPath: string | null
   }
   ```
   and extend `TmuxSessionRow` with `pane: TmuxPaneInfo | null`.
- [x] 1.2 In the same file, add a module-internal helper
   `fetchActivePaneMap(): Promise<Map<sessionName, TmuxPaneInfo>>` that:
   - Shells out to `tmux list-panes -a -F '#{session_name}|#{window_active}|#{pane_active}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}|#{pane_title}'`.
   - Splits each stdout line on the first 6 `|` separators only, rejoining
     positions 6.. with `|` to preserve titles containing the delimiter.
   - Filters to rows where `window_active === '1' && pane_active === '1'`.
   - Truncates `pane_title` to 256 chars + `…` suffix when source > 256.
   - Replaces `\r` and `\n` in the title with a single space.
   - Returns an empty Map on any thrown error (tmux daemon down, etc).
- [x] 1.3 In the same file, add a module-internal cache pinned on
   `globalThis.__memonTmuxPaneCache` (mirrors `manager.ts`'s `getState`
   pattern). Slot shape:
   ```ts
   { at: number; map: Map<string, TmuxPaneInfo> } | null
   ```
   TTL constant: `PANE_CACHE_TTL_MS = 800`. Add a helper
   `getActivePaneMapCached()` that returns the cache when fresh,
   otherwise calls `fetchActivePaneMap`, primes the cache, and returns
   the new map. Concurrent callers SHALL share an in-flight Promise to
   avoid double shell-outs in the same tick.
- [x] 1.4 Modify `listMemonTmuxSessions` to call
   `getActivePaneMapCached()` once per invocation and attach
   `pane: paneMap.get(name) ?? null` to each row before returning.
- [x] 1.5 Add an exported `getEnrichedSession(name: string): Promise<TmuxSessionRow | null>`
   that runs the same logic for one named session: shell out to `tmux ls`
   (or reuse the existing path if cheap), find the matching row, attach
   the pane via the cache, return the enriched row or `null` if not on
   the host.
- [x] 1.6 Add an exported helper `__resetPaneCacheForTests()` that clears
   the global cache slot so unit tests can write deterministic
   assertions.

## 2. Backend: tests for enrichment helper

- [x] 2.1 In `apps/web/lib/terminal/tmux-discover.test.ts` (create if
   missing), add unit tests for the new helpers using a `spawn` mock
   that returns fixture stdout:
   - Single-pane session: row pane populated.
   - Multi-window / multi-pane session: only window_active=1 +
     pane_active=1 is picked.
   - Title containing `|`: preserved verbatim.
   - Title > 256 chars: truncated with `…`.
   - Title with `\n`: newline replaced with space.
   - `list-panes` exits non-zero: pane map empty, no throw.
   - Cache TTL: two calls within 800 ms cause one shell-out; a call
     after >800 ms causes a second shell-out.
   - Concurrent calls within the same tick share the in-flight
     Promise (one shell-out).
- [x] 2.2 Update the existing `listMemonTmuxSessions` tests (if any)
   to assert the new `pane` field is populated when the test fixture
   includes pane data, and `null` when not.

## 3. Backend: GET endpoint for single row

- [x] 3.1 In `apps/web/app/api/tmux-sessions/[name]/route.ts`, add a
   `GET` export alongside the existing `DELETE`:
   - Validate `params.name` against `^memon-[A-Za-z0-9._-]+$`. 400 on
     fail.
   - Call `getEnrichedSession(name)`.
   - Return 200 `{ row: TmuxSessionRow }` on hit.
   - Return 404 `{ error: { code: 'NOT_FOUND', message } }` on miss.
- [x] 3.2 Add tests in `apps/web/app/api/tmux-sessions/[name]/route.test.ts`:
   - 200 on existing session.
   - 404 on absent session.
   - 400 on malformed name.
   - 401 on anonymous request.
- [x] 3.3 Update `apps/web/lib/auth/route-classes.test.ts` to assert
   `classify('GET', '/api/tmux-sessions/<name>') === 'shell'`. The
   existing prefix rule should already cover this; the test guards
   against accidental rule changes.

## 4. API client + types

- [x] 4.1 In `apps/web/lib/api.ts`:
   - Add the `TmuxPaneInfo` type to the public exports.
   - Extend `TmuxSessionRow` with the optional `pane` field.
   - Add `getTmuxSession(name: string): Promise<{ row: TmuxSessionRow }>`
     that hits the new GET endpoint and throws an `ApiError` on
     non-2xx.

## 5. Frontend: /manage/tmux card + right-pane header

- [x] 5.1 In `apps/web/app/manage/tmux/tmux-page.client.tsx`:
   - Add a `PaneInfoLine` sub-component rendering the muted info line
     below the badge row. Props: `pane: TmuxPaneInfo | null`. Returns
     `null` when nothing should be shown.
   - Deny-list constant `UNINFORMATIVE_SHELLS = ['bash','zsh','sh','fish','tmux']`.
   - Render logic per spec: hide `currentCommand` when deny-listed
     AND a title is present; show `currentCommand` when no title.
     Hide the line entirely when both are absent.
   - The truncated title goes in the span; the full title goes on the
     parent card's `title` attribute so hovering the card shows the
     tooltip.
- [x] 5.2 Mount `<PaneInfoLine pane={row.pane} />` inside `SessionCard`,
   right after the existing `<div>` that renders the metadata badges,
   inside the same outer card so the click-handler stays unchanged.
- [x] 5.3 In `RightPane`, extend the slim header bar's session-name
   `<span>` to append a `· <command> · <title>` suffix when
   `row.pane` is non-null and not deny-listed-without-title. Truncate
   via CSS ellipsis; keep `Pop out` visible on one line.

## 6. Config: pane-info polling intervals

- [x] 6.1 In `packages/core/src/types.ts`:
   - Extend the `TerminalConfig` interface with:
     ```ts
     /** Recommended client poll interval (ms) when liveEntry !== null. */
     paneInfoActivePollMs: number
     /** Recommended client poll interval (ms) when liveEntry === null (no ttyd) or session missing. Must be >= paneInfoActivePollMs. */
     paneInfoIdlePollMs: number
     ```
   - Extend `DEFAULT_TERMINAL` to include `paneInfoActivePollMs: 5000`
     and `paneInfoIdlePollMs: 60_000`.
- [x] 6.2 In `packages/core/src/schemas.ts`, extend
   `TerminalConfigRawSchema` with:
   ```ts
   pane_info_active_poll_ms: z.number().int().positive().optional(),
   pane_info_idle_poll_ms: z.number().int().positive().optional(),
   ```
- [x] 6.3 In `packages/core/src/config/load.ts`:
   - Populate the new `paneInfoActivePollMs` / `paneInfoIdlePollMs`
     fields from `cfg.terminal?.pane_info_active_poll_ms` /
     `cfg.terminal?.pane_info_idle_poll_ms`, falling back to
     `DEFAULT_TERMINAL.*`.
   - Validate `paneInfoIdlePollMs >= paneInfoActivePollMs`; throw
     `ConfigError` otherwise with a message including both values.
   - Ensure the field also flows through `implicitCwdProject`'s
     `{ ...DEFAULT_TERMINAL }` spread (already correct since it
     spreads the whole object; sanity-check after the type change).
- [x] 6.4 Tests in `packages/core/src/config/load.test.ts` (or
   wherever existing terminal-config tests live):
   - Default values apply when block absent.
   - Default values apply when block present without these fields.
   - Custom values are honored.
   - Idle < active is rejected with `ConfigError`.
   - Zero or negative active rejected with `ConfigError`.
- [x] 6.5 Update `config.example.yml`: append a `terminal:` block
   (commented-out) documenting all four fields with their defaults,
   in this shape:
   ```yaml
   # Browser-terminal + tmux-inventory tuning. Every field is
   # optional; omit the block (or any field) to use the defaults
   # shown below.
   #
   # terminal:
   #   ttyd_max_concurrent: 16          # LRU cap on concurrent ttyd procs
   #   ttyd_idle_ttl_minutes: 30        # 0 disables the idle killer
   #   pane_info_active_poll_ms: 5000   # poll interval when ttyd is bound
   #   pane_info_idle_poll_ms: 60000    # poll interval otherwise; must be >= active
   ```
- [x] 6.6 Update `config.yml` (the user's local, gitignored copy):
   append the same commented `terminal:` block as 6.5 so the user
   can uncomment a line in place to override. **Do NOT** uncomment
   anything — leave every field commented at the default. This
   keeps behaviour identical until the user opts in.

## 7. Verification

- [x] 7.1 `pnpm --filter @memon/core typecheck && pnpm --filter @memon/web typecheck` both pass.
- [x] 7.2 `pnpm --filter @memon/core test && pnpm --filter @memon/web test` both pass (load.test for new validations; tmux-discover for cache + parser; route-classes; [name]/route).
- [x] 7.3 Rebuild prod per CLAUDE.md restart sequence (kill PID by
   port → rm `.next/` if needed → `pnpm --filter @memon/core build`
   (if core changed) → `pnpm --filter @memon/web build` →
   `cd apps/web && pnpm start > /tmp/memon-prod.log 2>&1 &`).
- [x] 7.4 Smoke-test `GET /api/tmux-sessions`:
   - Read credentials from `config.yml` (per CLAUDE.md).
   - `curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/api/tmux-sessions | jq '.sessions[0]'`
     → assert the row has a `pane` field with `title`,
     `currentCommand`, `currentPath` keys (any can be null).
- [x] 7.5 Smoke-test `GET /api/tmux-sessions/:name`:
   - Pick a known sessionName from 7.4.
   - `curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/api/tmux-sessions/<name>` → 200 with same shape, `row` key.
   - `curl -sS -o /dev/null -w "%{http_code}\n" -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/api/tmux-sessions/memon-manual-doesnotexist`
     → `404`.
- [x] 7.6 UI verification per CLAUDE.md two-curl protocol on `/manage/tmux`:
   - `curl ... /manage/tmux` and grep for the pane info line text (e.g.
     `data-pane-line` if we mark it, OR the leading `Activity` icon's
     `lucide-activity` class).
   - `curl ... /_next/static/css/app/layout.css?v=$(date +%s)` and
     confirm the `--background` / `--foreground` / `--muted` tokens
     are still defined.
- [ ] 7.7 Manually open `/manage/tmux` in a browser with at least one
   running `memon-claude-*` session. Confirm:
   - The pane info line appears below the badges, in muted color.
   - The Claude session shows `claude` + a title like `✻ Claude — …`.
   - A bare-shell session shows just the title (no `bash` segment) or
     nothing (when no title set).
   - Selecting the row populates the right-pane header with the same
     suffix.
   - Title overflow truncates cleanly without breaking the layout.
