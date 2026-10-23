# project-share Specification

## Purpose
Manage project-scoped viewer credentials under owner authority without broadening read-only research-data permissions.

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
New central share URLs SHALL use `/share/<host>/<project>/<token>`, and viewer cookie entries SHALL store `{host, project, token}`. Central SHALL construct this public URL from its configured public origin after validating the exact owning Backend's create response; it SHALL NOT return a Backend-internal URL or a Backend DTO that omits `share_url`. A share for one Host SHALL not authorize an equal-name Project on another Host.

#### Scenario: Central creates a canonical share URL
- **WHEN** an owner creates a share for `{host-a, project-x}` through central
- **THEN** the response contains `https://<public-origin>/share/host-a/project-x/<token>`
- **AND** opening that link redeems only the `{host-a, project-x}` viewer scope

#### Scenario: Same Project name has independent shares
- **WHEN** Host A and Host B both expose `project-x` and only Host A token is redeemed
- **THEN** the viewer can read Host A's Project but receives 403 for Host B's

### Requirement: Legacy share landing is migration-only and fail-safe
A legacy project-only share URL MAY be supported during bootstrap only through an explicitly configured migration Host or a unique unambiguous validation result. It SHALL never select the first Host by name. Newly created central shares SHALL always use the Host-qualified form.

#### Scenario: Ambiguous legacy share does not grant access
- **WHEN** a legacy share cannot be bound to exactly one Host
- **THEN** central rejects it without adding any viewer scope

### Requirement: Share migration does not transfer authority
Centralization SHALL preserve existing share records, namespace identity and owner-first authentication, including preemptive Basic support without browser Basic challenges. Removing Backend transport SHALL not silently reassign a share to another project.

#### Scenario: Existing share link
- **WHEN** a valid existing host-qualified link is opened after centralization
- **THEN** it resolves to the same project scope using its mounted share state

### Requirement: Central validates authoritative project share state
Central SHALL issue, list, validate and revoke new share tokens through a central share registry stored beside the instance configuration with owner-only file permissions, written atomically. Each record SHALL hold `id`, `token`, optional `label`, Host (or none outside central mode), Project, scope (`project`, or one `experiment`, `wiki` or `report` document by ID), landing path, `created_at` and `expires_at`. Central SHALL NOT write `.memon/shares.json` in project roots. Share records already present in a project's `.memon/shares.json` SHALL keep validating as Project-scoped tokens for their existing links. Token validation and revocation SHALL not be authorized from stale display-cache results; a registry that cannot be read SHALL fail closed for new and revalidated access. Revocation SHALL delete the record so the next validation rejects the token.

#### Scenario: Revoke centrally
- **WHEN** an owner revokes a share
- **THEN** subsequent token validation rejects it without any Backend request

#### Scenario: Storage unavailable
- **WHEN** authoritative share state cannot be validated
- **THEN** central does not grant new or revalidated access using a stale positive observation

#### Scenario: Read-only Project
- **WHEN** an owner shares a page of a read-only or File-Agent Project
- **THEN** the token is issued from the central registry without writing to the Project

### Requirement: Owner manages scoped share links at `/api/shares`
The dashboard SHALL expose owner-only `GET /api/shares[?host=&project=]`, `POST /api/shares` and `DELETE /api/shares/<id>`. Creation SHALL take `{host, project, scope, label?, expires?}` where scope is `{kind: "project"}` or `{kind: "experiment"|"wiki"|"report", id}` with an ID matching that kind's identity rule; it SHALL reject unknown Projects and, for document scope, documents absent from the published catalog. Central SHALL derive the landing path itself: the document's page for document scope; for Project scope, the current page path supplied by the client only when it lies under that Project's route, otherwise the Project root. The response SHALL include the full record and `share_url` (`<public-origin>/s/<token>`). Listing SHALL include each record's scope, landing path, label, creation and expiry, and the token so that the owner can copy a link. Requests without owner identity SHALL be rejected.

#### Scenario: Share one Wiki page
- **WHEN** an owner on `/h/host-a/p/project-x/wiki/W0004` creates `{scope: {kind: "wiki", id: "W0004"}}`
- **THEN** the record's landing path is `/h/host-a/p/project-x/wiki/W0004` and the response contains `https://<public-origin>/s/<token>`

#### Scenario: Landing path cannot leave the Project
- **WHEN** a Project-scoped create supplies a current path outside `/h/host-a/p/project-x`
- **THEN** the landing path is the Project root

#### Scenario: Owner sees and revokes scopes
- **WHEN** the owner lists shares for `{host-a, project-x}`
- **THEN** each record shows whether it opens the whole Project or one named document
- **WHEN** the owner deletes one record
- **THEN** its link no longer grants access

### Requirement: Share link `/s/<token>` lands on the issued page
`GET /s/<token>` SHALL be an `anon` route. It SHALL validate the token against the central registry in constant time, reject unknown or expired tokens with the generic invalid-link page and a consumed rate-limit token, and on success add `{host, project, token}` to the `memon-shares` cookie and redirect (302) to the record's landing path. Cookie entries SHALL be deduplicated by token, not by Project, so that several document shares of one Project coexist, and the cookie SHALL keep at most 32 entries, dropping the oldest.

#### Scenario: Recipient opens a page link
- **WHEN** an anonymous browser opens a valid `/s/<token>` issued for `R0005`
- **THEN** it receives the viewer cookie and lands on that Report's page

#### Scenario: Two page links of one Project
- **WHEN** a viewer opens links for `W0004` and then `R0005` of the same Project
- **THEN** both pages remain readable

### Requirement: Share entry offers page or Project scope
The share entry in the app bar SHALL, on an Experiment, Report or Wiki page, offer "This page only" (default) or "Whole project" for a new link, and elsewhere in a Project issue Project-scoped links. It SHALL copy the new link, list the Project's issued tokens with their scope (whole Project, or the kind and ID of the shared document), label, creation and expiry, and let the owner copy or revoke each one.

#### Scenario: Issue from a Report page
- **WHEN** the owner opens the share entry on `R0005` and keeps the default
- **THEN** a link scoped to `R0005` is created, copied and listed as "Report R0005"

### Requirement: Share links are page URLs carrying the token
The share URL returned on creation and listed for copying SHALL be the record's landing page URL on the public origin with a `share=<token>` query parameter appended. A GET of a page URL carrying `share` SHALL be handled before ordinary authentication: when the token is a valid unexpired registry token whose Host-qualified Project route contains the requested path, the response SHALL add `{host, project, token}` to the viewer cookie (deduplicated by token, bounded) and redirect (302) to the same URL without the `share` parameter; otherwise it SHALL answer with the generic invalid-link page and keep the consumed rate-limit token. `/s/<token>` links issued earlier SHALL continue to work.

#### Scenario: Copy and open a page link
- **WHEN** the owner copies a link for Report `R0005` and a recipient opens it
- **THEN** the URL is `/h/<host>/p/<project>/reports/R0005?share=<token>`
- **AND** the recipient is redirected to `/h/<host>/p/<project>/reports/R0005` with the viewer cookie set

#### Scenario: Token for another Project
- **WHEN** a valid token of Project A is appended to a page of Project B
- **THEN** the generic invalid-link page is returned and no cookie is set

### Requirement: Owners can make Report and Wiki pages public
An owner SHALL be able to mark one Report or Wiki page of a Project public through `POST /api/shares` with `public: true` and a `report` or `wiki` scope; other scopes SHALL be rejected, and repeating the request for an already public page SHALL return the existing record. Public records SHALL be listed with the other share records, marked public, with the page's plain URL as their link, and revoking the record SHALL make the page private again.

#### Scenario: Publish and unpublish a Wiki page
- **WHEN** the owner makes `W0004` public
- **THEN** the list shows it as public with the page URL
- **WHEN** the owner revokes that record
- **THEN** anonymous readers of `W0004` are refused again

### Requirement: Share dialog offers page links and public pages
The share dialog SHALL copy links in the page-URL form, SHALL offer "Make public" on Report and Wiki pages (and show when the current page already is public), and SHALL list public pages distinctly from token links. Copying a listed Project-scoped token link SHALL produce the URL of the page currently open (its path and query without any existing `share` parameter, and without a fragment) with `share=<token>` appended; document-scoped token links and public pages SHALL copy their own record link.

#### Scenario: Make the current Report public
- **WHEN** the owner on `R0005` chooses "Make public"
- **THEN** the page URL is copied and the list shows "Public · Report R0005"

#### Scenario: Copy a whole-Project link from another page
- **WHEN** a whole-Project link was issued from the Project root and the owner copies it while on `/h/<host>/p/<project>/reports/R0006?expanded=1`
- **THEN** the copied URL is `/h/<host>/p/<project>/reports/R0006?expanded=1&share=<token>` on the public origin

#### Scenario: Copy a page link from another page
- **WHEN** the owner copies a link scoped to `W0004` while on `R0006`
- **THEN** the copied URL is the `W0004` page URL with `share=<token>`

### Requirement: Owners can share one service
An owner SHALL be able to issue a service link through `POST /api/shares` with `service: true` and a `report` or `wiki` scope whose document has the `service` presentation; other scopes, other presentations and `public` together with `service` SHALL be rejected. A service record SHALL carry its own token, land on the document's page and be listed (marked as a service) and revoked like other records. Its token SHALL admit the document's page and reads like a page link and, in addition, every method and WebSocket of that document's service. Project, page and public grants SHALL NOT admit any service. A viewer cookie MAY hold a service token beside other tokens of the same Project; the grants of all its valid tokens SHALL combine. A service URL opened directly with `share=<token>` SHALL redeem a service link for exactly that document into the viewer cookie and redirect to the same URL without the token, so the application never receives it; any other valid-format token SHALL get the invalid-link page, and a `share` value that is not token-shaped SHALL pass through to the application.

#### Scenario: Share a live dashboard
- **WHEN** the owner on service Report `R0010` creates a service link
- **THEN** the list shows "Service · Report R0010" and the copied URL is the `R0010` page URL with `share=<token>`
- **AND** a recipient opening it sees the page and can use the application, including its writes

#### Scenario: Project token does not reach the service
- **WHEN** a viewer holding only a whole-Project token of the same Project requests `R0010`'s service
- **THEN** the gateway refuses it

#### Scenario: Two tokens in one browser
- **WHEN** a viewer holds a whole-Project token and the `R0010` service token of that Project
- **THEN** every page of the Project is readable and the `R0010` service is usable, while other services stay refused

#### Scenario: Not a service
- **WHEN** the owner requests a service link for a Markdown Report
- **THEN** the request is rejected and no record is created

#### Scenario: Service URL opened directly
- **WHEN** a recipient opens `R0010`'s service URL with its service token in `share=`
- **THEN** the token joins the viewer cookie, the browser is redirected to the same service URL without `share`, and the application loads
- **AND** the same URL with a page or Project token shows the invalid-link page
