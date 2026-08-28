## ADDED Requirements

### Requirement: Project read routes share indexed snapshot state
All fixed Backend Project read routes SHALL use the owning Project's shared snapshot generation. ID-addressed routes SHALL use direct indexes, and list/detail/results/files/hypotheses/journal/anomaly routes MUST NOT each trigger an independent recursive discovery pass.

#### Scenario: Mixed read family shares one generation
- **WHEN** a client requests a Project list, an Experiment detail, and a Run detail without an intervening change
- **THEN** every response is derived from one snapshot generation
- **AND** at most zero refreshes occur after that generation is already warm

### Requirement: Project include patterns constrain discovery
Configured Project include/exclude patterns SHALL constrain both snapshot refresh and filesystem monitoring consistently. A narrower machine-local include policy MUST NOT be silently ignored by either path.

#### Scenario: Unrelated nested artifact resembles a Run ID
- **WHEN** a nested artifact directory matches the Run naming regex but is outside the configured include patterns
- **THEN** it is not indexed, monitored, returned, or treated as an anomaly-producing Run

## MODIFIED Requirements

### Requirement: Backend read-only policy is enforced locally
A Backend instance MAY select a local `read_only` access mode for Project-data bootstrap verification. In that mode metadata SHALL advertise the broad mutation, terminal, tmux, Herdr, and other shell/write capabilities as unavailable, and the Backend itself SHALL reject document, Git, Project-data, terminal, tmux, Slurm, and other operational mutations before invoking a provider. Share creation/listing/revocation MAY remain available only through the separately advertised `shares` capability because those operations manage read-only access credentials rather than Project research data. Share-token validation and Project/data GETs MAY remain available. Changing to normal `read_write` mode SHALL require an explicit local configuration change and process restart; `read_write` SHALL remain the default.

#### Scenario: Shadow candidate cannot become a second writer
- **WHEN** a candidate Backend starts with `access_mode: read_only`
- **THEN** central can verify metadata and Project reads while direct authenticated Project-data write or shell requests are rejected even if central misroutes them
- **AND** owner-authorized share create/revoke succeeds only when `capabilities.shares` is true
