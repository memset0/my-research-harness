## ADDED Requirements

### Requirement: Skills require full source commit hashes
The Report skill, its HTML bundle reference and the Wiki maintenance reference SHALL require every `source_commits` value to be a full 40-character commit hash obtained with `git rev-parse <revision>`, SHALL forbid abbreviated hashes, and SHALL state that an abbreviated hash makes `memon refresh` refuse the document. The shared preflight SHALL name this as the most common cause of a refused refresh.

#### Scenario: Agent records a Report revision
- **WHEN** an agent records the analyzed revision of a repository in `source_commits`
- **THEN** it writes the 40-character hash from `git rev-parse`, not an abbreviated one, and the following refresh publishes the Report
