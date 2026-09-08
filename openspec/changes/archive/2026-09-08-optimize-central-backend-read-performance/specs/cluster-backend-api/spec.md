## MODIFIED Requirements

### Requirement: Backend read-only policy is enforced locally
A Backend instance MAY select a local `read_only` access mode for Project-data
bootstrap verification. In that mode metadata SHALL advertise broad mutation
and other write capabilities as unavailable, and the Backend itself SHALL
reject document, Git, Project-data, Slurm, and other operational mutations
before invoking a provider. Share creation/listing/revocation MAY remain
available only through the separately advertised `shares` capability because
those operations manage read-only access credentials rather than Project
research data. Share-token validation and Project/data GETs MAY remain
available. Changing to normal `read_write` mode SHALL require an explicit local
configuration change and process restart; `read_write` SHALL remain the
default.

#### Scenario: Shadow candidate cannot become a second writer
- **WHEN** a candidate Backend starts with `access_mode: read_only`
- **THEN** central can verify metadata and Project reads while direct authenticated Project-data write or shell requests are rejected even if central misroutes them
- **AND** owner-authorized share create/revoke succeeds only when `capabilities.shares` is true
