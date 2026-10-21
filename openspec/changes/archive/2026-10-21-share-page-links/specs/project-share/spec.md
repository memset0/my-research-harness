## ADDED Requirements

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
The share dialog SHALL copy links in the page-URL form, SHALL offer "Make public" on Report and Wiki pages (and show when the current page already is public), and SHALL list public pages distinctly from token links.

#### Scenario: Make the current Report public
- **WHEN** the owner on `R0005` chooses "Make public"
- **THEN** the page URL is copied and the list shows "Public · Report R0005"
