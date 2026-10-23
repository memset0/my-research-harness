## ADDED Requirements

### Requirement: Live services expand like HTML bundles
When a `service` presentation's application is reachable, the dashboard SHALL show it inside the shared embed toolbar used for HTML bundles (zoom, Reload, Open in new tab, Expand and the mobile overflow menu) with the same page-internal expanded view. On a full Report or Wiki page the expanded state SHALL be kept in the `expanded=1` URL parameter exactly as for HTML bundles; side panes SHALL keep a local expanded state. The live embed SHALL load the application directly, without the HTML probe or revision polling, and opening it SHALL never start the application.

#### Scenario: Expand a live application
- **GIVEN** a full Report page whose service is reachable
- **WHEN** the user activates Expand
- **THEN** the application covers the page viewport with the toolbar still available and the URL carries `expanded=1`
- **WHEN** the user presses Escape
- **THEN** the view collapses and `expanded` is removed from the URL

#### Scenario: Offline service shows no embed
- **GIVEN** a service whose availability check fails
- **THEN** the offline guidance is shown and no application iframe or toolbar is mounted
