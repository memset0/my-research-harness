## ADDED Requirements

### Requirement: FS v7 membership edits are one-sided
For FS v7, create-from-run, link, unlink, rename and delete SHALL update Experiment-owned declarations without rewriting a Run README to assign or clear ownership. This replaces v6 bidirectional binding edits. Existing access control, optimistic concurrency and journal invocation recording SHALL remain enforced.

#### Scenario: Link then unlink
- **WHEN** an authorized caller links and unlinks a valid Run path
- **THEN** only the Experiment membership declaration and normal audit state change, and Run README bytes and mtime remain unchanged

#### Scenario: Rename Experiment
- **WHEN** an Experiment is renamed
- **THEN** its project-relative member paths remain valid without rewriting member Run frontmatter
