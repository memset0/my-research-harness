## Context

memon ships as a Next.js 15 App Router dashboard plus a CLI, both reading the same `config.yml`. Today the dashboard is reverse-proxied via Caddy at `memon-vultr.dev.mem.ac` with **zero authentication on any layer**: no `basic_auth` in Caddy, no `middleware.ts` in Next.js, ttyd started with `--writable` and no `-c user:pass`. The Next.js process runs as **root** (per user instruction, this stays as root and is not negotiable in this change), so any anonymous HTTP visitor who calls `POST /api/terminal/start` followed by an `iframe` of the returned URL gets a writable browser shell as root.

The original `add-browser-terminal/design.md:185` explicitly noted the trust boundary was supposed to be enforced by Caddy IP allowlist or client cert. That was never deployed. We have learned that "we'll defend in front of the app" is too easy to forget; this change moves the trust boundary into the app itself so it is on by default.

Constraints:

- **Single-user system** for now. Future work (out of scope here) will let the operator publish a read-only share link for a specific page/project, but mutation and shell endpoints MUST always require the operator's credentials. Designing the share-link contract now keeps us from accidentally allowing anonymous mutations later.
- **Runs as root** — both Next.js and `claude` inside ttyd. We do not change this. We rely on the auth layer to keep root power off the public internet.
- **Other `*.dev.mem.ac` sites** (paperland, gradio-0/1, wiki) are out of scope.
- **No fs watcher** rule applies (this change has nothing fs-watcher-shaped, but flagged for completeness).
- **Skills artifacts in English; conversation in Chinese** — applies to any new SKILL.md, none planned here.

Stakeholders: solo operator (the user). No multi-user concerns.

## Goals / Non-Goals

**Goals:**

- Make the public memon URL safe by default: anonymous HTTP gets a login page, never a writable shell.
- Single source of truth for credentials: `config.yml` `auth` block.
- First-run UX: if `auth` is missing, generate a random password, persist its hash, print plaintext to stdout once. Operator does not need to read shadcn docs for "how do I set a password."
- Browser-terminal endpoint is gated by both (a) the cookie check inside Next.js middleware AND (b) ttyd's own `-c user:pass` (defense in depth, in case Caddy is ever re-pointed at ttyd directly).
- Lock in the contract that mutation and shell routes always require auth, so the future "make project public" feature can only relax read endpoints.
- Zero native dependencies if possible (the `claude-code` skill ecosystem already ships ESM-only; adding a native bcrypt would complicate Linux/macOS dev setup).

**Non-Goals:**

- Multi-user, role-based access, OAuth/OIDC/SSO, password reset flow, account lockout, rate limiting, MFA, session revocation list — none of these. Single user, one password, change-by-editing-`config.yml`.
- CLI auth. `memon list`, `memon serve`, etc. read local files directly; auth gates the HTTP server only.
- Other `*.dev.mem.ac` sites.
- The actual share-link UI for read-only public pages — only the contract (anon role rejected from mutation/shell) is locked in here.
- Switching off root.

## Decisions

### D1. Password hashing: scrypt from `node:crypto`, not bcrypt

`node:crypto.scrypt` ships with Node ≥ 10, no native module install, works on every platform we care about. bcrypt would mean either `bcryptjs` (slow pure-JS) or `@node-rs/bcrypt` (native, breaks `pnpm install` on weird platforms). scrypt is RFC 7914, OWASP-acceptable for password storage. We pin parameters at `N=2^15, r=8, p=1` (≈70 ms on a modern CPU), salt is 16 random bytes from `crypto.randomBytes`, output is 64 bytes, stored as `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`. Rationale: single-user system, no budget for a slow native build dependency.

**Alternatives considered:** `bcryptjs` (pure JS but ~10× slower per hash, and we hash on every login so latency adds up); `argon2` (best-in-class but native-only); plaintext + HMAC (insufficient if `config.yml` leaks).

### D2. Session cookie: HMAC-signed, derived secret, no server store

Cookie: `memon_session=<userJson>.<hmacSig>`, HTTP-only, `Secure`, `SameSite=Lax`, 30-day TTL. Signing key is derived as `HKDF(passwordHashBytes, salt='memon-session-v1', length=32)`. Rationale:

- No server-side session store keeps the codebase tiny — no Redis, no in-memory map that resets on restart.
- Deriving the signing key from the password hash means **changing the password automatically invalidates all existing sessions**, which is the behavior we want: if the operator rotates the password (because they typed it into a public Slack), every old cookie becomes a dead string.
- Cookie payload is just `{ "u": "<username>", "v": 1, "iat": <unix-seconds> }`. No secrets in it. The verifier re-derives the signing key from `config.yml`'s hash and `crypto.timingSafeEqual`s.

**Alternatives considered:** `iron-session` (extra dep, opaque API, encrypted-at-rest cookie isn't necessary since we don't store secrets in it); JWT (overkill, RS256 is heavy, HS256 with a separate secret means we need to manage another secret).

### D3. Where auth runs: Next.js `middleware.ts`, NOT Caddy `basic_auth`

We could shove the entire problem into Caddy (`basicauth /* { admin <bcrypt> }`). Reasons we don't:

- Operator may not control Caddy in every deployment (someone else's reverse proxy, ngrok tunnel, Cloudflare). The app needs to be safe regardless.
- Caddy basic-auth doesn't compose with the read-only public-share feature we're reserving for the future; rule "GET on `/p/foo` is public when shared, everything else requires auth" lives in app code.
- The current Caddyfile has a `@terminal path /api/terminal/proxy/* → 127.0.0.1:7682` matcher that **completely bypasses Next.js**. Caddy basic_auth on that matcher would work, but it would be configured in two places (Caddy + Next.js for the rest), and easy to forget when redeploying. Single auth layer is simpler.

So: middleware in `apps/web/middleware.ts` runs before every route. Caddyfile is changed to drop the `@terminal` matcher and route everything through Next.js. The WebSocket upgrade for ttyd then has to traverse Next.js — **see D4**.

### D4. ttyd WebSocket through Next.js: route handler upgrade or sidecar?

Next.js App Router does not natively expose the raw HTTP `Upgrade: websocket` handshake to route handlers. Two options:

- **D4a (chosen):** Keep the Caddy `@terminal` matcher BUT add Caddy-level auth on it, wired to the same credential. We use `basicauth` in Caddy with the **same scrypt hash** memon writes to `config.yml`. On startup, memon SHALL write a tiny snippet (or print it) so the operator can paste it into the Caddyfile, and a CLI command `memon caddy-snippet` SHALL emit it. Browser side: when the user is logged into the dashboard (cookie), the dashboard fetches `/api/terminal/auth-token` (gated by middleware), gets a one-shot token, and the iframe URL is `/api/terminal/proxy/<sess>/?_token=<one-shot>`; ttyd ignores it but Caddy's `basicauth` is bypassed when the request carries that token via... no, this won't work cleanly. **Revised D4a:** drop the one-shot-token complexity. The browser is already logged in; we add a tiny auth-cookie-checker hop: middleware on `/api/terminal/proxy/*` returns 401 to anonymous requests **and** when the cookie is valid, rewrites the request to a Caddy-internal upstream that has basic-auth disabled. **This is getting tangled.**

- **D4b (chosen for real):** **Keep ttyd behind Caddy `@terminal`, but require Caddy `basicauth` on that path.** The browser dashboard, after the user logs in via the Next.js form, calls `POST /api/auth/login` which **also sets a second cookie** `memon_ttyd` carrying the ephemeral basic-auth credentials (random per server boot, also passed to ttyd `-c`). The browser, when loading the iframe, has its `XMLHttpRequest`/`fetch` automatically send credentials? No — basicauth needs `Authorization: Basic`, not a cookie. So instead: after login, the dashboard JS fetches a small endpoint that returns the ephemeral creds, then constructs the iframe `src` as `https://<user>:<pass>@memon-vultr.dev.mem.ac/api/terminal/proxy/...`. Modern browsers strip `userinfo` from URLs in 2026 — Chromium has done this for years. So **that** doesn't work either.

- **D4c (final):** Put the whole thing behind one auth layer: **Caddy `basicauth` on the entire `memon-vultr.dev.mem.ac` site** (using the same scrypt-hash from `config.yml`). When the browser loads the dashboard, the browser does the basicauth challenge once and caches credentials per-origin; the iframe to `/api/terminal/proxy/...` reuses those cached credentials automatically (same origin), so ttyd is reachable without per-iframe URL trickery. The Next.js login UI is **dropped from the MVP** — the operator just sees the browser's native basic-auth dialog. Inside Next.js we still verify the `Authorization: Basic` header (defense in depth + gives us the operator's identity for the future share feature), but the primary auth challenge is Caddy. ttyd ALSO has `-c <ephemeral-user>:<ephemeral-pass>` so even if Caddy were bypassed, ttyd refuses anonymous WebSocket upgrades.

  After thinking again — **this is what we're doing.** Single mechanism (HTTP Basic), one credential pair in `config.yml`, browser handles the challenge UI, Caddy enforces, Next.js double-checks, ttyd has its own ephemeral credential as defense in depth.

  The earlier "session cookie / login form" plan in the proposal is replaced by HTTP Basic. The proposal's `auth-system` capability is updated accordingly: `auth.username` + `auth.password_hash` in `config.yml`; no `/login` page; Next.js middleware checks `Authorization: Basic` header against the hash; on mismatch returns `401 WWW-Authenticate: Basic realm="memon"`.

  **Why this ends up cleaner:**
  - No cookie crypto. Browsers handle credential caching.
  - WebSocket Upgrade requests inherit the same `Authorization` header from the iframe's origin, so ttyd-via-Caddy works without rewriting.
  - The future share-link feature just needs middleware to skip the Authorization check on routes like `GET /p/<project>?share=<token>` while keeping it on everything else.
  - One credential to rotate.

**Alternatives considered (and why not):** session cookies (D4a/b) — extra crypto, cookie-vs-Authorization-header inconsistency between iframe and parent, and gives nothing in a single-user system; OAuth/OIDC — wildly out of scope.

### D5. ttyd's own `-c` flag: ephemeral creds, not the operator's

`-c user:pass` takes plaintext, comma-separated (`-c user:pass`). We do NOT pass the operator's actual password. Instead, when `apps/web/lib/terminal/manager.ts` spawns ttyd, it:

1. Reads from a process-global `getOrCreateEphemeralTtydCreds()` which generates a random username (`memon-tty-<6 hex>`) and 32-char random password ONCE per server process and caches it in module state.
2. Passes `-c <user>:<pass>` to ttyd.
3. The Next.js middleware, after verifying the operator's `Authorization: Basic`, **rewrites** the request to ttyd by replacing the `Authorization` header with `Basic <base64(ephemeral-user:ephemeral-pass)>` before forwarding via... wait, Caddy is the one forwarding to ttyd, not Next.js.

**Revised D5:** since Caddy reverse-proxies `/api/terminal/proxy/*` directly to ttyd, the browser's basic-auth credentials (= operator's username:password) reach ttyd, not the ephemeral pair. ttyd's `-c` would reject the operator's creds because they don't match the ephemeral pair. Two ways to fix:

- (a) Make Caddy rewrite the `Authorization` header on that matcher: `header_up Authorization "Basic {env.MEMON_TTYD_BASIC}"`. memon writes `MEMON_TTYD_BASIC` to a Caddy env file on startup. Operator runs `caddy reload` to pick it up. **Reload-on-restart is ugly** — every memon restart would need a Caddy reload.
- (b) Don't use ttyd's `-c` at all. Rely on: (1) ttyd binds to `127.0.0.1` (already true), (2) Caddy basic_auth on the path (covers public access), (3) Next.js middleware also rejects anonymous on the same path (covers any localhost bypass). Trust the localhost binding + two layers of basic_auth as sufficient.

**Decision: (b).** Skip `-c`. Document the rationale: `127.0.0.1` binding + Caddy basicauth + Next.js middleware are three independent gates; adding a fourth (ephemeral `-c`) introduces a Caddy-reload coupling that's worse than the marginal defense it adds. **The proposal text mentioning `-c` is superseded by this decision.**

We DO add a startup log line: `ttyd is bound to 127.0.0.1:7682 with --writable; ensure no other proxy on this host forwards to it.` so the operator knows the perimeter.

### D6. First-run password generation

On `memon serve` startup, after `loadConfig` returns:

- If `cfg.auth` is missing OR `cfg.auth.password_hash` is missing/empty:
  - Generate `password = crypto.randomBytes(18).toString('base64url')` (24 chars, 144 bits).
  - Compute scrypt hash.
  - Read `config.yml` as text, parse YAML, splice in the `auth:` block (preserve comments via line-based insertion at end of file rather than YAML round-trip — js-yaml loses comments). Write atomically (`config.yml.tmp` + rename).
  - Print to stdout (not log file): `\n*** memon: generated initial password ***\n  username: admin\n  password: <plaintext>\nThis is shown only once. Save it now.\n\n`.
  - Continue startup with the new credentials in memory.
- If `cfg.auth.password_hash` exists, just use it.

**Rationale:** zero-config-and-still-secure beats refusing to start. The operator who just `git clone && pnpm dev`s gets a working secure server.

### D7. Caddyfile changes

> **HISTORICAL — superseded by D9.** This decision picked `forward_auth` over `basic_auth` because the latter requires a bcrypt hash separate from `config.yml`. During live deployment we discovered `forward_auth` cannot proxy WebSocket upgrades (Caddy's auth probe is a `reverse_proxy` that consumes the `Upgrade`/`Connection` headers, leaving the subsequent ttyd `reverse_proxy` with no WS context — handshake hangs, ttyd shows "press enter to reconnect"). The reversal is documented in **D9** below; the rest of D7 is kept verbatim for historical reference.

Operator-side change, not code. The `memon-vultr.dev.mem.ac` block becomes:

```caddyfile
memon-vultr.dev.mem.ac {
    basicauth {
        admin <scrypt-hash-from-config-yml>
    }

    @sse path /api/events /api/log/stream*
    reverse_proxy @sse 127.0.0.1:3737 { flush_interval -1 }

    @terminal path /api/terminal/proxy/*
    reverse_proxy @terminal 127.0.0.1:7682 { flush_interval -1 }

    reverse_proxy 127.0.0.1:3737
}
```

Caddy's `basicauth` directive expects a **bcrypt** hash, not scrypt. So either:

- (a) We hash twice: scrypt for app-side validation in `config.yml`, plus a bcrypt copy for Caddy. Operator gets both hashes printed on first run. — **gross**.
- (b) We use bcrypt everywhere (`bcryptjs`, pure JS, slow but acceptable for one login per session). — **gives up D1**.
- (c) We don't use Caddy `basicauth`; instead we rely on Next.js middleware as the only auth layer, and reroute `/api/terminal/proxy/*` to go through Next.js via a `forward_auth` directive: Caddy calls `/api/auth/check` first and only forwards on 200.

**Decision: (c)**. Caddy uses `forward_auth`:

```caddyfile
forward_auth 127.0.0.1:3737 {
    uri /api/auth/check
    copy_headers Authorization
}
```

`/api/auth/check` is a tiny route handler that takes `Authorization: Basic <b64>`, validates against the scrypt hash, returns 200 (with `X-Memon-User` echoed) or 401. Caddy's `forward_auth` will challenge and return 401 (with `WWW-Authenticate` if `/api/auth/check` includes it) before forwarding to ttyd. Net result: same single scrypt hash everywhere, no bcrypt copy, single auth layer logically.

This **does** mean every WebSocket upgrade pays one extra hop for auth check. Acceptable. Cache could be added later (Caddy can `cache_responses` on `forward_auth` for short windows) — out of scope here.

### D9. Caddy `basic_auth` (supersedes D7)

After live deployment we reversed D7's choice and switched to Caddy's native `basic_auth` directive. The trigger was a hard failure: ttyd's WebSocket upgrade consistently hung when fronted by `forward_auth`, manifesting on the browser side as ttyd's "press enter to reconnect" message. Diagnosis (manual `curl --http1.1 -H 'Connection: Upgrade' …`):

- Direct WS to `127.0.0.1:7682`: `HTTP/1.1 101 Switching Protocols` ✓
- Through Caddy with `forward_auth`: hangs, no response — Caddy's `forward_auth` probe is implemented as a `reverse_proxy` that consumes `Upgrade`/`Connection` headers, so the subsequent ttyd `reverse_proxy` receives a request stripped of WS context.
- After replacing `forward_auth` with `basic_auth`: `HTTP/1.1 101 Switching Protocols` ✓.

**Final Caddy block** (inside `route { ... }` not needed — `basic_auth` orders correctly under default Caddy directive ordering):

```caddyfile
memon-vultr.dev.mem.ac {
    basic_auth {
        admin <bcrypt-of-auth.password>
    }

    @sse path /api/events /api/log/stream*
    reverse_proxy @sse 127.0.0.1:3737 { flush_interval -1 }

    @terminal path /api/terminal/proxy/*
    reverse_proxy @terminal 127.0.0.1:7682 { flush_interval -1 }

    reverse_proxy 127.0.0.1:3737
}
```

The bcrypt is computed via `caddy hash-password --plaintext "$(grep -E '^\s*password:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)"`. Operator regenerates whenever `config.yml`'s plaintext changes.

**Trade-off accepted:** two sources of truth (plaintext in `config.yml` for application + agents, bcrypt in Caddyfile for Caddy). The README documents the rotation flow. Net result vs D7:

- ✅ WS upgrades work end-to-end (the actual reason for the reversal)
- ✅ No `forward_auth` HTTP roundtrip per request (faster)
- ❌ Two-source-of-truth — operator regenerates bcrypt on rotation
- Net: D7's "single hash everywhere" was a nice-to-have; WS support is a must-have. Trade-off is forced.

`/api/auth/check` route stays in code as an "auth ping" endpoint (clients can call it to validate creds before firing heavier requests). It's no longer wired into Caddy's auth path.

### D8. Public-share contract (forward-looking)

Spec text: "All endpoints classified as `mutating` or `shell` SHALL return 401 to requests without valid `Authorization`, regardless of any future share-link cookie or query parameter. Endpoints classified as `read` MAY be marked `public:true` in a future change to allow anonymous access; until that change is implemented, ALL endpoints require auth."

Endpoint classification (table goes in the `auth-system` spec):

- `read`: `GET /api/projects`, `GET /api/experiments/*`, `GET /api/experiments/*/readme`, `GET /api/log/*`, SSE streams `/api/events`, `/api/log/stream*`, page renders for `/p/*` and `/e/*`.
- `mutating`: `PUT /api/experiments/*/readme`, `POST /api/experiments/*/hypotheses`, `POST /api/experiments/*/journal`, `PUT/PATCH/POST/DELETE` anything else under `/api/`.
- `shell`: `/api/terminal/*` (start, stop, list, check, install, proxy/*).

Today the rule applies uniformly to all three classes; the classification just exists so the future change can flip `read` to public per-route.

## Risks / Trade-offs

[**Browser basic-auth UX is ugly**] → Mitigation: the user has explicitly accepted single-user system; one prompt per session is acceptable. Future improvement could add a custom login page using `fetch` with `credentials: 'include'`, but for MVP the native dialog is fine.

[**Caddy `forward_auth` extra hop on every WebSocket upgrade**] → Mitigation: only on the initial upgrade, not per-message. Even so, latency is +1 localhost roundtrip (~1 ms). Acceptable.

[**Operator misses the printed password line**] → Mitigation: the password is persisted plaintext in `config.yml` itself, so re-reading it is `cat config.yml`. The `~/.cache/memon/initial-password.txt` cache file approach was removed (D-rev: see proposal evolution; plaintext-in-config is the single source of truth).

[**`config.yml` write on first run could clobber operator's hand-edited file if it happens concurrently with another edit**] → Mitigation: atomic temp-file + rename; if mtime changed between read and rename, abort with an error and tell the operator to set `auth` manually.

[**Two sources of truth: plaintext in `config.yml`, bcrypt in Caddyfile**] → Mitigation: README documents the rotation flow (edit plaintext → `caddy hash-password` → paste bcrypt → reload Caddy → restart memon). Forced by D9: WS-compatible auth requires `basic_auth`, which requires bcrypt; `config.yml` plaintext is required so dev agents can read it. Accepted.

[**Anyone with shell access on the host can read the plaintext password directly from `config.yml`**] → Mitigation: this is by design. Single-user threat model: host fs trust = HTTP auth trust (same boundary as `~/.ssh/id_*`). `config.yml` is gitignored. Won't fix.

[**`Authorization` header is plaintext on the localhost hop between Caddy and Next.js / ttyd**] → Mitigation: HTTPS terminates at Caddy; the localhost hop is plaintext but only on the loopback interface. Acceptable for single-user system. Document.

[**HTTP Basic auth means there's no logout**] → Mitigation: known, accepted. Operator closes the browser to "log out". For revocation, change the password (and the bcrypt in Caddyfile) — invalidates everywhere on the next request because every request goes through Caddy's `basic_auth` and Next.js's middleware.

[**Defense-in-depth was advertised in the proposal via ttyd `-c`; D5 dropped it**] → Mitigation: three independent gates (loopback bind + Caddy `basic_auth` + Next.js middleware) replace the previous "two gates + ttyd `-c`". Net security is comparable, deployment ergonomics are better.

## Migration Plan

(Updated post-deployment. Original plan called for `forward_auth`; live debugging revealed WS incompatibility — see D9. Final plan as executed:)

1. Implement schema (plaintext `password` field) + first-run flow (writes plaintext to `config.yml`) + `/api/auth/check` route + middleware (Node runtime, `timingSafeEqual` compare) on a feature branch.
2. Test locally: `pnpm dev` with no `auth` block → confirm random plaintext is generated, printed, and stored.
3. Test middleware: anonymous → 401, valid → 200, wrong creds → 401.
4. Compute bcrypt: `caddy hash-password --plaintext '<auth.password from config.yml>'`.
5. Update `/etc/caddy/Caddyfile`'s `memon-vultr.dev.mem.ac` block to use `basic_auth { admin <bcrypt> }`. Keep a backup (`Caddyfile.bak.YYYYMMDD-HHMMSS`).
6. `caddy validate` and `systemctl reload caddy`.
7. From outside: anonymous → 401, valid → 200, anonymous `POST /api/terminal/start` → 401.
8. End-to-end browser-terminal: open iframe with cached creds → WS upgrade → terminal IO works.

**Rollback:** revert Next.js (middleware short-circuits to `next()`) and restore prior Caddyfile from `Caddyfile.bak.*`. No data migration to undo — only ADDED `auth.password` to `config.yml`, removing it makes the server boot un-authed (the next first-run regenerates).

## Open Questions

All resolved by operator (2026-05-04):

- **`memon serve --no-auth` escape hatch?** → **No.** Not implemented. If the operator needs to reset, they edit `config.yml` and restart.
- **Rate limit on `/api/auth/check`?** → **Yes.** Add a small in-process token-bucket limiter keyed by client IP. Default: 10 attempts per minute per IP, burst 5. Over-limit returns `429 Retry-After: 60` (and SHALL NOT consume scrypt cycles). Client IP is read from `X-Forwarded-For` (last entry, since Caddy is the only trusted hop) with fallback to the request socket address. The limiter is in-memory only (single-process, no Redis); state resets on restart, which is fine for a single-user system. Same limiter SHALL also apply to the middleware path so direct hits to `/` (where the browser sends Authorization) are rate-limited identically — otherwise the limiter only catches the Caddy forward_auth probe.
- **Where in `config.yml` does `auth` live?** → **Top-level `auth:` key.** No `server:` grouping.
