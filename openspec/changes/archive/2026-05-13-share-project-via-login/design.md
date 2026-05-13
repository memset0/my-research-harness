## Context

The memon dashboard is a single-user research tool today. Access is gated by
HTTP Basic auth: middleware (`apps/web/middleware.ts`) and a parallel
WebSocket-upgrade gate in `apps/web/server.ts` both check
`Authorization: Basic` against a plaintext password in `config.yml`. Routes are
classified into `read | mutating | shell` via `apps/web/lib/auth/route-classes.ts`,
and the existing spec explicitly states that future work MAY relax `read`
routes for share-link access but MUST keep `mutating` and `shell` owner-only.

The user wants to hand a URL to a collaborator that grants read-only access
to ONE specific project. Sharing the owner's Basic credentials is not an
option (it grants cross-project read AND shell). And we want to minimize
per-handler churn: scope enforcement should sit in middleware, not in each
of ~50 route handlers.

This design introduces (a) a session-cookie login for browsers, (b) a
per-project share-link token model with cookies that accumulate viewer
scopes, and (c) middleware-centric scope enforcement using the existing
`route-classes.ts` as the single source of truth. HTTP Basic is preserved
as the CLI/curl tooling fallback so CLAUDE.md verification flows and dev
scripts keep working unchanged.

## Goals / Non-Goals

**Goals:**
- One URL = view ONE project read-only. URL contains a share token; opening
  it sets a cookie; cookie grants read access scoped to that project.
- A single browser can collect share cookies for multiple projects, each
  granting read access only to its own scope.
- Three auth modes coexist cleanly with explicit precedence (owner-session
  > owner-Basic > viewer-share-cookie). Anonymous users may still attempt
  login or open a share URL.
- Scope enforcement is centralized in middleware. New routes get scope
  protection by being added to `route-classes.ts` — no per-handler guards.
- Existing CLI / curl flows that use HTTP Basic keep working unchanged.
- Viewer-mode UI shows `mutating`/`shell` buttons as `disabled` with a
  tooltip — visible but inert.
- Share creation / revocation works both from the web UI (project page
  header) and from the CLI (`memon share {create,list,revoke}`).

**Non-Goals:**
- Multi-owner accounts / user registration. Login is single-owner only.
- Owner-impersonation via share-cookie elevation. Viewer cookies stay
  viewer; the only way to become owner is to log in.
- Audit logging of share access (the threat model is single-user; a future
  change can add this).
- Sharing across hosts (the share token is tied to the host issuing it;
  copying a share URL to a different memon deployment does not work).
- Rotating an entire project's share secrets in one command (would require
  bulk revoke; existing per-share revoke is sufficient).
- TLS/HTTPS configuration. Caddy already terminates TLS in production; this
  design adds `Secure` flag to cookies only when the request scheme is
  `https`.

## Decisions

### D1. Three-mode middleware with explicit precedence AND class-gated mode 3

The middleware evaluates auth modes lazily, with the route class
determining which modes are even considered:

1. **Owner session cookie** (`memon-session`): HMAC-SHA256-signed payload
   `{role:"owner", iat, exp}` (Base64URL JSON). Valid if signature matches
   and `exp` not past. Evaluated for every non-`anon` route.
2. **Owner HTTP Basic** (`Authorization: Basic <b64(u:p)>`): existing path,
   unchanged. Evaluated for every non-`anon` route only if mode 1 didn't
   pass.
3. **Viewer share cookie** (`memon-shares`): HMAC-SHA256-signed payload
   listing `[{project, token}, ...]`. Valid if signature matches AND at
   least one `(project, token)` pair resolves against that project's
   `.memon/shares.json`. The validated subset becomes `scopeProjects`.
   **Evaluated ONLY for `read`-classed routes**. For `shell` and
   `mutating` routes, mode 3 is NOT evaluated — the share cookie is
   categorically irrelevant there, and the middleware short-circuits to
   "no owner identity → anon" on those routes regardless of whether a
   `memon-shares` cookie exists. Concretely:
   
   - ttyd routes (`/api/terminal/*`, including the WS upgrade in
     `apps/web/server.ts`) never decode the share cookie.
   - All `mutating` API routes (`PUT/POST/PATCH/DELETE /api/...`) never
     decode the share cookie either.
   - Result: a viewer hand-typing a mutating URL is treated as anon for
     that request (HTML page → 302 /login; API → 401), NOT as a
     "viewer attempting mutating → 403". This is simpler, cheaper, and
     gives the user a useful action ("log in as owner") rather than a
     dead-end 403.

If 1 OR 2 produces a passing identity, mode 3 is not even attempted.
The `memon-shares` cookie may exist but is treated as decoration on an
owner session — it's not decoded, not validated. (This handles the case
of a viewer who later logs in as owner — they don't lose their share
cookies, but those cookies are inert while the session is active. On
logout, the share cookies become live again, evaluated on the next
`read` request.)

If no mode passes on a non-`anon` route, anonymous access is denied:
HTML page request → 302 → `/login?next=<path>`; API request → 401 with
`WWW-Authenticate: Basic realm="memon"`. `anon`-classed routes (login
page, login API, share landing, static assets) pass without any auth
evaluation.

**Rejected alternative**: a "tagged" cookie that carries owner-or-viewer
in the same field. Cleaner in theory but harder to reason about under
"viewer cookie present, owner login in progress" race; two separate
cookies make precedence trivially `if (memon-session) ... else if (basic) ... else if (memon-shares) ...`.

**Rejected alternative**: stateful server-side session store. We pick a
stateless signed cookie so server restarts don't log everyone out. The
signing key (`cfg.auth.session_secret`) is regenerated only if absent.

### D2. Per-project share secrets stored at `<projectRoot>/.memon/shares.json`

Each project owns its own list of share records. Schema:

```json
{
  "version": 1,
  "shares": [
    {
      "id": "shr_<8 base64url chars>",
      "token": "<24 base64url chars from 18 random bytes>",
      "label": "Reviewer Alice",
      "created_at": "2026-05-13T10:00:00+08:00",
      "expires_at": null
    }
  ]
}
```

`token` is the credential that goes into the share URL. It is plaintext on
disk (consistent with `cfg.auth.password` plaintext storage — same
single-user threat model). The `id` is a short, stable identifier used for
revocation by prefix.

**Rejected alternative**: a single `config.yml`-level `auth.shares` array.
Per-project storage means deleting / archiving a project also cleans up
its shares (no orphaned records), and the owner can copy a project to a
new host with its shares intact. It also keeps `config.yml` small.

**Rejected alternative**: storing only a HASH of the token on disk. Plaintext
matches the rest of the system's stance; the owner can also `cat
.memon/shares.json` to inspect what's outstanding. If shares.json leaks,
the owner can issue `memon share revoke` to rotate.

### D3. Cookie shape — `memon-shares` accumulates `(project, token)` entries

The viewer cookie is `memon-shares = <base64url(JSON.stringify({entries:
[{project, token}, ...], sig: <hmac>}))>` (one consolidated cookie, not
many).

On a successful share landing visit (`/share/<project>/<token>`):
1. Server validates the token against `<projectRoot(project)>/.memon/shares.json`.
2. Server reads the existing `memon-shares` cookie (if any), drops the
   entry for the same project (so newest-token-wins per project), appends
   the new `(project, token)` entry.
3. Server signs the new payload and writes the cookie back
   (HTTPOnly, SameSite=Lax, Path=/, Max-Age=90 days,
   Secure if request scheme is `https`).
4. Server redirects to `/p/<project>`.

The cookie size grows linearly in number of distinct projects shared with
the viewer. At ~60 bytes per entry, 50 projects = 3 KB, still well under
the 4 KB per-cookie browser limit.

On each request, middleware:
1. Decodes the cookie payload (if present + signature valid).
2. For each entry, validates the token against
   `<projectRoot(entry.project)>/.memon/shares.json` (in-memory cached
   read; invalidated on `recomputeAnomalies` and on share CRUD).
3. The validated subset of `entry.project` values becomes `scopeProjects:
   Set<string>`. Invalid entries are dropped (silent — don't 401 the
   viewer just because one of their shares was revoked).
4. If the validated set differs from the request's cookie set, set a
   refresh-write cookie on the response to prune stale entries.

**Rejected alternative**: one cookie per project (`memon-share-<project>`).
Cleaner conceptually but browsers limit ~50 cookies per origin, and
multiple cookies make the "decode and validate" step a loop over headers
instead of a single decode.

### D4. Centralized scope enforcement via extended `route-classes.ts`

Today `route-classes.ts` returns one of `read | mutating | shell`.
We extend it to return `{class, projectFor}` where `projectFor(req)`
returns one of:
- a project name string (extracted from URL path or query),
- `'multi'` — the route legitimately returns cross-project data (the
  handler is responsible for filtering by `scopeProjects` from req
  context),
- `'global'` — the route is project-independent (owner-only by default),
- `null` — fall back to `'global'` (fail-closed for unknown shapes).

Middleware then applies:
- `anon`: pass for everyone (no auth lookup needed beyond the rate
  limiter).
- `mutating` / `shell`: require owner. Viewer = 403. Anon = 401/302.
- `read`:
  - owner: pass.
  - viewer + `projectFor === 'multi'`: pass; handler must filter (only
    three handlers fall in this bucket: `/api/projects`, `/api/anomalies`,
    `/api/events`).
  - viewer + `projectFor` resolves to a project in `scopeProjects`: pass.
  - viewer + `projectFor` resolves to a project NOT in `scopeProjects`: 403.
  - viewer + `projectFor === 'global'`: 403.
  - viewer + `projectFor === null`: 403 (fail-closed).
  - anon + `projectFor === ...`: 401 (login) regardless of route class —
    anonymous cannot access `read` routes without identity.

Project extraction patterns:
- `/p/<project>/...` → first path segment after `/p/`.
- `/api/projects/<project>/...` → first segment after `/api/projects/`.
- `/api/runs?project=foo` → query param.
- `/api/runs/<id>` → look up `<id>` in `RunIndex` (in-memory) → return
  `run.project`. If id not found, `null`.
- `/api/experiments/<id>` → look up in `ExperimentIndex`.
- `/api/digests/<id>` → look up in DigestStore.
- `/api/reports/<id>` → look up in ReportStore.
- `/api/log?path=<absolute-or-relative>` → derive project from path by
  matching against configured project roots.
- `/api/readme?path=...` → same.
- `/api/runtime/health` → `'global'`.
- `/api/anomalies` (with or without `project=`): if query has
  `project=foo`, return that; else `'multi'`.

**Rejected alternative**: require every handler to check scope. Fragile;
new routes silently leak access if a guard is forgotten. The route-
classes table is already required for the `read`-vs-`mutating` split,
so extending it is the natural place.

**Rejected alternative**: a route convention like `/api/p/<project>/...`
that puts project in the URL universally. Too invasive — would require
restructuring most existing endpoints.

### D5. HMAC signing key (`cfg.auth.session_secret`)

A single 256-bit secret signs BOTH `memon-session` and `memon-shares`
cookies. It is stored plaintext in `config.yml` under
`auth.session_secret`. On first server start, if absent, the server
generates `crypto.randomBytes(32)` and appends it to `config.yml` via
the existing atomic-write path (same code as first-run password
generation, just a different field). The secret is never logged.

**Rejected alternative**: separate secrets for the two cookie types.
Adds operational complexity without changing the threat model — both
cookies are equally sensitive in their respective ways.

**Rejected alternative**: persisting the secret in a different file
(e.g., `~/.memon/session-secret`). `config.yml` is already the
single source of truth for auth-related secrets; adding a second
location would split the rotation story.

### D6. 401 vs 403 distinction

We add a meaningful semantic split:
- `401 Unauthorized` — no identity present (anonymous), or owner
  identity rejected (bad password / expired session). Carries
  `WWW-Authenticate: Basic realm="memon"` so curl tools can prompt for
  credentials. Also returned for viewer-cookie holders attempting
  `mutating` or `shell` routes — because mode 3 is not even evaluated on
  those routes (see D1), the middleware doesn't know the requester has
  a viewer cookie, and treats the request as anon.
- `403 Forbidden` — identity accepted as viewer (mode 3 passed for a
  `read` route) but the requested project is OUT OF SCOPE. No
  `WWW-Authenticate` header.

This means 403 happens in exactly one situation: a logged-in viewer
trying to access a `read` route for a project they have NOT been
shared. Every other denial is a 401 (which, for HTML page navigation,
gets rewritten to `302 → /login?next=<path>` so browsers land on the
login form rather than firing the Basic-auth dialog).

For CLI tooling, the contract is "401 means re-authenticate, 403 means
your credentials are fine but the resource is not yours" — the simpler
split keeps existing curl scripts unchanged.

### D7. Anonymous viewer can still attempt login

The `/login` page is in the `anon` route class. A viewer who holds share
cookies but is not logged in can navigate to `/login`, type owner
credentials, and on success the server sets the `memon-session` cookie
WITHOUT clearing `memon-shares`. The middleware then ignores
`memon-shares` while the session is active. On logout, `memon-session` is
cleared and the viewer reverts to share-cookie scope.

The viewer-mode UI banner includes a "Log in as owner" link to make this
discoverable. The `/login` page accepts a `?next=<path>` parameter and
redirects there on success (default `/`).

### D8. UI viewer-mode affordance — disabled, not hidden

Every control that maps to a `mutating` or `shell` route is rendered
visible-but-`disabled` with a tooltip `Viewer mode — action disabled`
when the active session is a viewer. The tooltip uses shadcn's
`Tooltip` primitive. Rationale: tells the viewer "this action exists
but you cannot perform it" — clearer than silently hiding the affordance
(which would leave the viewer confused about what owners can do).

The implementation pattern is a `<ViewerGuard>` wrapper component:

```tsx
<ViewerGuard reason="Edit markdown">
  <Button onClick={openEditor}>Edit markdown</Button>
</ViewerGuard>
```

`ViewerGuard` reads from `useSession()`. If `role === 'viewer'`, it
clones the child and forces `disabled={true}`, wrapping in a
`<Tooltip>` with the reason. If `role === 'owner'`, it renders the
child unchanged.

Sidebar narrows to scope-set projects; the project switcher dropdown is
replaced by a plain label when scope has exactly one project. Settings
page (and `/manage/tmux`) renders a 403 page for viewers.

### D9. Rate limiting — shared bucket across all three modes

The existing per-IP token-bucket (cap 60, refill 60/60s) gates ALL three
auth modes. Each verification consumes a token; refund on success. This
means:
- A brute-force attacker hitting `/api/auth/login` is throttled by the
  same bucket as one hitting Basic auth or trying to guess share tokens.
- A legitimate user with both a valid cookie and a valid Basic header
  uses 1 token (the first passing mode), refunded.
- Share-cookie validation is also a hash compare (constant-time); a
  fake cookie payload that fails signature check uses 1 token.

This keeps the brute-force ceiling at the spec's existing `1 password/s`
across the union of attack surfaces.

### D10. SSE filtering for viewer sessions

The `/api/events` stream broadcasts `run-change` / `experiment-change` /
`anomaly` events. For a viewer session, the SSE handler reads
`req.scopeProjects` from middleware context and filters outgoing events
to those whose payload `.project` (or for run-change, the run's parent
project) is in scope. Anomaly events are dropped if their project is
out of scope.

**Implementation**: the SSE event publisher already tags each event with
a project key; the consumer just filters. No new metadata needed.

## Risks / Trade-offs

[**Cookie size growth**] A viewer collecting many shares accumulates entries
in `memon-shares`. → **Mitigation**: per-project dedup means at most one
entry per project; 50 projects ≈ 3 KB. Document the soft cap in spec.
Browser hard cap is 4 KB.

[**Stale share-cookie entries**] When a share is revoked, viewers
holding that token in their cookie don't proactively know. → **Mitigation**:
middleware silently drops stale entries from scope on each request AND
sets a refresh-write cookie pruning the stale entries from the cookie
payload. Viewer experiences "access disappears" silently, not a 401.

[**Project rename invalidates shares**] If the owner renames a project
(via config.yml), share cookies pointing to the old name stop
validating. → **Mitigation**: document this in the spec as expected
behavior. The CLI `memon share list` can spot orphaned project names.

[**Race on first-run secret generation**] Two server starts in parallel
could both generate a `session_secret`. → **Mitigation**: reuse the
existing `auth.password` first-run mtime-collision check (refuses to
write if `config.yml` mtime changed between read and rename).

[**In-memory index lookup cost in middleware**] Every `/api/runs/<id>`
or `/api/experiments/<id>` request triggers an index lookup. →
**Mitigation**: indices are already kept warm by the polling system;
lookup is O(1) hashmap. Measured cost is negligible (single-digit µs).

[**Misclassified new route silently exposes data**] A new GET handler
not added to `route-classes.ts` defaults to `mutating` (fail-closed)
but its `projectFor` returns `null` (no extraction rule). → **Mitigation**:
this is desirable — unknown routes fail closed. The `route-classes.test.ts`
suite gains a smoke test that enumerates `apps/web/app/api/**/route.ts`
and asserts each has an explicit classification.

[**Login form CSRF**] The `POST /api/auth/login` endpoint accepts
form-encoded credentials. → **Mitigation**: the endpoint is `anon`-
classed (no cookie required to call), but on success it sets the
`memon-session` cookie. An attacker cannot use CSRF here because they
have no way to KNOW the owner's password; the worst they can do is
trick the browser into submitting a wrong-credential request, which
fails. For mutating endpoints, the `memon-session` cookie is
`SameSite=Lax` which already blocks CSRF on most attacks; we also add a
double-submit `csrf` field embedded in the session payload, validated
on mutating requests.

[**Share URL leakage**] The share URL contains a token in plaintext;
copying it into chat/email is the user's responsibility. → **Mitigation**:
document that share URLs are credentials; recommend short `expires_at`;
support easy revocation via the management dialog.

[**Mobile-viewport login page**] New /login page must render on small
viewports. → **Mitigation**: standard shadcn Card responsive defaults
work; verification protocol's UI check applies.

## Migration Plan

This is an additive change with no breaking on-disk format changes.

**Phase A — runtime + auth (single commit / PR):**
1. Add `cfg.auth.session_secret` first-run generation to `loadConfig`.
2. Implement `memon-session` / `memon-shares` cookie helpers (sign / verify).
3. Extend `route-classes.ts` with the `anon` class and `projectFor` extractors.
4. Rewrite middleware to evaluate the three modes + scope.
5. Mirror the changes in `apps/web/server.ts` (WebSocket upgrade).
6. Wire `requireOwner` / `requireScope` helpers as a backstop for the
   three multi-project list handlers.
7. New endpoints: `POST /api/auth/login`, `POST /api/auth/logout`,
   `GET / POST / DELETE /api/projects/<project>/shares`.
8. New page routes: `/login`, `/share/<project>/<token>`.
9. New `@memon/core` shares module + atomic write helpers.
10. New CLI `memon share` subcommands.

**Phase B — UI surface:**
1. `SessionProvider` + `useSession()` + `<ViewerGuard>` primitives.
2. Server-injected `<script id="memon-session">` payload.
3. Apply `<ViewerGuard>` to every gated control (Edit markdown, Open
   Claude Code, Terminal button, Add note, status edit, archive,
   link/unlink, manage/tmux, "Create experiment", warnings mutators,
   "Manage share links" itself).
4. Sidebar narrows to scope-set; banner with "Log in as owner".
5. Project page header "Share" button + manage dialog.

**Phase C — docs:**
1. CLAUDE.md sections updated (HTTP API auth, viewer-mode curl).
2. README "Sharing a project read-only" subsection.
3. `config.example.yml` updated with new optional fields.

**Rollback strategy:**
- Each phase is reversible by reverting the commit. Existing
  `config.yml` files without `auth.session_secret` continue to work
  (key gets auto-generated on next start).
- If the cookie/session flow proves problematic, the middleware
  fall-through to HTTP Basic mode 2 means tooling is unaffected by
  cookie issues.

## Open Questions

1. **Session cookie TTL — 24h, 7d, or 30d?** Default plan: 30 days,
   refreshed on each authenticated request (rolling). Owners on
   their own machines benefit from infrequent re-login; if a session
   leaks, the owner can rotate `auth.session_secret` to invalidate
   all sessions at once.

2. **Should `/api/auth/logout` also clear `memon-shares`?** Default
   plan: NO. Logout clears only the owner session; share cookies
   persist so the viewer reverts to share-cookie scope. A separate
   "Forget shares" affordance can be added later.

3. **CLI auth for `memon share create`?** When run locally on the
   owner's machine, the CLI reads `config.yml` directly (no HTTP
   round-trip). When run against a remote `memon serve` instance
   (e.g., via a future `--remote` flag), it would need HTTP Basic
   credentials. Default plan: local-only for this change; remote
   share management is a follow-up.

4. **Share URL host derivation.** `memon share create` needs to print
   a full URL. Should the host come from `cfg.public_url`,
   `cfg.dashboard.url`, or be required as a flag? Default plan:
   `cfg.public_url` if set, else print a `/share/...` path with a
   note that the operator should prepend their dashboard host.

5. **What happens to in-flight SSE streams when a share is revoked?**
   The connection already passes scope at handshake; events for the
   now-revoked project will simply stop being filtered through.
   Default plan: don't kill in-flight streams; let viewer-mode pages
   poll on focus and discover their scope changed naturally. If this
   proves surprising, add a server-push close on revoke later.
