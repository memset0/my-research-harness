## ADDED Requirements

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
