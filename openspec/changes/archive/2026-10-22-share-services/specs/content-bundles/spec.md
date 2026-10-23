## MODIFIED Requirements

### Requirement: Dynamic content uses authenticated source forwarding
The server SHALL forward streaming HTTP and WebSocket traffic to the manifest-declared service through the configured local, SSHFS or File Agent access mode. Browser input SHALL NOT select arbitrary hosts or ports. Central authentication credentials SHALL NOT reach upstream applications. File Agent forwarding SHALL enforce mTLS project grants, source pinning and an operator service-port allowlist. Dynamic application access SHALL require owner authentication or a valid service share grant for exactly that Host, Project and document, since application requests need not be read-only; no other share grant SHALL admit it. Path escapes and invalid manifests SHALL fail before connecting. Offline services SHALL return a recoverable unavailable response without application execution.

#### Scenario: Transport parity
- **WHEN** an owner opens the same service via native, SSHFS and File Agent projects
- **THEN** response bytes, streaming and WebSocket behavior are preserved through each transport
- **AND** an offline service does not launch automatically

#### Scenario: Unauthorized port
- **WHEN** a File Agent client requests a port absent from that project's allowlist
- **THEN** forwarding is refused even when the client can read the project's files

#### Scenario: Browser credentials
- **WHEN** a request authenticated with memon cookies or Basic credentials reaches the gateway
- **THEN** those credentials are consumed centrally and omitted from the forwarded application request

#### Scenario: Service grant for another document
- **WHEN** a viewer holding the service grant of `R0010` requests the service of `R0012`
- **THEN** forwarding is refused
