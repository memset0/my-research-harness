# project-share Specification

## Purpose
TBD - created by archiving change share-project-via-login. Update Purpose after archive.

## Requirements

### Requirement: Per-project share secret store at `<projectRoot>/.memon/shares.json`

Each project SHALL own its own list of share-link records, stored in a JSON file at `<projectRoot>/.memon/shares.json`. The schema is:

```json
{
  "version": 1,
  "shares": [
    {
      "id": "shr_<8 base64url chars>",
      "token": "<24 base64url chars>",
      "label": "string (optional, max 64 chars)",
      "created_at": "ISO8601 with timezone offset",
      "expires_at": "ISO8601 with timezone offset | null"
    }
  ]
}
```

Records SHALL be stored plaintext (consistent with `cfg.auth.password` plaintext storage under the same single-user threat model). Each project's `token` values SHALL be drawn from `crypto.randomBytes(18)` Base64URL-encoded (24 chars) — same shape as the first-run password — so they are independently strong even across projects. Writes SHALL be atomic via temp-file + rename, AND SHALL ensure the `.memon/` directory exists before writing.

#### Scenario: Reading a project with no shares.json
- **WHEN** `readShares(projectRoot)` is called and `<projectRoot>/.memon/shares.json` does not exist
- **THEN** the function returns `{ version: 1, shares: [] }`
- **AND** no file is created on disk

#### Scenario: Reading a malformed shares.json
- **WHEN** `<projectRoot>/.memon/shares.json` contains invalid JSON OR fails schema validation (e.g., missing `version`, `shares[].id` not a string)
- **THEN** `readShares` throws a `ShareStoreError` whose message identifies the offending field
- **AND** the server's middleware logs the error and treats the project as having zero valid shares (fail-closed; the viewer's cookie entries for that project silently stop working)

#### Scenario: Atomic write
- **WHEN** `addShare(projectRoot, { ... })` writes a new record
- **THEN** the write goes through a temp file and atomic rename
- **AND** a concurrent reader during the write either sees the old file in full OR the new file in full, never a torn read

#### Scenario: `.memon/` directory auto-created
- **WHEN** `addShare` is called on a project whose `.memon/` does not exist
- **THEN** `.memon/` is created with mode 0755 before the temp-file write
- **AND** the resulting `shares.json` is mode 0644

### Requirement: `addShare(projectRoot, opts)` allocates fresh token and ID

`addShare` SHALL generate a fresh token from `crypto.randomBytes(18)` Base64URL-encoded (24 chars) and a fresh id of the shape `shr_<8 base64url chars from crypto.randomBytes(6)>`. The new record's `created_at` SHALL be the current local time in ISO8601 with timezone offset (NOT UTC-converted). `expires_at` SHALL default to `null` unless the caller passes `opts.expires`. The function SHALL append to the existing `shares` array and return the full new record.

#### Scenario: New share generated
- **WHEN** `addShare(projectRoot, { label: "Alice" })` is called
- **THEN** the returned record has `token` (24 chars), `id` starting with `shr_` (12 chars total), `label: "Alice"`, `created_at` ISO8601 with TZ, `expires_at: null`
- **AND** the shares.json file on disk has the new record appended

#### Scenario: ID collision retried
- **WHEN** `addShare` happens to generate an `id` that collides with an existing entry's id
- **THEN** the function retries up to 5 times with a fresh id
- **AND** on the 5th collision it throws a `ShareStoreError` (vanishingly unlikely in practice; this is a defense)

#### Scenario: Expires-at honored
- **WHEN** `addShare(projectRoot, { expires: "30d" })` is called
- **THEN** the returned record's `expires_at` is `created_at + 30 days` in ISO8601+TZ

### Requirement: `revokeShare(projectRoot, idOrLabelPrefix, opts)` removes a record

`revokeShare` SHALL find a single record whose `id` starts with the given prefix OR whose `label` equals (exact match) the argument, remove it from the array, and atomically rewrite `shares.json`. If multiple records match the prefix/label, the function SHALL throw `AmbiguousShareError` unless `opts.force === true`. If no record matches, it SHALL throw `ShareNotFoundError`.

#### Scenario: Unique id-prefix match
- **WHEN** `revokeShare(projectRoot, "shr_abc")` matches exactly one record
- **THEN** the record is removed from shares.json
- **AND** the function returns the removed record

#### Scenario: Ambiguous prefix
- **WHEN** the prefix matches two or more records' ids
- **THEN** the function throws `AmbiguousShareError` with the matching ids listed
- **AND** shares.json is not modified

#### Scenario: Label exact match
- **WHEN** `revokeShare(projectRoot, "Alice")` and exactly one record has `label: "Alice"`
- **THEN** that record is removed

### Requirement: Share landing URL `/share/<project>/<token>` mints a viewer cookie

`GET /share/<project>/<token>` SHALL be in the `anon` route class (no identity required). The handler SHALL:

1. Validate `<project>` is a known configured project (resolved via `cfg.projects` or runtime cache). If not, respond 404 (do NOT reveal that the project name is unknown vs. that the token is wrong — return a generic "Share link invalid or expired" page).
2. Read `<projectRoot(<project>)>/.memon/shares.json`. Validate that `<token>` exists in the array AND that `expires_at` is `null` OR in the future.
3. The token comparison SHALL use `crypto.timingSafeEqual` on equal-length buffers (constant-time).
4. On failure, respond 404 with the same generic page; consume a rate-limit token (no refund).
5. On success:
   - Read the request's existing `memon-shares` cookie (if any). If signature is valid, decode the entries; drop any entry with `entry.project === <project>` (dedup — newest token wins per project); append `{ project: <project>, token: <token> }`. If no existing cookie or signature invalid, start fresh with just the new entry.
   - HMAC-sign the new payload using `cfg.auth.session_secret`. Set the `memon-shares` cookie: HTTPOnly, SameSite=Lax, Path=`/`, Max-Age=`90 days`, Secure when request scheme is `https`.
   - Refund the rate-limit token (success path).
   - Respond 302 → `/p/<project>`.

#### Scenario: Anonymous viewer opens a valid share URL
- **WHEN** an anonymous browser GETs `/share/project-a/<valid-token>` with no cookies
- **THEN** the response is 302 to `/p/project-a`
- **AND** the response sets a `memon-shares` cookie containing one signed entry `{ project: "project-a", token: <valid-token> }`
- **AND** the cookie attributes include `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=7776000` (90 days)

#### Scenario: Viewer with existing shares opens a new share URL
- **WHEN** the request carries `memon-shares` with `[{project:"project-a",...}]` AND visits `/share/project-b/<valid-token>`
- **THEN** the response 302s to `/p/project-b`
- **AND** the `memon-shares` cookie is updated to include BOTH entries (`project-a` AND `project-b`)

#### Scenario: Viewer revisits a share URL for an already-shared project
- **WHEN** the cookie has `{project:"project-a", token:"OLD"}` and the viewer opens `/share/project-a/NEW` (a fresh share for the same project)
- **THEN** the cookie's `project-a` entry is REPLACED with the new token (newest wins)
- **AND** the cookie has exactly one entry for `project-a`

#### Scenario: Invalid token
- **WHEN** the path token does not match any record in shares.json (or has expired)
- **THEN** the response is 404 with a generic "Share link invalid or expired" page
- **AND** no cookie is set
- **AND** a rate-limit token is consumed without refund

#### Scenario: Unknown project name
- **WHEN** `<project>` is not a configured project
- **THEN** the response is 404 with the same generic page (does NOT distinguish "unknown project" from "bad token")

#### Scenario: Logged-in owner opens a share URL
- **WHEN** an owner (with valid `memon-session`) opens `/share/project-a/<valid-token>`
- **THEN** the cookie is still set (owner accumulates share cookies; this is harmless because the owner's session takes precedence in middleware)
- **AND** the response 302s to `/p/project-a`

### Requirement: `memon-shares` cookie payload format with HMAC signature

The `memon-shares` cookie value SHALL be Base64URL-encoded JSON of the shape:

```json
{
  "v": 1,
  "entries": [
    { "project": "<name>", "token": "<24b64>" }
  ],
  "sig": "<base64url HMAC-SHA256 over the canonical-JSON of {v, entries} using cfg.auth.session_secret>"
}
```

The signature SHALL be verified before the cookie's entries are trusted. The canonical JSON form SHALL be JSON.stringify with keys in lexicographic order. A cookie that fails signature verification SHALL be treated as absent (NOT cause a 4xx — anonymous viewers without share cookies are valid).

#### Scenario: Valid cookie signature
- **WHEN** the cookie payload's `sig` matches `HMAC-SHA256(session_secret, JSON.canonical({v, entries}))`
- **THEN** the entries are trusted by middleware

#### Scenario: Tampered cookie
- **WHEN** an attacker modifies an entry in the cookie payload but cannot recompute the HMAC
- **THEN** middleware sees the signature mismatch and treats the cookie as absent
- **AND** the user is effectively anonymous

#### Scenario: Cookie signed by old secret
- **WHEN** the owner has rotated `cfg.auth.session_secret` and a viewer revisits with a cookie signed by the old secret
- **THEN** the signature check fails
- **AND** the cookie is silently ignored
- **AND** the viewer reverts to anonymous (and must reopen their share URLs to obtain new tokens)

### Requirement: Viewer-scope projection from `memon-shares` cookie

On every request to a `read`-classed route where no owner identity passed (mode 1+2 both failed), middleware SHALL compute `scopeProjects: Set<string>` from the `memon-shares` cookie as follows:

1. If no cookie OR signature invalid: `scopeProjects = ∅` (empty).
2. Decode entries.
3. For each entry, validate `<entry.token>` against `<projectRoot(entry.project)>/.memon/shares.json` (in-memory cached, invalidated on share CRUD events).
4. If `expires_at` is set and in the past, drop the entry.
5. Include `entry.project` in `scopeProjects` only if validation passes.
6. If any entry was dropped, set a response cookie that re-encodes the pruned entries with a fresh signature (so stale entries don't linger).

The set SHALL be made available to handlers via a request-local context (e.g., `req.scopeProjects`).

For requests to `shell` and `mutating` routes, middleware SHALL NOT decode `memon-shares` at all — the cookie is irrelevant on those classes (see auth-system spec, "HTTP Basic auth gates all dashboard and API routes"). Such requests, when no owner identity is present, get the standard anon-handling (401 with `WWW-Authenticate` for API, 302 to /login for HTML pages).

#### Scenario: All entries valid
- **WHEN** the cookie has entries for `project-a` and `project-b`, both still valid
- **THEN** `scopeProjects = {"project-a", "project-b"}`
- **AND** no refresh cookie is set on the response

#### Scenario: One entry revoked
- **WHEN** the cookie has entries for `project-a` (valid) and `project-b` (token removed from shares.json since)
- **THEN** `scopeProjects = {"project-a"}` for this request
- **AND** the response sets a refreshed `memon-shares` cookie containing ONLY the `project-a` entry

#### Scenario: Expired entry
- **WHEN** the cookie has an entry whose share record's `expires_at` is past
- **THEN** the entry is dropped from `scopeProjects`
- **AND** the entry is pruned from the refresh cookie

#### Scenario: All entries invalid
- **WHEN** every entry in the cookie has been revoked or expired
- **THEN** `scopeProjects = ∅`
- **AND** the response sets `memon-shares` to expire immediately (`Max-Age=0`), clearing the cookie

### Requirement: Owner mode dominates viewer cookie

When BOTH a valid `memon-session` (owner) OR a valid `Authorization: Basic` AND a `memon-shares` cookie are present on the request, the owner identity SHALL take precedence. The `memon-shares` cookie SHALL NOT affect access decisions while the owner identity is active. The cookie SHALL be preserved (not cleared) so that on logout the viewer reverts to share-cookie scope.

#### Scenario: Owner with share cookies
- **WHEN** a request carries valid `memon-session` AND a `memon-shares` cookie with entries for project-a
- **THEN** the request is owner-scoped (full access across all projects)
- **AND** the `memon-shares` cookie is not modified by the response

#### Scenario: Logged-in owner visits a share URL
- **WHEN** an owner GETs `/share/project-a/<valid-token>` (already logged in)
- **THEN** the share URL handler still validates the token and appends the entry to `memon-shares`
- **AND** the response 302s to `/p/project-a` (owner-scoped, but the cookie carries the share entry for later)

#### Scenario: Logout reveals viewer scope
- **WHEN** an owner-with-shares calls `POST /api/auth/logout`
- **THEN** the response clears `memon-session` but preserves `memon-shares`
- **AND** subsequent requests are evaluated as viewer with `scopeProjects` projected from the share cookie

### Requirement: Stale share cookies do NOT 401 the viewer

When a viewer's `memon-shares` cookie has zero validating entries (all revoked or expired), middleware SHALL emit a silent refresh that clears the cookie and treat the request as anonymous. On an HTML page request, the response SHALL redirect (302) to `/login` so the user has a path forward; on an API request, the response SHALL be 401 with `WWW-Authenticate: Basic realm="memon"`.

The viewer SHALL NOT receive a confusing "your shares have been revoked" message — silent transition to anonymous is the contract (consistent with the share-link threat model: shares are credentials; revocation = silent loss of access).

#### Scenario: Last share revoked while viewer is browsing
- **WHEN** the owner revokes the viewer's only share and the viewer navigates to `/p/that-project`
- **THEN** middleware drops the entry, refreshes the cookie to empty, sets `memon-shares Max-Age=0`, and 302s to `/login?next=/p/that-project`

### Requirement: `memon share` CLI subcommands

The CLI SHALL expose three subcommands under `memon share`:

- `memon share create <project> [--label X] [--expires <duration>] [--format human|json]` — appends a record to `<projectRoot>/.memon/shares.json` and prints the share URL on stdout. Duration is one of `<int>d`, `<int>h`, or `never` (default).
- `memon share list [--project P] [--format human|json]` — lists share records across all configured projects (or filtered to `P`). Default JSON; `--format human` for a table.
- `memon share revoke <id-prefix-or-label> [--project P] [--force]` — removes the matching record. Requires `--project` when the id/label is ambiguous across projects (or `--force` to revoke all matching).

Each subcommand SHALL resolve `<projectRoot>` from `cfg.projects` (via the existing config loader). Each SHALL exit non-zero on error and print a short message to stderr.

#### Scenario: `memon share create` with default options
- **WHEN** an owner runs `memon share create project-a --format human`
- **THEN** the command appends a record to `<projectRootForProjectA>/.memon/shares.json`
- **AND** stdout contains a single line of the form `https://<host>/share/project-a/<token>` (host from `cfg.public_url` if set, else a `/share/project-a/<token>` path with a note about prepending the dashboard URL)

#### Scenario: `memon share list --project P`
- **WHEN** the project `P` has 2 share records
- **THEN** the JSON output is an array of 2 entries, each with `{ id, project, label, created_at, expires_at }` (NOT the `token`, which is omitted to avoid leaking when piped into logs)

#### Scenario: `memon share revoke <prefix>` unique
- **WHEN** `memon share revoke shr_abc --project P` matches exactly one record in P
- **THEN** that record is removed
- **AND** stdout prints `revoked <id> from <project>` (or JSON equivalent)

#### Scenario: `memon share revoke` ambiguous without `--project`
- **WHEN** the prefix matches records in two projects and neither `--project` nor `--force` is given
- **THEN** the command exits non-zero with a stderr message listing the candidate `(project, id)` pairs

### Requirement: Web API for share management at `/api/projects/<project>/shares`

The web dashboard SHALL expose owner-only CRUD endpoints under `/api/projects/<project>/shares`:

- `GET` — returns the project's share records (JSON, same shape as the CLI listing — `token` is OMITTED from the response by default to avoid leaking; clients that need the token to render a URL request `?reveal=true`, which is itself owner-only).
- `POST` — body `{ label?, expires? }` — creates a new share and returns the full record INCLUDING `token` and the constructed share URL.
- `DELETE /<id>` — revokes the record.

All three endpoints SHALL be classified `mutating` (or `read` for the GET; both require owner). Viewer attempts SHALL receive `403 Forbidden`.

#### Scenario: Owner lists shares
- **WHEN** an owner GETs `/api/projects/project-a/shares`
- **THEN** the response is 200 with JSON `{ shares: [{ id, label, created_at, expires_at, ... }] }` (no `token`)

#### Scenario: Owner creates a share
- **WHEN** an owner POSTs `{ label: "Alice", expires: "30d" }` to `/api/projects/project-a/shares`
- **THEN** the response is 201 with `{ share: { id, token, label, created_at, expires_at, share_url }, ... }`

#### Scenario: Viewer attempts to manage shares
- **WHEN** a viewer session GETs `/api/projects/project-a/shares`
- **THEN** the response is 403 Forbidden (NOT 401 — the viewer is authenticated, just under-privileged)

### Requirement: Central share identity is Host-qualified
New central share URLs SHALL use `/share/<host>/<project>/<token>`, and viewer cookie entries SHALL store `{host, project, token}`. A share for one Host SHALL not authorize an equal-name Project on another Host.

#### Scenario: Same Project name has independent shares
- **WHEN** Host A and Host B both expose `project-x` and only Host A token is redeemed
- **THEN** the viewer can read Host A's Project but receives 403 for Host B's

### Requirement: Owning Backend validates and stores share state
Share creation, listing, revocation, expiry, and landing validation SHALL route to the exact owning Backend Project. Central SHALL mint/refresh the viewer cookie only after that Backend validates the token. An offline/unusable Backend SHALL not mint or revalidate access.

#### Scenario: Revocation takes effect through central
- **WHEN** a share is revoked on its owning Backend
- **THEN** later central requests prune or reject that Host-qualified viewer scope

### Requirement: Legacy share landing is migration-only and fail-safe
A legacy project-only share URL MAY be supported during bootstrap only through an explicitly configured migration Host or a unique unambiguous validation result. It SHALL never select the first Host by name. Newly created central shares SHALL always use the Host-qualified form.

#### Scenario: Ambiguous legacy share does not grant access
- **WHEN** a legacy share cannot be bound to exactly one Host
- **THEN** central rejects it without adding any viewer scope
