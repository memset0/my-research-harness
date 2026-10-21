## MODIFIED Requirements

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

## ADDED Requirements

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
