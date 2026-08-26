## ADDED Requirements

### Requirement: Herdr integration is Host-scoped in central mode
Herdr availability, workspace discovery, launch, attach, and terminal targets SHALL be advertised by and executed on the selected Host's Backend. Central SHALL not run a remote Host's Herdr command locally and SHALL include Host in all related targets and state.

#### Scenario: Herdr launch executes on owning Host
- **WHEN** the owner opens Herdr for a Project on Host A
- **THEN** Host A's Backend invokes its configured Herdr integration and central relays the resulting terminal only through Host A

### Requirement: Missing Herdr capability fails locally to the Host
A Host that is offline, incompatible, or advertises Herdr disabled SHALL not offer a Herdr launch action. This SHALL not disable Herdr on another usable Host.

#### Scenario: One Host lacks Herdr
- **WHEN** Host A advertises Herdr false and Host B advertises true
- **THEN** only Host B offers the integration and Host A receives no Herdr request
