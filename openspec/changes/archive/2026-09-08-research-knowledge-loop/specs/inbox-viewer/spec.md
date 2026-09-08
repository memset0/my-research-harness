## ADDED Requirements

### Requirement: Managed inbox editing excludes historical digests

Desktop/mobile edit and optimistic-save behavior SHALL continue to apply to supported editable artifacts such as Reports. Digest routes SHALL remain read-only with no Edit action, Monaco mutation mode or PUT call. Existing read layout, selection, mobile navigation, frontmatter display and external-file refresh SHALL remain available.

#### Scenario: Digest route on mobile
- **WHEN** an owner opens a historical Digest on a narrow viewport
- **THEN** reading and file selection work but no edit Sheet can be opened

## MODIFIED Requirements

### Requirement: Empty state copy is kind-specific

The inbox SHALL render kind-specific empty states. Reports SHALL identify memon-write-report as the authoring workflow. Digests SHALL describe the surface as historical documents and direct new research synthesis to Wiki, without advertising the removed digest skill or Journal cursor. Copy SHALL remain a property of the shared layout rather than hardcoded behavior.

#### Scenario: Empty reports directory
- **WHEN** a project has no matching Report files
- **THEN** the pane points to memon-write-report and the rail shows an empty placeholder

#### Scenario: Empty digests directory
- **WHEN** a project has no matching Digest files
- **THEN** the pane identifies a historical digest collection and does not offer the retired digest skill
