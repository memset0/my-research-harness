## ADDED Requirements

### Requirement: Hypotheses navigation is retired
The dashboard SHALL omit Hypotheses tabs, counters, status badges and Experiment/Run hypothesis panels. Former dedicated page routes SHALL be unavailable; other project pages SHALL continue rendering. This supersedes the historical requirement to preserve Hypotheses URLs.

#### Scenario: Open a legacy project
- **WHEN** a project with historical hypotheses is opened
- **THEN** experiments, Wiki and Reports remain available without Hypotheses navigation or requests
