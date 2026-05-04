## 1. Config schema and loader

- [x] 1.1 Add `AuthConfigRawSchema` (`username` optional string default `"admin"`, `password_hash` string) to `packages/core/src/schemas.ts`; extend `ConfigRawSchema` with optional top-level `auth`.
- [x] 1.2 Extend the `Config` type in `packages/core/src/types.ts` with optional `auth?: { username: string; passwordHash: string }`.
- [x] 1.3 Update `packages/core/src/config/load.ts` to surface the parsed `auth` block (snake_case → camelCase conversion); leave `cfg.auth` undefined if missing rather than throwing.
- [x] 1.4 Add tests in `packages/core/src/config/load.test.ts`: complete auth, missing auth, malformed `password_hash` type rejected with `ConfigError`.

## 2. Password hashing utility

- [x] 2.1 ~~Create `apps/web/lib/auth/scrypt.ts`~~ Created `packages/core/src/auth/scrypt.ts` directly (collapsed with task 6.2 to avoid a later move). Exports `hashPassword(plaintext): Promise<string>` and `verifyPassword(plaintext, encoded): Promise<boolean>`. Format: `scrypt$<N>$<r>$<p>$<saltB64url>$<hashB64url>`. Params `N=32768, r=8, p=1, dkLen=64, salt=randomBytes(16)`, `maxmem=64MiB` (Node default 32MiB is below scrypt's requirement).
- [x] 2.2 Use `crypto.timingSafeEqual` inside `verifyPassword`; reject malformed encoded strings with thrown `Error` (not boolean false) so misconfig is loud.
- [x] 2.3 Tests in `packages/core/src/auth/scrypt.test.ts`: round-trip hash+verify, wrong password rejected, malformed encoded string throws, two hashes of the same plaintext differ (random salt), empty plaintext rejected at hash, returns false at verify.

## 3. First-run password generation

- [x] 3.1 Create `apps/web/lib/auth/first-run.ts` exporting `ensureAuthInitialised(configPath, cfg): Promise<AuthConfig>`. Takes the already-parsed `Config` from `loadConfig` to avoid re-parsing YAML in web (drops js-yaml dep). Logic: if `cfg.auth` set → return; else read text, generate 144-bit random password, scrypt-hash, append `auth:` block as raw text (preserves comments), atomic temp+rename, write `~/.cache/memon/initial-password.txt` (0600), print stdout once.
- [x] 3.2 Detect mtime change between read and rename; abort with the documented error message.
- [x] 3.3 Wire it into `apps/web/lib/runtime.ts` so the HTTP server's bootstrap calls `ensureAuthInitialised(configPath, config)` after `loadConfig`; expose result on `Runtime.auth`.
- [x] 3.4 Tests in `apps/web/lib/auth/first-run.test.ts`: missing auth generates+persists+banner, existing auth is no-op (mtime unchanged), partial block rejected, concurrent edit detected via mtime guard, round-trip plaintext→hash verifies.

## 4. Middleware and auth-check route

- [x] 4.1 Created `apps/web/lib/auth/route-classes.ts` exporting `classify(method, pathname): 'read' | 'mutating' | 'shell'` plus `isAuthBypass(pathname)`. Default unknown is `mutating` (fail-closed).
- [x] 4.2 Created `apps/web/middleware.ts` with `runtime: 'nodejs'` (enabled `experimental.nodeMiddleware: true` in `next.config.mjs`). Decodes `Authorization: Basic`, gates by rate-limiter first, then scrypt-verifies; 401 with `WWW-Authenticate: Basic realm="memon"` on failure. Skips `/api/auth/check` and Next static asset paths.
- [x] 4.3 Created `apps/web/app/api/auth/check/route.ts` — `GET` returns `200 { ok, username }` or `401 WWW-Authenticate: Basic realm="memon"`. Rate-limited by the same shared bucket.
- [x] 4.4 Created `apps/web/middleware.test.ts`: 7 tests covering anonymous → 401, valid → next, wrong password/user → 401, /api/auth/check bypass, 429 over-limit, shared bucket with route handler.
- [x] 4.5 Created `apps/web/app/api/auth/check/route.test.ts`: 7 tests covering the matrix + body shape + 429 + per-IP isolation + XFF anti-spoof.
- [x] 4.6 Created `apps/web/lib/auth/rate-limit.ts` — token-bucket limiter (capacity 5, refill 10/60s), keyed via `clientIpFromHeaders` which uses the LAST X-Forwarded-For entry (Caddy is the trusted upstream hop). State pinned to `globalThis` so dev HMR doesn't reset it.
- [x] 4.7 Wired into both middleware and the route handler. Bucket consumed BEFORE scrypt — over-limit returns 429 with `Retry-After` and skips the expensive verify.
- [x] 4.8 Tests in `apps/web/lib/auth/rate-limit.test.ts`: 11 tests covering under/over-limit, per-IP isolation, lazy refill, capacity cap, XFF parsing, anti-spoof.

## 5. Browser-terminal integration

- [x] 5.1 Verified manager.ts spawn argv has `-i 127.0.0.1` (line 181) and contains no `-c`. Updated the file header to document the three gates explicitly.
- [x] 5.2 `route-classes.ts` covers `/api/terminal/*` as `shell`. Tested in `route-classes.test.ts` (assertions for check/start/stop/install/list/proxy/ + future paths).
- [x] 5.3 Updated `apps/web/app/api/terminal/proxy/[...path]/route.ts` HINT to include the `forward_auth` directive and the warning that without it ttyd is exposed.

## 6. CLI: `memon hash-password`

- [x] 6.1 Added `memon hash-password <plaintext>` subcommand at `packages/cli/src/commands/hash-password.ts`, wired via `index.ts`. Smoke-tested: valid input prints `scrypt$...\n` and exits 0; empty input writes `password must be non-empty\n` to stderr and exits 1.
- [x] 6.2 ~~Move~~ already created in `packages/core/src/auth/scrypt.ts` and exported from `@memon/core` (collapsed with task 2.1).
- [x] 6.3 Tests in `packages/cli/src/commands/hash-password.test.ts`: valid input prints scrypt-encoded format AND verifies; empty input → stderr + exit 1.

## 7. Config example and documentation

- [x] 7.1 Updated `config.example.yml` with a commented-out `auth:` block, rotation instructions, and the "leave commented on first install" guidance.
- [x] 7.2 Added "Production deployment" section to `README.md` with first-run flow, full Caddyfile snippet, three-gate explanation, and verification curl commands. The pre-existing "Browser terminal" section now cross-references it.
- [x] 7.3 Done as part of 5.1 — manager.ts header lists the three gates.

## 8. Live deployment cutover

- [x] 8.1 Backed up Caddyfile to `/etc/caddy/Caddyfile.bak.20260504-062210`.
- [x] 8.2 Edited the `memon-vultr.dev.mem.ac` site block. **Two corrections during deployment**: (a) wrapped directives in `route { ... }` because Caddy's default ordering puts `forward_auth` AFTER `reverse_proxy`, defeating the auth gate; (b) **removed `copy_headers Authorization`** — that directive has Authelia-style semantics (copy from forward_auth RESPONSE back to upstream request), not the "pass-through" semantics I initially expected. With it on, Caddy was deleting the client's Authorization header before forwarding to Next.js, causing 401 even with valid creds. Caddy's default already forwards Authorization to forward_auth.
- [x] 8.3 Other `*.dev.mem.ac` site blocks untouched.
- [x] 8.4 `caddy validate` clean; `systemctl reload caddy` succeeded.
- [x] 8.5 memon dev server running detached via `setsid nohup pnpm dev` (PID 17448, listening 3737).
- [x] 8.6 First-run generated password `x3eE93UNAVxpJSaHT-5PW0Lz`, written to `config.yml` (newly created — repo had only `config.example.yml`) and `~/.cache/memon/initial-password.txt` (mode 0600). **One issue caught**: the runtime's resolveConfigPath fallback wrote the auth block to `config.example.yml` first; corrected by copying example→config.yml and `git checkout config.example.yml`. Future first-run on a real install starts from `config.yml`, so this won't recur.

## 9. Verification

- [x] 9.1 `pnpm --filter @memon/web typecheck` passes (clean).
- [x] 9.2 `pnpm -r test` passes across all packages: 254 tests across core (102) + cli (8) + web (144), all green.
- [x] 9.3 Public anonymous → HTTP 401 with `WWW-Authenticate: Basic realm="memon"` ✓
- [x] 9.4 Public with creds → HTTP 200 with JSON body (196 bytes for `/api/projects`) ✓
- [x] 9.5 Public anonymous `POST /api/terminal/start` → HTTP 401 ✓ — **the prior anonymous root-shell vector is closed**
- [x] 9.6 Browser end-to-end terminal flow: user confirmed it works after the basic_auth switch (see task 8.7 below).
- [x] 9.7 README UI verification protocol: dashboard renders correctly behind auth (user smoke test).
- [x] 9.8 Final `openspec validate` clean (verified before archiving).

## 10. Post-deployment fixes (live-debug findings)

- [x] 10.1 **Caddy `forward_auth` is incompatible with WebSocket upgrades** — its auth probe is implemented as a `reverse_proxy` that consumes the `Upgrade`/`Connection` headers, leaving the subsequent ttyd `reverse_proxy` with no WS context. Browser symptom: ttyd shows "press enter to reconnect". Replaced with Caddy's native `basic_auth` directive (gates inline, no proxying, WS upgrades pass through). See design.md D9 (supersedes D7).
- [x] 10.2 **Plaintext password in `config.yml` instead of scrypt hash** — user requirement: agents need to read the password from one canonical place. Plaintext on disk is acceptable under the single-user threat model (host fs trust = auth trust). Removed scrypt module + `memon hash-password` CLI; verification is now `crypto.timingSafeEqual` on plaintext byte buffers; cache file `~/.cache/memon/initial-password.txt` is no longer written.
- [x] 10.3 **Rate limiter bumped from 5/10-per-60s to 60/60-per-60s** — original parameters were too tight for ad-hoc curl testing and full page loads. New parameters: capacity 60, refill 60/60s (1 sustained req/s/IP, 60 burst). scrypt gone, but the limiter still bounds brute-force at the cost of one timing-safe compare per attempt; against a 144-bit password, infeasible.
- [x] 10.4 **`copy_headers Authorization` removed from Caddy config** — initially included thinking it forwards client Authorization to forward_auth; actual semantics is "copy headers FROM forward_auth response back to upstream request" (Authelia-style), which clobbered the client's Authorization with empty string. Caused 401 even with valid creds. Moot after 10.1 (forward_auth removed).
- [x] 10.5 **CLAUDE.md** updated with a "Dev: HTTP API auth — curl with credentials from config.yml" section so future agents read username/password from config.yml automatically.
- [x] 10.6 **README "Production deployment" section** rewritten: basic_auth + bcrypt snippet, rotation flow, two-source-of-truth trade-off explained.
- [x] 10.7 **Spec + design** updated: auth-system spec.md (basic_auth requirement replaces forward_auth), browser-terminal delta (WS scenario rewritten for basic_auth), design.md D7 marked HISTORICAL with reversal note in D9.
- [x] 10.8 Final tests: 246 pass across core (96) + cli (6) + web (144). Typecheck clean. `openspec validate add-system-auth --type change` clean.
