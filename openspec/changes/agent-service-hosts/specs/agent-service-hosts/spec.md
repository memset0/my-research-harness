## ADDED Requirements

### Requirement: Service ports may name a cluster host

A File Agent project's `servicePorts` SHALL accept bare integers, forwarded to `127.0.0.1:<port>`, and objects `{ "host": string, "port": integer }`, forwarded to `<host>:<port>`. The host SHALL be an IP address or a DNS hostname without scheme, path or port, and a port SHALL appear at most once; otherwise the configuration SHALL be refused at load. Unknown object fields SHALL be refused. A service request SHALL name only the port; the host SHALL never come from the request or a document. Grant, identity and admission checks SHALL be unchanged. A connection failure (5 seconds) or a missing response header (10 seconds) from the upstream SHALL answer `SOURCE_UNAVAILABLE`. The agent SHALL advertise `service-hosts-v1`.

#### Scenario: Dashboard on another node
- **WHEN** `servicePorts` contains `{ "host": "gpu-node-1", "port": 8792 }` and a granted client requests `/v1/services/project-a/8792/`
- **THEN** the agent forwards the request to `gpu-node-1:8792` and returns its response

#### Scenario: Unreachable host
- **WHEN** the configured host refuses the connection
- **THEN** the agent answers `SOURCE_UNAVAILABLE` (HTTP 503)
