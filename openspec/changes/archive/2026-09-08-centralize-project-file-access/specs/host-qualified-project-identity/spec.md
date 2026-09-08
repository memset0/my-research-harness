## ADDED Requirements

### Requirement: Configured namespace and project identify mounted resources
Existing central project identities SHALL remain {host, project}, using the stable configured host namespace rather than a transient hostname. The namespace SHALL NOT require a Backend service and SHALL map to an explicit central-accessible project root. Standalone project identity remains unchanged.

#### Scenario: Equal project names
- **WHEN** two namespaces contain project-a
- **THEN** their file cache, queries and authorization remain distinct despite central storage access

### Requirement: Central routes retain namespace-qualified targets without Backend probes
Existing central /h/<host>/p/<project>/ routes and /share/<host>/<project>/<token> links SHALL retain exact configured identity validation. Public API selectors SHALL not be replaced by raw paths and SHALL not require a live Backend.

#### Scenario: No Backend identity probe
- **WHEN** an existing scoped experiment URL is opened
- **THEN** central resolves its configured root without probing a remote application service

### Requirement: Namespace identity flows through resource polling state
All client requests, resource versions, query/local persistence keys, share scopes and execution targets SHALL retain exact project namespace. Foreground heartbeat responses replace document/list event identities; no name-only key may mix equal-name projects.

#### Scenario: Polling isolation
- **WHEN** two namespaces have equal experiment IDs
- **THEN** a version change for one does not refresh or authorize the other

### Requirement: Legacy navigation resolves configured identities without Backend liveness
Existing project-only navigation SHALL resolve only an explicit standalone project or an unambiguous configured mapping. It SHALL not guess among namespaces or require a live Backend to decide identity.

#### Scenario: Ambiguous project
- **WHEN** a legacy project-only URL matches two namespaces
- **THEN** navigation fails safely or displays selection rather than choosing the first

## REMOVED Requirements

### Requirement: Project identity is a Host and Project tuple
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Configured namespace and project identify mounted resources" in this capability; preserve the public safety and data semantics stated there.

### Requirement: Central routes and APIs require Host-qualified targets
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Central routes retain namespace-qualified targets without Backend probes" in this capability; preserve the public safety and data semantics stated there.

### Requirement: Host identity flows through client and event state
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Namespace identity flows through resource polling state" in this capability; preserve the public safety and data semantics stated there.

### Requirement: Legacy project-only navigation fails safely
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Legacy navigation resolves configured identities without Backend liveness" in this capability; preserve the public safety and data semantics stated there.
