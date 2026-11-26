# Spec Delta

## MODIFIED Requirements

### Requirement: Owner manages scoped share links at `/api/shares`
The dashboard SHALL expose owner-only `GET /api/shares[?host=&project=]`, `POST /api/shares` and `DELETE /api/shares/<id>`. Creation SHALL take `{host, project, scope, label?, expires?}` where scope is `{kind: "project"}` or `{kind: "experiment"|"wiki"|"report", id}` with an ID matching that kind's identity rule; it SHALL reject unknown Projects and, for document scope, documents absent from the published catalog. Central SHALL derive the landing path itself: the document's page for document scope; for Project scope, the current page path supplied by the client only when it lies under that Project's route, otherwise the Project root. The response SHALL include the full record and `share_url` (`<public-origin>/s/<token>`). Listing SHALL include each record's scope, landing path, label, creation and expiry, creator, and the token so that the owner can copy a link. Every new record SHALL store the creating account's username; a record without one SHALL be listed as created by the super admin and flagged legacy. The super admin SHALL list and revoke every share. An admin SHALL create shares only on Projects granted to it, and SHALL list and revoke only shares it created; another creator's share SHALL answer like a missing one. Requests from any other identity SHALL be rejected.

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

#### Scenario: Admin sees only its own shares
- **GIVEN** admin `ada` granted `{host-a, project-x}`, one share ada created there and one legacy share
- **WHEN** ada lists shares and tries to revoke the legacy one
- **THEN** the list holds only ada's share and the revoke answers `404`
- **WHEN** the super admin lists shares
- **THEN** both appear, ada's with creator `ada` and the other with the super admin as creator, flagged legacy
