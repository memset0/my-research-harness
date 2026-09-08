## ADDED Requirements

### Requirement: Historical digest reads refresh through shared file observations

Existing digest discovery and read surfaces SHALL remain backed by central primitive file observations and foreground heartbeat queries. Externally added, edited or removed canonical digest files SHALL remain visible after the applicable observation becomes due and a subsequent query retrieves it. No managed digest authoring skill or cursor advance SHALL be required for discovery.

#### Scenario: Existing digest edited outside memon
- **WHEN** a user edits a historical digest with their own editor
- **THEN** the read-only dashboard reflects that file change without any Journal cursor mutation

### Requirement: Historical digests remain readable without managed authoring

Digest list/detail GET contracts and canonical file discovery SHALL remain available. The managed digest editor, PUT route and cursor-driven generation workflow SHALL be removed. Existing files SHALL NOT be deleted, relabelled as wiki evidence, or rewritten during rollout.

#### Scenario: Historical digest after cutover
- **WHEN** a user opens an existing D0001 document
- **THEN** its content is readable and no Edit or digest-generation action is offered

## REMOVED Requirements

### Requirement: Live cache backed by Poller
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Historical digest reads refresh through shared file observations"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: PUT /api/digests/[id]?project=NAME writes with mtime+hash optimistic lock
**Reason**: Managed digest authoring is retired with the Journal knowledge workflow.
**Migration**: Preserve GET/discovery and all file bytes; remove client editor calls and Backend/gateway PUT handling instead of keeping a hidden writer.
