## ADDED Requirements

### Requirement: Public pages are readable without identity
A request without owner or viewer identity SHALL be authorized for a `read` route when the request targets a Report or Wiki document that the central share registry marks public for the selected Host-qualified Project, under exactly the rules for document-scoped viewers (the page, its detail, backlinks and bundle assets). Such requests SHALL proceed as a viewer limited to that document, with no cookie issued. Every other route SHALL keep its existing authentication: anonymous page requests are redirected to login and API requests receive 401. A request with viewer identity whose own grants do not cover a public document SHALL also be admitted to it.

#### Scenario: Anonymous reader of a public page
- **GIVEN** `R0005` of `{host-a, project-x}` is public
- **WHEN** an anonymous browser opens its page and the page loads `/api/reports/R0005` and its assets
- **THEN** each request is allowed
- **AND** `/api/reports?host=host-a&project=project-x` and `R0004` still require authentication
