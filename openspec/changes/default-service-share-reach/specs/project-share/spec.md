# Spec Delta

## MODIFIED Requirements

### Requirement: Share entry offers page or Project scope
The share entry in the app bar SHALL, on an Experiment, Report or Wiki page, offer "This page only" (default) or "Whole project" for a new link, and elsewhere in a Project issue Project-scoped links. On a Report or Wiki page with the `service` presentation, "This page only" SHALL issue a service link for that page and state that recipients can use the live application including its writes, "Whole project" SHALL state that the link does not reach that application, and a page link SHALL NOT be creatable until the page's presentation is known. It SHALL copy the new link, list the Project's issued tokens with their scope (whole Project, or the kind and ID of the shared document), label, creation and expiry, and let the owner copy or revoke each one.

#### Scenario: Issue from a Report page
- **WHEN** the owner opens the share entry on `R0005` and keeps the default
- **THEN** a link scoped to `R0005` is created, copied and listed as "Report R0005"

#### Scenario: Issue from a service page
- **WHEN** the owner opens the share entry on service Wiki `W0004` and keeps the default
- **THEN** a service link for `W0004` is created, copied and listed as "Service · Wiki W0004"
- **AND** a recipient opening it can use the application

#### Scenario: Whole project from a service page
- **WHEN** the owner on service Wiki `W0004` selects "Whole project"
- **THEN** the dialog states that the link does not reach this page's live application
- **AND** the created link is Project-scoped without the service

#### Scenario: Earlier page link of a service page
- **WHEN** a page link for `W0004` was issued before this behavior
- **THEN** it stays listed as "Wiki W0004" and still does not reach the service
