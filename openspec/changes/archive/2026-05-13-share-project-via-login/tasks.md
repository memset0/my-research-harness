## 1. Config schema and first-run session secret

- [x] 1.1 Extend `AuthConfig` in `packages/core/src/config/types.ts` with optional `session_secret: string`.
- [x] 1.2 Update `packages/core/src/config/load.ts` to parse and validate `auth.session_secret` (44-char base64url when present; reject malformed).
- [x] 1.3 Add `ensureSessionSecret(cfg, configPath)` helper that generates `crypto.randomBytes(32)` base64url and appends to `auth:` block via the existing atomic temp-file + rename path (mirroring `ensureFirstRunPassword`).
- [x] 1.4 Wire `ensureSessionSecret` into `memon serve` startup (same call site as first-run password gen). Both first-run paths SHALL coalesce into one rewrite when both are needed.
- [x] 1.5 Tests: config-load parses `session_secret`; first-run gen for missing secret only; first-run gen for both password and secret coalesces into one rewrite; mtime-collision aborts cleanly.

## 2. Cookie sign/verify primitives

- [x] 2.1 Create `apps/web/lib/auth/cookies.ts` with:
  - `signSessionCookie(payload, secret) -> string` — produces `base64url(JSON.canonical({payload, sig: HMAC(secret, canonicalJSON(payload))}))`.
  - `verifySessionCookie(cookieValue, secret) -> payload | null`.
  - `signSharesCookie(entries, secret) -> string` / `verifySharesCookie(cookieValue, secret) -> entries | null`.
  - Canonical JSON helper (deterministic key ordering).
- [x] 2.2 Use `crypto.timingSafeEqual` on equal-length buffers in `verify*`; constant-time compare; return null on any failure.
- [x] 2.3 Tests: round-trip sign/verify; tampered payload fails; wrong secret fails; malformed base64url fails; empty cookie returns null.

## 3. `@memon/core` shares module

- [x] 3.1 Create `packages/core/src/shares/types.ts` with `ShareRecord` (TS type matching the JSON schema in project-share spec) and `SharesFile` wrapper (`{ version: 1, shares: ShareRecord[] }`).
- [x] 3.2 Create `packages/core/src/shares/paths.ts` with `sharesPath(projectRoot)` that returns `<projectRoot>/.memon/shares.json` and asserts the result is within projectRoot (mirroring the existing `fs-version/paths.ts` pattern).
- [x] 3.3 Create `packages/core/src/shares/read.ts` with `readShares(projectRoot): Promise<SharesFile>`. Returns `{ version: 1, shares: [] }` if file missing; throws `ShareStoreError` on malformed JSON or schema failure.
- [x] 3.4 Create `packages/core/src/shares/write.ts` with `writeShares(projectRoot, file)` doing atomic temp-file + rename, creating `.memon/` if absent (mode 0755), file mode 0644.
- [x] 3.5 Create `packages/core/src/shares/manage.ts` with high-level helpers:
  - `addShare(projectRoot, { label?, expires? }): Promise<ShareRecord>` — generates `id` (`shr_<8b64>`), `token` (24b64 from `crypto.randomBytes(18)`), `created_at` ISO8601+TZ, computes `expires_at` from `expires` duration string (`<int>d`, `<int>h`, `never`) or null; retries up to 5x on `id` collision; appends + writes.
  - `revokeShare(projectRoot, idOrLabel, { force? }): Promise<ShareRecord>` — id-prefix-or-exact-label match; throws `AmbiguousShareError` or `ShareNotFoundError` per spec.
  - `validateShare(projectRoot, token): Promise<ShareRecord | null>` — constant-time token compare across the array; respects `expires_at`.
- [x] 3.6 Re-export from `packages/core/src/index.ts` so the CLI can import.
- [x] 3.7 Tests: read of missing file returns empty; read of malformed throws; addShare round-trip; addShare id-collision retry; revokeShare unique / ambiguous / not-found; validateShare expired / valid / not-found; atomic write parity (no torn reads under concurrent reader).

## 4. Route classification extension

- [x] 4.1 Update `apps/web/lib/auth/route-classes.ts`:
  - Add `'anon'` to `RouteClass` union.
  - Extend each `RouteRule` with `projectFor?: ProjectExtractor` returning project name | `'multi'` | `'global'` | `null`.
  - Add the `anon` classifications: `GET /login`, `POST /api/auth/login`, `GET /share/<project>/<token>`. (`GET /api/auth/check` already bypasses; keep that path but classify as `anon` for symmetry.)
  - Add `projectFor` extractors per the spec's enumeration: `/p/<project>`, `/e/<project>/<exp>`, `/api/projects?`, `/api/projects/<project>`, `/api/runs?project=`, `/api/runs/<id>` (RunIndex lookup), `/api/experiments?project=` / `<id>` (ExperimentIndex), `/api/digests?project=` / `<id>` (DigestStore), `/api/reports?project=` / `<id>` (ReportStore), `/api/anomalies` (P or `'multi'`), `/api/events` (`'multi'`), `/api/log?path=` (path → project resolution), `/api/readme?path=`, `/api/hypotheses?project=`, `/api/journal?project=`, `/api/log-files?project=`, `/api/runtime/health` (`'global'`).
  - Classify `GET / POST / DELETE /api/projects/<project>/shares*` as owner-only (treat as `mutating` for viewer purposes, even GET).
  - Update `classify()` to return `{class, projectFor}`; preserve fail-closed defaults (`mutating` + `null`).
- [x] 4.2 Add a path-to-project helper that consumes `cfg.projects` to map an absolute or relative path argument to a configured project name; use it from the `/api/log?path=` and `/api/readme?path=` extractors.
- [x] 4.3 Add the in-memory id-resolution helpers that consult `RunIndex`, `ExperimentIndex`, `DigestStore`, `ReportStore` synchronously (the indices already live in the runtime cache).
- [x] 4.4 Tests: every classification + extractor combination has a unit test asserting the expected `{class, project}` for representative inputs; new-route smoke test enumerates `apps/web/app/api/**/route.ts` and FAILS the build for any route lacking an explicit rule.

## 5. Middleware rewrite — three-mode evaluator with scope policy

- [x] 5.1 Refactor `apps/web/middleware.ts` to:
  - Look up the route's `{class, projectFor}` from `route-classes.ts`.
  - If class is `anon`: rate-limit but allow without identity; proceed.
  - Otherwise consume one rate-limit token (existing behavior preserved).
  - Evaluate mode 1 (cookie): `verifySessionCookie(req.cookies['memon-session'], cfg.auth.session_secret)`. If valid and `role==='owner'` and `exp>now`, set `req.role='owner'`, refund token, refresh cookie with new `exp` on response, proceed to scope check.
  - Else mode 2 (Basic): existing `verifyBasic`. If valid, set `req.role='owner'`, refund token, proceed.
  - Else if `class === 'read'`, evaluate mode 3 (share cookie): `verifySharesCookie`. For each validating entry, check `validateShare(projectRoot(entry.project), entry.token)`. Collect validating projects into `scopeProjects`. If `scopeProjects` is non-empty, set `req.role='viewer'`, set `req.scopeProjects`, refund token, schedule a refresh-write cookie if stale entries were pruned, proceed to scope check.
  - For `shell` and `mutating` routes, DO NOT evaluate mode 3 — skip directly to anon handling.
  - Anon handling: HTML pages → 302 to `/login?next=<encoded-path>`; API → 401 with `WWW-Authenticate: Basic realm="memon"`. Rate-limit token NOT refunded.
- [x] 5.2 Scope check policy (after identity is set):
  - `class==='read'` + owner: pass.
  - `class==='read'` + viewer: pass if `projectFor` returns a string in `scopeProjects` OR `'multi'`. Else 403 with short body `Project not in your share scope`.
  - `class==='mutating'` + owner: pass.
  - `class==='shell'` + owner: pass.
  - (Viewer cells for `mutating` and `shell` are N/A — mode 3 isn't evaluated; those requests bottom out in anon handling above.)
- [x] 5.3 Inject `{role, scopeProjects}` into the request context so handlers can read them (use Next.js response headers `x-memon-role`/`x-memon-scope` on the rewritten request, OR a request-context helper exported from `lib/auth/context.ts`).
- [x] 5.4 Tests: three-mode matrix (anon, cookie-only, Basic-only, share-cookie-only, cookie+share, Basic+share, all-three, invalid-cookie+Basic, expired-cookie+share, invalid-share-only); scope matrix per route class; 401-vs-403 distinction (HTML 302, API 401, viewer-on-mutating 403); rate-limit shared bucket across all three modes; session refresh on each authenticated request.

## 6. WebSocket upgrade gate update

- [x] 6.1 Update `apps/web/server.ts`'s `/api/terminal/proxy/*` upgrade handler to evaluate modes 1+2 only — do NOT decode `memon-shares`:
  - Cookie verify first, then Basic. Either succeeds → forward to ttyd; refund rate-limit token.
  - Neither succeeds → respond 401 with `WWW-Authenticate: Basic realm="memon"` raw HTTP and destroy socket; do NOT refund.
  - Presence/absence of `memon-shares` cookie is irrelevant and SHALL NOT be inspected.
- [x] 6.2 Tests: anon upgrade rejected with 401; owner-cookie upgrade returns 101; owner-Basic upgrade returns 101; viewer-cookie-only upgrade rejected with 401 (cookie NOT decoded — confirm by asserting no `shares.json` read happens during the upgrade); brute-force across upgrade + middleware shares one bucket.

## 7. Login / logout endpoints and `/login` page

- [x] 7.1 Create `apps/web/app/login/page.tsx` rendering a shadcn `<Card>` + `<Input>` + `<Button>` login form. Reads `?next=` and embeds as a hidden field. Pre-fills username = `admin` and focuses it. Re-renders with an `Invalid credentials` banner if the URL has `?error=1`.
- [x] 7.2 Create `apps/web/app/api/auth/login/route.ts` (POST) that:
  - Consumes one rate-limit token; parses `application/x-www-form-urlencoded` body; validates `username`/`password` against `cfg.auth.*` via constant-time compare.
  - On success: `signSessionCookie({v:1, role:'owner', iat, exp: iat+30d}, cfg.auth.session_secret)`. Sets `memon-session` cookie (HTTPOnly, SameSite=Lax, Path=/, Max-Age=30d, Secure when `req.url` is https). Refunds rate-limit token. Validates `?next` (must start with `/` and not `/api/auth/`); 302 to `next` else `/`.
  - On failure: respond 401 (HTML 302 to `/login?error=1&next=<next>` or JSON `{ ok: false }` based on Accept).
- [x] 7.3 Create `apps/web/app/api/auth/logout/route.ts` (POST) that requires owner identity (returns 401/403 otherwise), clears `memon-session` (`Max-Age=0`), preserves `memon-shares`, 302 to `/login`.
- [x] 7.4 Tests: GET /login renders 200 anon; POST valid creds sets cookie, 302; POST bad creds 401 with no cookie; rate-limit drain on bad attempts; rate-limit refund on success; `?next` validation rejects external URLs and `/api/auth/*`; logout clears session, preserves shares.

## 8. Share-landing route

- [x] 8.1 Create `apps/web/app/share/[project]/[token]/page.tsx` (server component) that:
  - Consumes one rate-limit token.
  - Validates `[project]` is configured (via `cfg.projects` lookup). If not, render the generic 404 page (do NOT reveal whether the project is unknown vs token wrong).
  - Calls `validateShare(projectRoot([project]), [token])`. If null, same 404; no refund.
  - On success: reads existing `memon-shares` cookie via `verifySharesCookie`; appends/dedups the new entry; signs new payload; sets cookie HTTPOnly, SameSite=Lax, Path=/, Max-Age=90d, Secure if https. Refunds rate-limit token. 302 to `/p/[project]`.
- [x] 8.2 Tests: valid share URL sets cookie and 302s; invalid share URL 404s; subsequent share URL appends; revisited share URL replaces entry (dedup); owner with session still gets cookie set + 302; rate-limit drain on invalid; refund on valid.

## 9. Project-shares CRUD endpoints

- [x] 9.1 Create `apps/web/app/api/projects/[project]/shares/route.ts` with:
  - `GET` — owner-only (mutating-classified for viewer denial); returns `{ shares: [{id, label, created_at, expires_at}] }` with NO `token` by default. If `?reveal=true` query, include `token` (still owner-only).
  - `POST` — owner-only; body `{ label?, expires? }`; calls `addShare`; responds 201 with full record including `token` and constructed `share_url`.
- [x] 9.2 Create `apps/web/app/api/projects/[project]/shares/[id]/route.ts` with `DELETE` — owner-only; calls `revokeShare(projectRoot, [id])`; respond 200 / 404 appropriately.
- [x] 9.3 `share_url` construction uses `cfg.public_url` if present else returns a `/share/<project>/<token>` path with a note.
- [x] 9.4 Tests: GET returns shares without tokens; POST creates and returns token; DELETE removes; viewer attempts return 403 (not 401); owner-only enforcement is via route-classes (verify the rule covers this path).

## 10. Multi-project list-handler filtering

- [x] 10.1 In `apps/web/app/api/projects/route.ts` GET handler, if `req.role === 'viewer'`, filter the returned project list to `req.scopeProjects` BEFORE responding.
- [x] 10.2 In `apps/web/app/api/anomalies/route.ts` GET handler (no `project=`), same filter.
- [x] 10.3 In `apps/web/app/api/events/route.ts` (SSE), filter outgoing `run-change`, `experiment-change`, `anomaly` events by project for viewer sessions. Establish the project key for each event from the existing payload metadata.
- [x] 10.4 Tests: viewer GET /api/projects returns only scoped names; owner returns full list; viewer SSE drops out-of-scope events; revocation mid-stream stops events for the now-revoked project on the NEXT event (in-flight stream is not killed).

## 11. CLI `memon share` subcommands

- [x] 11.1 Create `packages/cli/src/commands/share.ts` with three subcommand handlers (`create`, `list`, `revoke`) using the standard CLI conventions (default JSON, `--format human`, `--project` flag where relevant, `--force` for revoke).
- [x] 11.2 Register the subcommands in `packages/cli/src/index.ts`.
- [x] 11.3 Implement duration parsing for `--expires` (`<int>d`, `<int>h`, `never`); invalid → exit code 2.
- [x] 11.4 OMIT `token` from `memon share list` output (human + JSON); INCLUDE in `memon share create` output (JSON `token` + `share_url`; human single-line URL).
- [x] 11.5 Tests: smoke test for each subcommand covering JSON and human output; round-trip create then list then revoke; ambiguity error; not-found error; invalid duration error; unknown-project error.

## 12. UI primitives: `SessionProvider`, `useSession()`, `<ViewerGuard>`

- [x] 12.1 In `apps/web/app/layout.tsx`, server-inject a `<script id="memon-session" type="application/json">` block in `<head>` containing `{ role, scopeProjects }` derived from middleware-set request context (read via the helper from task 5.3).
- [x] 12.2 Create `apps/web/components/session-provider.tsx` exposing `SessionContext` + `<SessionProvider>` wrapper that reads the script block during hydration. Mount in the root layout above all children.
- [x] 12.3 Create `apps/web/lib/use-session.ts` exporting `useSession()` returning `{ role, scopeProjects }`; SSR-safe (reads the same data the server injected).
- [x] 12.4 Create `apps/web/components/viewer-guard.tsx` with `<ViewerGuard reason="...">` that:
  - For role==='owner': renders child unchanged.
  - For role==='viewer' or 'anon': clones child with `disabled` + `aria-disabled="true"`, suppresses click handler, wraps in shadcn `<Tooltip>` with `Viewer mode — action disabled (<reason>)`.
- [x] 12.5 Tests: hydration parity (server-injected JSON matches `useSession()` output); ViewerGuard renders enabled for owner / disabled for viewer / disabled for anon; tooltip text matches reason; click is suppressed in viewer mode.

## 13. Apply `<ViewerGuard>` to gated controls

- [x] 13.1 Wrap `EditMarkdownButton`, `EditReadmeButton`, `OpenClaudeCodeButton`, `AskClaudeCodeButton`, `TerminalButton` in their respective component files.
- [x] 13.2 Wrap `StatusEdit`, `AddNoteButton`, `AddJournalEntryButton`.
- [x] 13.3 Wrap every CRUD control in `/manage/tmux/tmux-page.client.tsx` (start, stop, attach, kill rows).
- [x] 13.4 Wrap "Create experiment" affordances, "Link" / "Unlink" experiment buttons, "Archive" / "Unarchive" buttons.
- [x] 13.5 Wrap every Warnings-table mutator (add, edit, delete row).
- [x] 13.6 Wrap the "Manage share links" / "Share" button itself.
- [x] 13.7 In `OpenWithButton`, disable the `Open Claude Code` and `Open browser terminal` tab options in viewer mode; keep `Open in editor` (path copy) enabled.
- [x] 13.8 Tests: viewer snapshot — render each page (`/`, `/p/<project>`, exp detail page, run panel, journal, hypotheses, reports, manage/tmux) and assert each enumerated control renders disabled with the correct tooltip; owner snapshot — same pages, same controls all enabled.

## 14. Sidebar scope narrowing and viewer banner

- [x] 14.1 Update `apps/web/components/app-sidebar.tsx` to read `useSession()`. For viewer: render only items for projects in `scopeProjects`; replace project switcher with `<span>` label when scope has exactly one project; hide aggregate / global nav items.
- [x] 14.2 Update `apps/web/components/app-sidebar.test.tsx` to cover the three role variants.
- [x] 14.3 Create `apps/web/components/viewer-banner.tsx` rendering a shadcn `<Alert>` with copy `Viewer mode — read-only access to <scopeProjects.join(', ')>.` and a `<Link href="/login?next=<current>">Log in as owner</Link>`. Dismissible via `sessionStorage.setItem('viewer-banner-dismissed','1')`.
- [x] 14.4 Mount the banner in the root layout, gated on `role==='viewer'`.
- [x] 14.5 Tests: banner renders for viewer; absent for owner / anon; dismiss persists for the tab only; "Log in as owner" link has the correct `?next` value.

## 15. Top-nav project selector update

- [x] 15.1 Update the project selector component (likely in `apps/web/components/app-sidebar.tsx` or a separate selector). For viewer: dropdown listing scope-set OR single read-only `<span>` when scope has exactly one project.
- [x] 15.2 Tests: owner sees full list; viewer with single scope sees label; viewer with multi-scope sees filtered dropdown.

## 16. "Manage share links" dialog

- [x] 16.1 Create `apps/web/components/manage-shares-dialog.tsx` using shadcn `<Dialog>` + `<Table>`. Columns: `Created`, `Label`, `Expires`, `Copy URL` (button calling `navigator.clipboard.writeText`), `Revoke` (button opening `<AlertDialog>` confirm).
- [x] 16.2 Add an "Issue new share" form at the bottom of the dialog: shadcn `<Input>` for label, `<Select>` for expiry (`30d`, `90d`, `never`), `<Button>`.
- [x] 16.3 Wire to `GET / POST / DELETE /api/projects/<project>/shares`. Use TanStack Query for caching; invalidate on mutation.
- [x] 16.4 On create success: toast (sonner) `Share created — URL copied`; auto-copy URL to clipboard; new row appears.
- [x] 16.5 Render an owner-only "Share" trigger `<Button>` on the project page header (`apps/web/app/p/[project]/layout.tsx` or wherever the header lives). Wrap in `<ViewerGuard>` for defense (the button SHOULD be hidden via owner-check anyway, but ViewerGuard ensures disabled fallback if a viewer reaches the page).
- [x] 16.6 Tests: dialog opens, fetches list, renders rows; create flow works; revoke flow works; viewer cannot see the trigger (or sees it disabled per ViewerGuard).

## 17. SSE filtering implementation

- [x] 17.1 Ensure the SSE event publisher emits a `project` key on every event (verify `run-change`, `experiment-change`, `anomaly` payloads carry the project; add the field if missing).
- [x] 17.2 In the SSE handler in `apps/web/app/api/events/route.ts`, filter outgoing events by `req.role === 'viewer' ? scopeProjects.has(event.project) : true`.
- [x] 17.3 Tests: viewer subscriber receives only scoped events; owner receives all; revocation mid-stream stops new events (but does not kill the connection — verified separately by integration test).

## 18. Documentation updates

- [x] 18.1 Update `CLAUDE.md` "HTTP API auth" section: clarify that Basic auth remains the curl/CLI tooling fallback; add a paragraph on the new cookie-based browser path; add a section showing how to inject a `memon-shares` cookie for viewer-mode curl inspection (use `--cookie` and the share landing URL).
- [x] 18.2 Update `README.md` "Production deployment" section with a new "Sharing a project read-only" subsection: example `memon share create` flow, share-URL distribution caveats, revocation flow.
- [x] 18.3 Update `config.example.yml` with optional `auth.session_secret: <auto-generated on first run>` placeholder and an explanatory comment.

## 19. End-to-end verification (per CLAUDE.md verification protocol)

- [x] 19.1 `pnpm --filter @memon/core typecheck && pnpm --filter @memon/web typecheck && pnpm --filter @memon/cli typecheck` all clean.
- [x] 19.2 Production build: `pnpm --filter @memon/core build && pnpm --filter @memon/web build && pnpm --filter @memon/cli build`.
- [x] 19.3 Restart memon prod server per the CLAUDE.md "kill old before clearing .next" sequence.
- [x] 19.4 Owner-mode curl smoke: `curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/api/projects` returns 200 with full project list (Basic still works).
- [x] 19.5 Owner login flow: `curl -sS -c cookies.txt -d "username=admin&password=$MEMON_PASS" http://localhost:3737/api/auth/login` sets `memon-session`; subsequent `curl -sS -b cookies.txt http://localhost:3737/api/projects` returns 200.
- [x] 19.6 Anon page request: `curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3737/p/project-a` returns 302 with `Location: /login?next=/p/project-a`.
- [x] 19.7 Anon API request: `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3737/api/projects` returns 401 with `WWW-Authenticate: Basic realm="memon"`.
- [x] 19.8 Share-create + viewer flow: `memon share create project-a --label Test --format human` prints a URL; `curl -sS -c viewer-cookies.txt -L "<share-url>"` 302s to `/p/project-a` and sets `memon-shares`. Subsequent `curl -sS -b viewer-cookies.txt http://localhost:3737/p/project-a | grep -oE '<class="memon-viewer-banner"|data-slot=...'` confirms viewer banner rendered and gated controls are `aria-disabled="true"`.
- [x] 19.9 Cross-project denial: viewer cookie for project-a attempts `curl -sS -b viewer-cookies.txt -o /dev/null -w "%{http_code}\n" http://localhost:3737/p/project-b` returns 403.
- [x] 19.10 Mutating denial: viewer cookie attempts `curl -sS -b viewer-cookies.txt -X PUT -d '{"body":"x"}' http://localhost:3737/api/experiments/<id>/readme` returns 401 with `WWW-Authenticate: Basic realm="memon"` (mode 3 not evaluated on mutating routes).
- [x] 19.11 Shell denial: viewer cookie attempts `curl -sS -b viewer-cookies.txt http://localhost:3737/api/terminal/list` returns 401 with `WWW-Authenticate: Basic realm="memon"` (mode 3 not evaluated on shell routes; share cookie is not decoded).
- [x] 19.11a Cross-project read denial (the one 403 case): viewer with scope `project-a` attempts `curl -sS -b viewer-cookies.txt -o /dev/null -w "%{http_code}\n" http://localhost:3737/p/project-b` returns 403 with NO `WWW-Authenticate` header (this is the only place 403 appears in the system).
- [x] 19.12 Compiled CSS check: `curl -sS "http://localhost:3737/_next/static/css/app/layout.css?v=$(date +%s)" | grep -E "^  --background:|^  --foreground:|^  --card:"` matches single lines (the verification protocol baseline still holds).
- [x] 19.13 Revocation flow: `memon share revoke <id-prefix> --project project-a` removes the record; subsequent viewer cookie request to `/p/project-a` 302s to `/login?next=...` (silent transition to anon).
- [x] 19.14 SSE filtering: viewer subscribes to `/api/events`; trigger an event in project-b; viewer does NOT receive it. Trigger an event in project-a; viewer receives it.
