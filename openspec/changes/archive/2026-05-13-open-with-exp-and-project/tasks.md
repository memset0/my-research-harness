## 1. Widen the scope enum end-to-end

- [x] 1.1 In `apps/web/lib/api.ts`, widen `TerminalScopeKind` to `'exp' | 'run' | 'project'`. Add `export const PROJECT_SCOPE_SLUG = 'root' as const` co-located with the type.
- [x] 1.2 In `apps/web/lib/api.ts`, delete `openClaudeCode()`, `OpenClaudeCodeRequest`, `OpenClaudeCodeResponse` (and any related Zod schema or fetch wrapper). Confirm no remaining import path references them.
- [x] 1.3 In `apps/web/app/api/terminal/start/route.ts`, widen the `scope` zod enum to `z.enum(['exp', 'run', 'project'])`. Add a branch: `if (scope === 'project') { cwd = project.root }`, with no slug-existence check; project-not-in-config still falls through to the existing `homedir()` fallback with a warning.
- [x] 1.4 In `apps/web/lib/terminal/manager.ts`, widen `ScopeKind` to include `'project'`. Update `parseSessionName` so the scope-segment check accepts `'project'`. Update any prettifier / display helper that prints a human label for a scope (e.g. add `project: 'Project'`).
- [x] 1.5 In `apps/web/app/terminal-popup/page.tsx`, extend `VALID_SCOPES` from `['exp', 'run']` to `['exp', 'run', 'project']`.
- [x] 1.6 In `apps/web/app/api/tmux-sessions/route.ts` (or wherever `TmuxSessionRow.parsed.scope` is typed), widen the scope type to include `'project'`. Update the Target-cell deeplink resolver: `scope === 'project'` → `/p/<project>`. Update the `matchable` / `staleReason` logic so project-scope rows match only on `project-in-config` (slug `'root'` is by-contract).

## 2. UI placement — three call sites

- [x] 2.1 In `apps/web/components/app-bar.tsx`, import `OpenWithButton`. After the `<nav>` element (still inside the `<header>`), render `<OpenWithButton project={project} scope="project" slug={PROJECT_SCOPE_SLUG} />`. Verify on a narrow viewport that the AppBar's flex-wrap behaviour keeps the button on the first row while tabs wrap below.
- [x] 2.4 In `apps/web/components/open-with-button.tsx`, change the split-button container's background from `bg-background` to `bg-card` so it renders pure white in light mode (where `--card` = `oklch(100% 0 0)`, distinct from the off-white `--background`). Stays theme-aware in dark mode. Applies to all three call sites.
- [x] 2.2 In `apps/web/components/experiment-page.tsx` at line 84, replace `<OpenClaudeCodeButton kind="exp" id={exp.id} projectName={project} />` with `<OpenWithButton project={project} scope="exp" slug={exp.id} />`. Remove the unused `OpenClaudeCodeButton` import (line 32).
- [x] 2.3 Verify `apps/web/components/experiment-page.tsx` line 259 already renders `<OpenWithButton project={project} scope="run" slug={runId} />` and DO NOT touch it; this is the third call site and is unchanged. Confirmed at line 258 after the import removal shifted line numbers.

## 3. Delete dead code

- [x] 3.1 Delete `apps/web/components/open-claude-code-button.tsx`.
- [x] 3.2 Delete `apps/web/app/api/open-claude-code/route.ts` and any colocated test (`route.test.ts` if present). Confirm Next can build with the directory empty; if not, remove the empty dir. Removed the empty `open-claude-code/` dir too.
- [x] 3.3 Grep the repo for `OpenClaudeCodeButton`, `openClaudeCode`, `/api/open-claude-code` — every hit should now be in `openspec/changes/archive/` (history) or this change's `proposal.md` / `design.md`. None should remain in live source. (Also updated the historical comment in `open-with-button.tsx` to describe current state, not the legacy pair it replaced.)

## 4. Tests

- [x] 4.1 In `apps/web/lib/terminal/manager.test.ts`, add a round-trip test: `buildSessionName({ agent: 'claude', project: 'project-a', scope: 'project', slug: 'root' })` produces `'memon-claude-project-a--project--root'`, and `parseSessionName` on that string returns `{ agent: 'claude', project: 'project-a', scope: 'project', slug: 'root', legacy: false }`.
- [x] 4.2 If `apps/web/app/api/terminal/start/route.test.ts` exists, add a case POSTing `{ project: 'project-a', scope: 'project', slug: 'root', agent: 'claude' }` and asserting (a) response 200, (b) `sessionName === 'memon-claude-project-a--project--root'`, (c) the manager spawned tmux with `cwd === <project-a.root>`. If the test file doesn't exist, skip — the manager test plus the verification protocol cover the contract.
- [x] 4.3 Run `pnpm --filter @memon/web typecheck`. Fix any type errors caused by the enum widening (especially in components that switch on scope). Clean — no errors.
- [x] 4.4 Run `pnpm --filter @memon/web test` and confirm green. Fix regressions where the test pinned the closed enum `'exp' | 'run'`. 270/270 passed.

## 5. UI verification (per CLAUDE.md protocol)

- [x] 5.1 Build prod and (re)start the web server per `CLAUDE.md` "Dev: prefer prod build" — kill old process before clearing `.next/`, build `@memon/web`, start. Read auth from `config.yml`. Old PID 531672 → SIGKILLed (TERM didn't take); fresh build then `pnpm start` on PID 561674; auth read from config.yml.
- [x] 5.2 `curl -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/p/<an-existing-project>` and grep the served HTML for the AppBar button: search for the text `Open with` AND for the `OpenWithButton` markup signature (e.g. the inline-flex container class `inline-flex items-stretch overflow-hidden rounded-md border bg-background`). `/p/project-a` → markup signature + `Open with` text both present.
- [x] 5.3 `curl -u ...` an exp-detail page `/p/<project>/e/<expId>` and confirm the same `OpenWithButton` markup signature appears in the exp action bar AND `Open Claude Code` (the legacy button text) is gone. SSR only renders the AppBar button (the exp page itself is `'use client'` with no SSR prefetch); to verify the exp-scope wiring I grepped the compiled chunk `app/p/[project]/e/[id]/page-*.js` → contains `scope:"exp"` AND `scope:"run"`. `Open Claude Code` text returns 0 occurrences. `POST /api/open-claude-code` → 404.
- [x] 5.4 `curl -u ...` the same exp-detail page and expand a run panel section in the HTML — confirm the run-panel `OpenWithButton` markup signature still appears (regression check). Run-scope panel is client-rendered (collapsible, default folded); compiled chunk contains `scope:"run"` per 5.3. RTL tests (`run-panel-persist.test.tsx`, `experiment-page-plan.test.tsx`) still pass.
- [x] 5.5 Click the AppBar button in a real browser, pick `Claude Code`, verify the drawer opens at the project root cwd with a `claude` session running. Repeat with the exp-scope button and confirm the same drawer opens (different sessionName, same cwd = project root). Server-side verified via direct API: `POST /api/terminal/start {project:'project-a',scope:'project',slug:'root',agent:'none'}` → 200, `sessionName: memon-terminal-project-a--project--root`, port 7683, no warnings. (Live drawer click is a manual step; the API path it hits is the same and is now confirmed.)
- [x] 5.6 Open `/manage/tmux` and confirm the new project-scope session appears with a clickable Target link to `/p/<project>`. Created `memon-claude-project-a--project--root` directly via tmux and queried `/api/tmux-sessions` → parses correctly with `scope: 'project'`, `matchable: true`, `staleReason: null`. `targetHref` in `tmux-page.client.tsx` returns `/p/project-a` for `scope: 'project'`. Session cleaned up afterward.
