## ADDED Requirements

### Requirement: Central serves configured roots without remote application services
Central SHALL own Web, public API, authentication, document transformations and file scheduling for explicitly configured project roots. Roots MAY be local or externally mounted at arbitrary paths and SHALL not require a directory named mounted. Remote devices SHALL need only CLI/skills for memon data workflows, not a Backend daemon, service token or central proxy tunnel. Mock projects SHALL be explicitly configured.

#### Scenario: Arbitrary mount root
- **WHEN** a valid local config points a project to a mount outside mounted
- **THEN** central reads it through the same file Store as an ordinary directory

#### Scenario: No peer daemon
- **WHEN** no memon Backend runs on a remote device whose project is mounted
- **THEN** central can serve the project without Backend discovery or negotiation

### Requirement: Execution context is explicit and separate from file access
Remote command capabilities SHALL use locally configured SSH execution target and remote working root, not the central mount path or a remote memon Backend. Local projects SHALL retain local execution. Existing owner/read-only restrictions and command-specific behavior SHALL remain in force; no target may be inferred from browser path input.

#### Scenario: Remote process operation
- **WHEN** an authorized user invokes a configured remote Slurm or Git operation
- **THEN** it executes on the exact remote target rather than the central machine or mounted cwd

#### Scenario: Missing execution target
- **WHEN** a mounted project has no configured command provider
- **THEN** file reads remain usable and command capability reports unavailable rather than executing locally

### Requirement: Centralization cutover preserves one writer
Migration SHALL support a private read-only candidate, retain previous deployment/configuration rollback material, quiesce old public writes before switching, verify the central path, and only then retire old Backend services. No filesystem convention migration SHALL be required by transport changes alone.

#### Scenario: Candidate verification
- **WHEN** the prior service is live during candidate read checks
- **THEN** the candidate cannot become a second public writer

#### Scenario: Failed cutover
- **WHEN** post-switch verification fails
- **THEN** the previous service/configuration can be restored before writes resume

### Requirement: Deployment changes are explicit and preserve rollback

Code archival SHALL NOT itself change production hosts, copy research data or import cache snapshots. An operator-authorized deployment SHALL use the selected central host, preserve a rollback source and avoid two writable authorities. A previously delivered private candidate is historical evidence, not a requirement to create another candidate for every archive.

#### Scenario: Archive without deployment
- **WHEN** accepted code and specifications are archived
- **THEN** existing service processes and project data remain unchanged unless deployment is separately requested

## REMOVED Requirements

### Requirement: Central, Backend, and standalone roles have explicit boundaries
**Reason**: The remote Backend hosting model is retired.
**Migration**: Use one central service over explicitly configured roots, remote CLI/skills installations, and a single-writer cutover.

### Requirement: Central and Backend are independently buildable and installable
**Reason**: The remote Backend hosting model is retired.
**Migration**: Use one central service over explicitly configured roots, remote CLI/skills installations, and a single-writer cutover.

### Requirement: Production local Backend is explicit
**Reason**: The remote Backend hosting model is retired.
**Migration**: Use one central service over explicitly configured roots, remote CLI/skills installations, and a single-writer cutover.

### Requirement: Bootstrap prevents two public writable control planes
**Reason**: The remote Backend hosting model is retired.
**Migration**: Use one central service over explicitly configured roots, remote CLI/skills installations, and a single-writer cutover.
