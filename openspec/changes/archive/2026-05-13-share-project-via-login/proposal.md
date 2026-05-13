## Why

Today there is no way for the owner of a memon dashboard to let a collaborator
look at a single project's runs / experiments / reports without handing over the
owner's HTTP Basic credentials. Sharing the credentials gives the recipient full
read-write access to every project, plus the ability to open in-browser
terminals and spawn Claude Code sessions — that's a non-starter for showing
results to advisors, reviewers, or remote teammates.

The existing `auth-system` spec already anticipated this: it carved out
`read` / `mutating` / `shell` route classes and stated that future work MAY
relax `read` routes via a share-link token while `mutating` and `shell` SHALL
remain owner-only. This change cashes in that anticipation.

Adding share-links requires more than a token check — once there are two
distinct roles (owner vs. project-scoped viewer), per-request
`Authorization: Basic` verification stops being the right primitive for the
browser, because basic-auth carries no identity beyond the username and offers
no clean way to attach a list of scoped projects to a session. So we also
introduce a session-cookie login flow for browser traffic, while keeping HTTP
Basic as the tooling fallback for CLI / curl automation that is already wired
up across CLAUDE.md and dev scripts.

## What Changes

- **NEW** owner login UI for browsers: a `/login` page that POSTs to
  `/api/auth/login`; on success the server sets a signed session cookie
  (`memon-session`, HTTPOnly, SameSite=Lax, HMAC-SHA256 payload encoding
  `{role:"owner", exp}`) and redirects to the originally requested URL.
  Owner credentials (username + plaintext password) keep living in
  `config.yml`'s existing `auth` block; there is no user registration,
  only login.
- **NEW** per-project share secrets stored at
  `<projectRoot>/.memon/shares.json`. Each project owns its own list of
  share records (plaintext, one secret per share, never reused across
  projects). Schema:
  ```json
  {
    "version": 1,
    "shares": [
      { "id": "shr_<8b64>", "token": "<24b64>",
        "label": "optional", "created_at": "ISO8601+TZ",
        "expires_at": "ISO8601+TZ | null" }
    ]
  }
  ```
  Tokens are 24-char base64url from `crypto.randomBytes(18)` (same shape
  as the first-run password).
- **NEW** share link mechanism: when the owner creates a share for
  project `P`, the server appends a record to `P`'s `shares.json` and
  returns a URL `https://<host>/share/<project>/<token>`. Opening that
  URL:
  1. Validates the token against `P`'s `shares.json` (constant-time
     compare, rate-limited by the existing token-bucket).
  2. Appends `{project: P, token}` to the viewer's `memon-shares`
     cookie (dedup by project — newest token wins per project; cookie
     is HTTPOnly, SameSite=Lax, Path=/, Max-Age=90 days, server-signed
     so the viewer can't fabricate entries).
  3. Redirects to `/p/<project>`.
- **NEW** three-mode middleware. On every request the middleware
  evaluates auth in this order, and the FIRST passing mode wins
  (subsequent modes are ignored):
  1. **Owner session cookie** (`memon-session` validates) → role=owner,
     full access. Refunds the rate-limit token on success.
  2. **Owner HTTP Basic** (`Authorization: Basic` matches
     `cfg.auth.username` + plaintext `cfg.auth.password`) → role=owner,
     full access. CLI / curl tooling fallback. Refunds the rate-limit
     token on success.
  3. **Viewer share cookie** (`memon-shares` decodes to a list and at
     least one `{project, token}` entry validates against that
     project's `shares.json`) → role=viewer, scope is the SET of
     projects whose entries currently validate. Stale entries (token
     removed from JSON, or `expires_at` past) are silently dropped
     from the in-request scope (and from the cookie on the response
     via a refresh-write).
  
  Each mode evaluates independently; later modes are tried only if the
  earlier ones did not produce a passing identity. A user who has
  share cookies AND is also logged in is treated as OWNER (mode 1
  wins, mode 3 ignored). A user who has share cookies but is not
  logged in CAN still navigate to `/login` (the login page is
  anonymous-accessible) and authenticate as owner; their share cookies
  remain set but become inert while the session is active.
- **NEW** route classification gets a fourth class, `anon`, for routes
  reachable without any identity: `/login` (GET, POST in the form of
  `/api/auth/login`), `/api/auth/check`, `/share/<project>/<token>`
  landing, static assets. Classes are now `anon | read | mutating |
  shell`. The catch-all default remains `mutating` (fail-closed).
- **NEW** viewer-scope enforcement: for `mutating` and `shell` routes,
  viewer sessions SHALL receive `403 Forbidden` (not 401 — they ARE
  authenticated, just under-privileged). For `read` routes, viewer
  sessions SHALL only succeed when the route's project (extracted from
  URL path `/p/<project>` / `/e/<project>/<expid>` segments OR from a
  `project=` query / route parameter) matches one of the projects in
  the viewer's validated scope set. Cross-project reads → 403.
- **NEW** `memon share` CLI subcommands:
  - `memon share create <project> [--label X] [--expires <duration>]` →
    appends to `<projectRoot>/.memon/shares.json`, prints the share URL.
  - `memon share list [--project P]` → tabular listing of all share
    records (across all projects, or filtered).
  - `memon share revoke <id-prefix-or-label> [--project P]` → removes
    the matching record from the project's shares.json (force flag
    required for ambiguous matches).
- **NEW** "Manage share links" dialog in the web UI, anchored on the
  project page header. Lists existing shares with `Created`,
  `Label`, `Expires`, `Copy URL`, `Revoke` columns. Backed by
  `GET / POST / DELETE /api/projects/:project/shares` (owner-only).
- **NEW** viewer-mode UI affordance: every dashboard control that maps
  to a `mutating` or `shell` route SHALL render visible-but-disabled
  with the tooltip `Viewer mode — action disabled` when the active
  session is a viewer. Specifically: Edit markdown / Edit README,
  Open Claude Code, Open browser terminal, Status edit, Add journal
  entry, Add note, Archive, Link / Unlink experiment, every CRUD
  button under `/manage/tmux`, the "Create experiment" affordance,
  every Warnings-table mutator, the "Manage share links" button
  itself. The sidebar in viewer mode SHALL list ONLY the projects in
  the viewer's scope set; the project switcher is replaced by a
  read-only label when scope has exactly one project. A small
  viewer-mode banner on `<body>` identifies the session and shows a
  "Log in as owner" button that links to `/login`.
- **NEW** SSE filtering: the `run-change`, `experiment-change`, and
  `anomaly` events SHALL be filtered server-side for viewer sessions
  so a viewer only receives events for projects in their scope. This
  avoids leaking the existence or names of other projects through SSE.
- **MODIFIED** config schema: `cfg.auth` gains a single new optional
  field `session_secret: string` (HMAC key for `memon-session` and
  `memon-shares` cookies). The server auto-generates one on first
  start if absent and writes it back via the existing atomic-write
  path. No new field is required to exist for first-run to complete.
  **Share records do NOT live in `config.yml`**; they live in each
  project's `.memon/shares.json`.
- **DOC** updated CLAUDE.md verification protocol: clarifies that
  `-u "$MEMON_USER:$MEMON_PASS"` (HTTP Basic) is the curl fallback
  and remains supported; adds a section on inspecting viewer-mode UI
  by setting the `memon-shares` cookie manually. README's
  "Production deployment" section gets a "Sharing a project read-only"
  subsection covering the share-URL distribution flow.

This is an additive change. Every existing CLI flow keeps working
(Basic auth path unchanged), the browser-side change is additive
(`/login` appears, but Basic-auth requests still succeed if a cookie
isn't present), and there is no on-disk format migration for existing
`config.yml` files. New `<projectRoot>/.memon/shares.json` files
are created only when the owner first issues a share for that project.

## Capabilities

### New Capabilities

- `project-share`: per-project share-link tokens stored at
  `<projectRoot>/.memon/shares.json`, the `memon share` CLI family,
  the `/share/<project>/<token>` landing route, the `memon-shares`
  cookie format, the server-side share scope-computation, and the
  contract that viewer sessions are project-scoped read-only.

### Modified Capabilities

- `auth-system`: introduces the three-mode middleware (owner-cookie,
  owner-Basic, viewer-share-cookie) with explicit precedence; the
  `/login` page; the `/api/auth/login` / `/api/auth/logout` endpoints;
  the `memon-session` cookie format (HMAC-signed payload); the `anon`
  route class; the 403-vs-401 distinction for scope denial. Existing
  Basic-auth scenarios remain valid; new scenarios cover cookie auth,
  viewer-cookie scope, the cross-project read denial, and the
  precedence rule when multiple auth modes are simultaneously present.
- `web-dashboard`: viewer-mode UI affordance — every mutating/shell
  action renders visible-but-disabled with a tooltip in viewer
  sessions; sidebar narrows to scope-set projects; a viewer-mode
  banner with "Log in as owner" link appears across pages; the
  project page header gains a "Manage share links" button (owner-only).
- `memon-cli`: adds the `memon share {create,list,revoke}` subcommand
  family; existing CLI surface unchanged.

## Impact

A deliberate design goal is to **minimize per-handler backend churn**.
Scope enforcement is centralized in middleware via the existing
`route-classes.ts` source-of-truth. Individual handlers are touched only
when they inherently aggregate across projects (list endpoints) or when
they are brand-new (auth + share management). Concrete touchpoints:

- **Auth middleware** (`apps/web/middleware.ts`, `apps/web/lib/auth/*`)
  — primary site of behavior change. Rewrite the verification path to:
  1. Evaluate the three modes in order (cookie / Basic / share-cookie)
     with shared rate-limit accounting.
  2. Compute `{role, scopeProjects: Set<string>}` once per request.
  3. Use the extended `route-classes.ts` to look up the route's
     `{class, projectFor}` rule. `projectFor(req)` returns either:
     - a project name (extracted from `/p/<project>`,
       `/api/projects/<project>`, `?project=<p>`, OR an in-memory
       index lookup for `/api/runs/<id>` / `/api/experiments/<id>`),
     - `'multi'` (the route aggregates across projects — the handler
       is responsible for filtering),
     - `'global'` (the route is project-independent, owner-only), or
     - `null` (no extraction possible — fail closed as `'global'`).
  4. Apply the policy: owner passes everything; viewer passes only
     `read` routes whose `projectFor` resolves to a name in
     `scopeProjects` OR resolves to `'multi'` (where the handler will
     filter); viewer is `403` on `mutating`, `shell`, or
     out-of-scope `read`. `anon` routes pass for all roles.
  
  Result: a new `/api/runs/[id]` (or any new id-addressed route) gets
  scope enforcement FOR FREE the moment it is added to
  `route-classes.ts` — no per-handler guard needed.
- **Route classification** (`apps/web/lib/auth/route-classes.ts`):
  add the `anon` class, the `projectFor` extractor per rule, and the
  in-memory-index lookup helper. This file becomes the single source
  of truth for "what's gated and how".
- **Custom server WebSocket upgrade** (`apps/web/server.ts`): the
  `/api/terminal/proxy/*` upgrade reuses the same three-mode evaluator
  but only modes 1 and 2 (owner) pass; viewer cookies short-circuit
  to 403. One small change, mirroring middleware.
- **Multi-project list handlers — the ONLY handler files that need
  filtering**: 
  - `GET /api/projects` → filter list to viewer's `scopeProjects`.
  - `GET /api/anomalies` → filter results to viewer's scope.
  - `GET /api/events` (SSE) → filter outgoing events by project.
  
  These three are the only places where a list endpoint may otherwise
  leak project names cross-scope. Every OTHER existing handler keeps
  its current code unchanged.
- **New endpoints — total of five**:
  - `GET /login` (page) — anon-accessible login form.
  - `POST /api/auth/login` — validates credentials, sets `memon-session`.
  - `POST /api/auth/logout` — clears `memon-session` (keeps
    `memon-shares` so the user reverts to viewer mode if applicable).
  - `GET /share/<project>/<token>` (page route, anon-accessible) —
    validates the share token, sets/updates `memon-shares` cookie,
    302 → `/p/<project>`.
  - `GET / POST / DELETE /api/projects/<project>/shares` — owner-only
    CRUD for share records.
- **`@memon/core` config schema** (`packages/core/src/config/*`):
  extend `AuthConfig` with optional `session_secret: string` only.
  No share records in `config.yml`.
- **`@memon/core` shares module** (new
  `packages/core/src/shares/*`): `readShares(projectRoot)`,
  `addShare(projectRoot, opts)`, `revokeShare(projectRoot, idOrLabel)`,
  `validateShare(projectRoot, token)`. Atomic writes via temp-file +
  rename. Reuses the path-assertion helper from `fs-version` for
  `.memon/` directory handling.
- **CLI** (`packages/cli/src/commands/share.ts` new + `index.ts`):
  `memon share create|list|revoke` subcommands; each is a thin wrapper
  over the new `@memon/core` shares helpers + a `console.log` of the
  resulting share URL.
- **Dashboard UI**:
  - New `SessionProvider` React context at the layout level, populated
    from a server-injected `<script id="memon-session" type="application/json">`
    carrying `{ role, scopeProjects }`.
  - `useSession()` hook + `<ViewerGuard>` wrapper component for
    disabling mutating buttons.
  - New `/login` page (shadcn `<Card>` + `<Input>` + `<Button>` + form).
  - New "Manage share links" dialog component (shadcn `<Dialog>` +
    `<Table>` + per-row Copy/Revoke buttons).
  - New viewer-mode banner component (shadcn `<Alert>` variant) with
    a "Log in as owner" link to `/login`.
- **Tests**:
  - Three-mode middleware matrix (anon, owner-cookie-only, owner-
    Basic-only, viewer-cookie-only, owner-cookie + viewer-cookie,
    owner-Basic + viewer-cookie, invalid combinations).
  - Rate-limit interplay: cookie failures drain the bucket; cookie
    successes refund; share-cookie validation also drains/refunds.
  - Scope enforcement matrix per route class, exercised through the
    middleware (NOT per handler), covering cross-project read 403,
    mutating 403, shell 403, in-scope read 200, multi-project list
    filtering.
  - `projectFor` extractor unit tests for every URL shape it must
    recognize (path segments, query params, id-resolution via
    in-memory index).
  - Shares JSON atomic-write + read-after-write parity tests.
  - CLI `share create/list/revoke` smoke tests.
  - UI snapshot for viewer-mode disabled state across all gated
    buttons; SessionProvider hydration matches server payload.
- **Docs**:
  - CLAUDE.md "HTTP API auth" section: paragraph on cookie/Basic
    dual path; section on injecting a `memon-shares` cookie for
    viewer-mode curl inspection.
  - README "Production deployment": new "Sharing a project read-only"
    subsection.
  - `config.example.yml`: optional `auth.session_secret: <auto>`
    placeholder with a comment explaining auto-generation.
