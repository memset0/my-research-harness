## MODIFIED Requirements

### Requirement: Viewer-scope projection from `memon-shares` cookie

On every request to a `read`-classed route where no owner identity passed (mode 1+2 both failed), middleware SHALL compute `scopeProjects: Set<string>` from the `memon-shares` cookie as follows:

1. If no cookie OR signature invalid: `scopeProjects = ∅` (empty).
2. Decode entries.
3. For each entry, validate `<entry.token>` against the central share registry record of the entry's Host-qualified Project `{host, project}`. Tokens stored in a project's `.memon/shares.json` SHALL NOT validate.
4. If `expires_at` is set and in the past, drop the entry.
5. Include the entry's Host-qualified Project in `scopeProjects` only if validation passes.
6. If any entry was dropped, set a response cookie that re-encodes the pruned entries with a fresh signature (so stale entries don't linger).

The set SHALL be made available to handlers via a request-local context (e.g., `req.scopeProjects`).

For requests to `shell` and `mutating` routes, middleware SHALL NOT decode `memon-shares` at all — the cookie is irrelevant on those classes (see auth-system spec, "HTTP Basic auth gates all dashboard and API routes"). Such requests, when no owner identity is present, get the standard anon-handling (401 with `WWW-Authenticate` for API, 302 to /login for HTML pages).

#### Scenario: All entries valid
- **WHEN** the cookie has entries for `project-a` and `project-b`, both still valid
- **THEN** `scopeProjects = {"project-a", "project-b"}`
- **AND** no refresh cookie is set on the response

#### Scenario: One entry revoked
- **WHEN** the cookie has entries for `project-a` (valid) and `project-b` (its record revoked from the central share registry since)
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

#### Scenario: Project-local token no longer validates
- **WHEN** the cookie has an entry whose token exists only in `project-a`'s `.memon/shares.json`
- **THEN** the entry is dropped and grants no scope

### Requirement: Owner mode dominates viewer cookie

When BOTH a valid `memon-session` (owner) OR a valid `Authorization: Basic` AND a `memon-shares` cookie are present on the request, the owner identity SHALL take precedence. The `memon-shares` cookie SHALL NOT affect access decisions while the owner identity is active. The cookie SHALL be preserved (not cleared) so that on logout the viewer reverts to share-cookie scope.

#### Scenario: Owner with share cookies
- **WHEN** a request carries valid `memon-session` AND a `memon-shares` cookie with entries for project-a
- **THEN** the request is owner-scoped (full access across all projects)
- **AND** the `memon-shares` cookie is not modified by the response

#### Scenario: Logged-in owner visits a share URL
- **WHEN** an owner GETs `/host-a/project-a?share=<valid-token>` (already logged in)
- **THEN** the share handler still validates the token and appends the entry to `memon-shares`
- **AND** the response 302s to `/host-a/project-a` (owner-scoped, but the cookie carries the share entry for later)

#### Scenario: Logout reveals viewer scope
- **WHEN** an owner-with-shares calls `POST /api/auth/logout`
- **THEN** the response clears `memon-session` but preserves `memon-shares`
- **AND** subsequent requests are evaluated as viewer with `scopeProjects` projected from the share cookie

### Requirement: Stale share cookies do NOT 401 the viewer

When a viewer's `memon-shares` cookie has zero validating entries (all revoked or expired), middleware SHALL emit a silent refresh that clears the cookie and treat the request as anonymous. On an HTML page request, the response SHALL redirect (302) to `/login` so the user has a path forward; on an API request, the response SHALL be 401 with `WWW-Authenticate: Basic realm="memon"`.

The viewer SHALL NOT receive a confusing "your shares have been revoked" message — silent transition to anonymous is the contract (consistent with the share-link threat model: shares are credentials; revocation = silent loss of access).

#### Scenario: Last share revoked while viewer is browsing
- **WHEN** the owner revokes the viewer's only share and the viewer navigates to `/host-a/that-project`
- **THEN** middleware drops the entry, refreshes the cookie to empty, sets `memon-shares Max-Age=0`, and 302s to `/login?next=/host-a/that-project`

### Requirement: Central share identity is Host-qualified
New central share URLs SHALL be the canonical page URL of the shared page (as defined by the page-routes capability) on the configured public origin carrying a `share=<token>` query parameter, and viewer cookie entries SHALL store `{host, project, token}`. Central SHALL construct this public URL from its configured public origin after validating the exact owning Backend's create response; it SHALL NOT return a Backend-internal URL or a Backend DTO that omits `share_url`. A share for one Host SHALL not authorize an equal-name Project on another Host. The earlier Host-qualified share URL `GET /share/<host>/<project>/<token>` SHALL keep working: it SHALL respond with a redirect (302) to `/<host>/<project>?share=<token>`, where the token is redeemed like any page link, and SHALL NOT itself set a cookie.

#### Scenario: Central creates a canonical share URL
- **WHEN** an owner creates a Project-scoped share for `{host-a, project-x}` from the Project root through central
- **THEN** the response contains `https://<public-origin>/host-a/project-x?share=<token>`
- **AND** opening that link redeems only the `{host-a, project-x}` viewer scope

#### Scenario: Same Project name has independent shares
- **WHEN** Host A and Host B both expose `project-x` and only Host A token is redeemed
- **THEN** the viewer can read Host A's Project but receives 403 for Host B's

#### Scenario: Earlier Host-qualified share link redirects
- **WHEN** an anonymous browser opens `/share/host-a/project-x/<token>`
- **THEN** the response is a 302 to `/host-a/project-x?share=<token>` and sets no cookie
- **AND** following it redeems the token for `{host-a, project-x}` only

### Requirement: Central validates authoritative project share state
Central SHALL issue, list, validate and revoke share tokens through a central share registry stored beside the instance configuration with owner-only file permissions, written atomically. Each record SHALL hold `id`, `token`, optional `label`, Host, Project, scope (`project`, or one `experiment`, `wiki` or `report` document by ID), landing path, `created_at` and `expires_at`. Central SHALL NOT read or write `.memon/shares.json` in project roots, and tokens stored there SHALL NOT grant access. A registry record without a Host SHALL NOT grant access. Token validation and revocation SHALL not be authorized from stale display-cache results; a registry that cannot be read SHALL fail closed for new and revalidated access. Revocation SHALL delete the record so the next validation rejects the token.

New records SHALL store the canonical landing path. A record whose stored landing path uses an older form (`/h/<host>/p/<project>/…`, or a hostless `/p/<project>/…` of the record's Project) SHALL, whenever it is used to land a viewer or to build a share URL, be mapped to the canonical path of the same page under the record's Host and Project, following the legacy mapping of the page-routes capability; a stored path that maps to no page SHALL become the Project root `/<host>/<project>`. This mapping SHALL NOT rewrite the registry file.

#### Scenario: Revoke centrally
- **WHEN** an owner revokes a share
- **THEN** subsequent token validation rejects it without any Backend request

#### Scenario: Storage unavailable
- **WHEN** authoritative share state cannot be validated
- **THEN** central does not grant new or revalidated access using a stale positive observation

#### Scenario: Read-only Project
- **WHEN** an owner shares a page of a read-only or File-Agent Project
- **THEN** the token is issued from the central registry without writing to the Project

#### Scenario: Old-format landing path is used canonically
- **WHEN** a registry record for `{host-a, project-x}` stores the landing path `/h/host-a/p/project-x/reports/R0005`
- **THEN** its listed `share_url` is `https://<public-origin>/host-a/project-x/r/5?share=<token>` and `/s/<token>` lands on `/host-a/project-x/r/5`
- **AND** the registry file still holds the stored path unchanged

### Requirement: Owner manages scoped share links at `/api/shares`
The dashboard SHALL expose owner-only `GET /api/shares[?host=&project=]`, `POST /api/shares` and `DELETE /api/shares/<id>`. Creation SHALL take `{host, project, scope, label?, expires?}` where scope is `{kind: "project"}` or `{kind: "experiment"|"wiki"|"report", id}` with an ID matching that kind's identity rule; it SHALL reject unknown Projects and, for document scope, documents absent from the published catalog. Central SHALL derive the landing path itself, always as a canonical path: the document's canonical page (`/<host>/<project>/e/<n>`, `/w/<n>` or `/r/<n>`) for document scope; for Project scope, the current page path supplied by the client only when it is a canonical page path under that Project's `/<host>/<project>` route, otherwise the Project root `/<host>/<project>`. The response SHALL include the full record and `share_url` (the landing page's canonical URL on the public origin with `share=<token>` appended, or the plain page URL for a public record). Listing SHALL include each record's scope, landing path, label, creation and expiry, and the token so that the owner can copy a link. Requests without owner identity SHALL be rejected. This endpoint and the Web share dialog SHALL be the only ways to create shares.

#### Scenario: Share one Wiki page
- **WHEN** an owner on `/host-a/project-x/w/4` creates `{scope: {kind: "wiki", id: "W0004"}}`
- **THEN** the record's landing path is `/host-a/project-x/w/4` and the response contains `https://<public-origin>/host-a/project-x/w/4?share=<token>`

#### Scenario: Landing path cannot leave the Project
- **WHEN** a Project-scoped create supplies a current path outside `/host-a/project-x`
- **THEN** the landing path is the Project root `/host-a/project-x`

#### Scenario: Owner sees and revokes scopes
- **WHEN** the owner lists shares for `{host-a, project-x}`
- **THEN** each record shows whether it opens the whole Project or one named document
- **WHEN** the owner deletes one record
- **THEN** its link no longer grants access

#### Scenario: Experiment share lands on its number
- **WHEN** an owner creates `{scope: {kind: "experiment", id: "E0010-inference-kernels"}}` for `{host-a, project-x}`
- **THEN** the record's landing path is `/host-a/project-x/e/10`

### Requirement: Share link `/s/<token>` lands on the issued page
`GET /s/<token>` SHALL be an `anon` route. It SHALL validate the token against the central registry in constant time, reject unknown or expired tokens with the generic invalid-link page and a consumed rate-limit token, and on success add `{host, project, token}` to the `memon-shares` cookie and redirect (302) to the canonical URL of the record's landing page (an older stored landing path is mapped as described in "Central validates authoritative project share state"). Cookie entries SHALL be deduplicated by token, not by Project, so that several document shares of one Project coexist, and the cookie SHALL keep at most 32 entries, dropping the oldest.

#### Scenario: Recipient opens a page link
- **WHEN** an anonymous browser opens a valid `/s/<token>` issued for `R0005`
- **THEN** it receives the viewer cookie and lands on that Report's page

#### Scenario: Two page links of one Project
- **WHEN** a viewer opens links for `W0004` and then `R0005` of the same Project
- **THEN** both pages remain readable

#### Scenario: Landing uses the canonical URL
- **WHEN** an anonymous browser opens a valid `/s/<token>` issued for `R0005` of `{host-a, project-x}`
- **THEN** the redirect target is `/host-a/project-x/r/5`

### Requirement: Share links are page URLs carrying the token
The share URL returned on creation and listed for copying SHALL be the record's canonical landing page URL on the public origin with a `share=<token>` query parameter appended. A GET of a page URL carrying `share` SHALL be handled before ordinary authentication: when the token is a valid unexpired registry token of the Host-qualified Project named by the requested path, and the requested path is any page path under that Project's `/<host>/<project>` route, the response SHALL add `{host, project, token}` to the viewer cookie (deduplicated by token, bounded) and redirect (302) to the same URL without the `share` parameter; otherwise it SHALL answer with the generic invalid-link page and keep the consumed rate-limit token. A legacy `/h/<host>/p/<project>/…` URL carrying `share` SHALL first be redirected to its canonical URL with the `share` parameter kept, and redeemed there. `/s/<token>` links issued earlier SHALL continue to work.

#### Scenario: Copy and open a page link
- **WHEN** the owner copies a link for Report `R0005` and a recipient opens it
- **THEN** the URL is `/<host>/<project>/r/5?share=<token>`
- **AND** the recipient is redirected to `/<host>/<project>/r/5` with the viewer cookie set

#### Scenario: Token for another Project
- **WHEN** a valid token of Project A is appended to a page of Project B
- **THEN** the generic invalid-link page is returned and no cookie is set

#### Scenario: Old page link with a token
- **WHEN** a recipient opens `/h/host-a/p/project-x/reports/R0005?share=<token>`
- **THEN** the browser is redirected to `/host-a/project-x/r/5?share=<token>`, where the token is redeemed and the browser lands on `/host-a/project-x/r/5`

### Requirement: Share dialog offers page links and public pages
The share dialog SHALL copy links in the canonical page-URL form, SHALL offer "Make public" on Report and Wiki pages (and show when the current page already is public), and SHALL list public pages distinctly from token links. Copying a listed Project-scoped token link SHALL produce the canonical URL of the page currently open (its path and query without any existing `share` parameter, and without a fragment) with `share=<token>` appended; document-scoped token links and public pages SHALL copy their own record link.

#### Scenario: Make the current Report public
- **WHEN** the owner on `R0005` chooses "Make public"
- **THEN** the page URL is copied and the list shows "Public · Report R0005"

#### Scenario: Copy a whole-Project link from another page
- **WHEN** a whole-Project link was issued from the Project root and the owner copies it while on `/<host>/<project>/r/6?expanded=1`
- **THEN** the copied URL is `/<host>/<project>/r/6?expanded=1&share=<token>` on the public origin

#### Scenario: Copy a page link from another page
- **WHEN** the owner copies a link scoped to `W0004` while on `R0006`
- **THEN** the copied URL is the `W0004` page URL `/<host>/<project>/w/4` with `share=<token>`

## REMOVED Requirements

### Requirement: Per-project share secret store at `<projectRoot>/.memon/shares.json`
**Reason**: Shares live only in the central share registry; the per-project store and its library functions are retired together with standalone Web mode.
**Migration**: Issue a replacement link from the Web share dialog. Existing `.memon/shares.json` files are ignored and may be deleted by the operator; they are not read or written.

### Requirement: `addShare(projectRoot, opts)` allocates fresh token and ID
**Reason**: The per-project share store is retired; tokens and ids are allocated only by the central share registry.
**Migration**: Create shares through the Web share dialog or `POST /api/shares`.

### Requirement: `revokeShare(projectRoot, idOrLabelPrefix, opts)` removes a record
**Reason**: The per-project share store is retired; revocation happens only in the central share registry.
**Migration**: Revoke shares from the Web share dialog or with `DELETE /api/shares/<id>`.

### Requirement: Share landing URL `/share/<project>/<token>` mints a viewer cookie
**Reason**: A hostless share URL cannot name a Host, and its tokens came from the retired per-project store. Share links are canonical page URLs carrying `share=<token>`; `/s/<token>` and `/share/<host>/<project>/<token>` keep working.
**Migration**: Recipients of hostless links need a new link issued from the Web share dialog; `/share/<project>/<token>` now returns the generic invalid-link page (404).

### Requirement: `memon share` CLI subcommands
**Reason**: The CLI share commands wrote the retired per-project store. Shares are created, listed and revoked only in the Web share dialog or through `/api/shares`.
**Migration**: Use the share entry in the dashboard AppBar, or `GET`/`POST /api/shares` and `DELETE /api/shares/<id>` with owner credentials.

### Requirement: Web API for share management at `/api/projects/<project>/shares`
**Reason**: This standalone-only API managed the retired per-project store and already answered 410 in central mode; standalone Web mode is removed.
**Migration**: Use `GET`/`POST /api/shares` and `DELETE /api/shares/<id>`.

### Requirement: Legacy share landing is migration-only and fail-safe
**Reason**: The hostless share landing and its `central.legacy_share_host` migration Host are retired.
**Migration**: Remove `central.legacy_share_host` from the configuration and issue new Host-qualified links from the Web share dialog.

## ADDED Requirements

### Requirement: Retired share entry points grant no access
The hostless share landing `GET /share/<project>/<token>` SHALL respond with the generic invalid-link page (404) for every token, SHALL set no cookie and SHALL consume a rate-limit token. The configuration loader SHALL reject a configuration that sets `central.legacy_share_host` with an error stating that the key was removed together with hostless share links. No request, endpoint or command SHALL create, validate or revoke a share through a project's `.memon/shares.json`; shares SHALL be created only through the Web share dialog or `POST /api/shares`.

#### Scenario: Hostless share link
- **WHEN** an anonymous browser opens `/share/project-a/<token>`
- **THEN** the response is the generic invalid-link page with status 404
- **AND** no `memon-shares` cookie is set

#### Scenario: Removed configuration key
- **WHEN** the Web app loads a configuration whose `central` block sets `legacy_share_host: host-a`
- **THEN** loading fails with an error saying `central.legacy_share_host` was removed

#### Scenario: Project-local token on a page URL
- **WHEN** `project-a` on `host-a` has a `.memon/shares.json` holding `<token>` and a browser opens `/host-a/project-a?share=<token>`
- **THEN** the generic invalid-link page is returned and no cookie is set
