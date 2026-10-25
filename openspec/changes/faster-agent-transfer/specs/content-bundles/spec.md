## ADDED Requirements

### Requirement: Slow HTML documents keep loading

The HTML embed SHALL bound the probe for response headers by 15 seconds and SHALL allow the document itself 2 minutes to finish loading before showing an error.

#### Scenario: A large report over a slow source
- **WHEN** an HTML document's headers arrive promptly but its body takes 40 seconds
- **THEN** the embed shows the document when it finishes, with no timeout error
