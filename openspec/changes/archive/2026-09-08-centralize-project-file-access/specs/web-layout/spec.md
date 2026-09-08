## ADDED Requirements

### Requirement: Page freshness occupies the left footer
The existing footer SHALL place page dependency freshness and queued/checking/error status at bottom-left and move existing Git/release information to bottom-right. It SHALL follow file-access-settings freshness semantics and remain readable at mobile widths without obscuring content or removing version access.

#### Scenario: Desktop footer
- **WHEN** a cached page is displayed during a queued refresh
- **THEN** the left footer shows its age and queue status and Git/version remains on the right

#### Scenario: Narrow viewport
- **WHEN** the footer is rendered at phone width
- **THEN** status and version remain accessible without overlapping page controls
