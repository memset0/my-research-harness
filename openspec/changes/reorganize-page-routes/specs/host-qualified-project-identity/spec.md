## MODIFIED Requirements

### Requirement: Configured namespace and project identify mounted resources
Existing central project identities SHALL remain {host, project}, using the stable configured host namespace rather than a transient hostname. The namespace SHALL NOT require a Backend service and SHALL map to an explicit central-accessible project root. Every Project the Web app serves SHALL have such a {host, project} identity; there is no standalone, Host-less Web identity.

#### Scenario: Equal project names
- **WHEN** two namespaces contain project-a
- **THEN** their file cache, queries and authorization remain distinct despite central storage access

### Requirement: Central routes retain namespace-qualified targets without Backend probes
Canonical central /<host>/<project>/ page routes, legacy /h/<host>/p/<project>/ routes that redirect to them, and Host-qualified share links SHALL retain exact configured identity validation. Public API selectors SHALL not be replaced by raw paths and SHALL not require a live Backend.

#### Scenario: No Backend identity probe
- **WHEN** a canonical Experiment URL such as /host-a/project-a/e/1 is opened
- **THEN** central resolves its configured root without probing a remote application service

## REMOVED Requirements

### Requirement: Legacy navigation resolves configured identities without Backend liveness
**Reason**: Hostless project-only navigation (`/p/<project>/…`) and standalone Web mode are retired; such URLs return 404 and are never resolved to a configured identity, so there is nothing left to disambiguate.
**Migration**: Use the canonical Host-qualified routes `/<host>/<project>/…` (page-routes); Host-qualified `/h/<host>/p/<project>/…` links 308-redirect to them. Hostless bookmarks must be re-created from the Host-qualified page.
