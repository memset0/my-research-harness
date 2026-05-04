## Why

The memon dashboard is currently exposed at `https://memon-vultr.dev.mem.ac` with **no authentication on any layer**: Caddy reverse-proxies to Next.js (port 3737) and ttyd (port 7682) with no `basic_auth` / IP allowlist / mTLS, Next.js has no `middleware.ts`, and ttyd is started with `--writable` and no `-c user:pass`. Anyone on the public internet can `POST /api/terminal/start` (no auth) and immediately get a writable browser terminal that runs `claude` in a tmux session as **root** — i.e. full machine compromise via a single HTTP call. The original `browser-terminal` design.md noted that the trust boundary was meant to be enforced by Caddy (IP allowlist / client cert), but that boundary was never deployed. We need application-layer auth so the system is safe by default regardless of how the reverse proxy is configured.

## What Changes

- **NEW** `auth-system` capability: single-user username/password authentication that gates the dashboard UI, all mutating API routes, all SSE streams, the README editor, and the browser-terminal proxy path.
- Credentials are read from `config.yml` under a new top-level `auth` block: `auth.username` (default `admin`) and `auth.password_hash` (bcrypt or scrypt hash). On first `memon serve` invocation when `auth` is missing, the server SHALL generate a random password, write the hash into `config.yml`, and **print the plaintext password to stdout exactly once** so the operator can record it.
- Login flow: `POST /api/auth/login` accepts `{ username, password }`, sets a signed HTTP-only cookie (`memon_session`) on success. `POST /api/auth/logout` clears it. A login page at `/login` (server-rendered) collects credentials. Session secret is derived deterministically from the password hash so cookies survive process restarts but invalidate on password change.
- Auth enforcement is implemented in **Next.js `middleware.ts`** (covers all routes including the `/api/terminal/proxy/*` request that triggers the WebSocket upgrade — Caddy will be reconfigured to route the WS handshake through Next.js middleware first via a small auth-check redirect, OR ttyd's own `-c` flag becomes the second gate; see design.md).
- ttyd is started with `-c <username>:<bcrypt-of-password-not-feasible>` — actually `-c user:plaintext`. To avoid exposing the plaintext config password to ttyd, the spawn layer derives a **separate ephemeral ttyd credential** per server boot (random username + random password, kept in memory) and injects it into both ttyd's `-c` argv and the auth cookie's allowlist; the browser fetches `/api/terminal/proxy/...` with HTTP basic auth headers added by the Next.js middleware after the user's `memon_session` cookie validates.
- **NEW** read-only public share mode (forward-looking, MVP just reserves the contract): the `auth-system` spec defines the `public` cookie/role and states that **all** mutating endpoints (`PUT /api/experiments/*`, `POST /api/terminal/*`, README writes, hypothesis writes, journal writes) and all shell/terminal routes SHALL reject anonymous requests with 401. The actual share-link UI is out of scope for this change but the rule is locked in now so we don't accidentally allow anonymous mutations later.
- `browser-terminal` capability is amended: ttyd is invoked with `-c <ephemeral-user>:<ephemeral-pass>`; `/api/terminal/proxy/*` requires the `memon_session` cookie before the WebSocket upgrade is allowed.
- `Caddyfile` for `memon-vultr.dev.mem.ac` is updated so that **the entire site** (including `/api/terminal/proxy/*`) terminates auth at Next.js rather than going directly to ttyd. We accept a small extra hop in exchange for a single trusted auth layer. Other `*.dev.mem.ac` sites are not modified.
- **BREAKING**: existing `config.yml` files without an `auth` block will get one auto-written on next `memon serve` start; the random password is printed to stdout and the operator must capture it. CLI-only commands (`memon list`, etc.) do NOT require auth — only the HTTP server does.

## Capabilities

### New Capabilities
- `auth-system`: single-user username/password authentication, login flow, session cookies, middleware enforcement on all mutating + shell endpoints, `config.yml` schema for credentials, first-run random password generation, contract for future read-only public-share mode.

### Modified Capabilities
- `browser-terminal`: ttyd is started with `-c <ephemeral-user>:<ephemeral-pass>` (random per process), and the `/api/terminal/proxy/*` path requires the `memon_session` cookie before Caddy/Next.js forwards the WebSocket handshake.

## Impact

- **Code**:
  - New: `apps/web/middleware.ts`, `apps/web/lib/auth/*` (session crypto, cookie helpers, password hashing), `apps/web/app/login/page.tsx`, `apps/web/app/api/auth/login/route.ts`, `apps/web/app/api/auth/logout/route.ts`.
  - Modified: `packages/core/src/schemas.ts` (add `AuthConfigRawSchema`), `packages/core/src/config/load.ts` (parse and surface `auth`, write hash on first run), `apps/web/lib/runtime.ts` (expose auth config + ephemeral ttyd creds), `apps/web/lib/terminal/manager.ts` (pass `-c user:pass` to ttyd argv), `apps/web/app/api/terminal/proxy/[...path]/route.ts` (cookie check; injects basic-auth header to ttyd upstream — but since Caddy bypasses Next.js for WS today, the Caddyfile must change too).
  - Modified: `/etc/caddy/Caddyfile` (`memon-vultr.dev.mem.ac` site block) — drop the direct `127.0.0.1:7682` matcher; route everything through Next.js so middleware can enforce.
  - Modified: `config.example.yml` (add `auth:` block with example).
- **Dependencies**: add `@node-rs/bcrypt` (or `bcryptjs` if avoiding native modules) for password hashing; `cookie` and `iron-session`/own-rolled HMAC for signed cookies. Prefer zero-native-dep route (`scrypt` from `node:crypto` + `cookie` package).
- **Specs**:
  - New: `openspec/specs/auth-system/spec.md`
  - Delta: `openspec/specs/browser-terminal/spec.md` (ttyd `-c` flag + cookie gate)
- **Operational**: existing `config.yml` files need an `auth` block; first-run flow auto-writes one and prints the plaintext password. Operators must capture that line from logs/stdout.
- **Out of scope (called out so we don't accidentally do it)**: multi-user accounts, OAuth/OIDC/SSO, per-project ACLs, password reset flow, CLI-side auth (`memon list` etc. remain credentialless — they read local files directly), changes to other `*.dev.mem.ac` sites.
