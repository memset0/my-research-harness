## ADDED Requirements

### Requirement: Process role selection via config
A memon process SHALL select its role from config: a `node` block runs it as a node, a `hub` block runs it as a hub, and neither block present preserves the current single-process (standalone) behavior. The `hub` and `node` blocks SHALL be mutually exclusive; config load SHALL fail with a clear error if both are present. A node process runs **headless** — `runtime.ts` plus the hub WS client — and SHALL NOT serve the browser UI (the hub does).

#### Scenario: Node block starts a node
- **WHEN** config.yml contains a `node:` block with `name`, `auth_token`, and `hub_url`
- **THEN** the process starts in node mode and dials the configured hub

#### Scenario: Both blocks present is rejected
- **WHEN** config.yml contains BOTH a `hub:` and a `node:` block
- **THEN** config load fails with an error naming the mutual-exclusivity violation

#### Scenario: Neither block is standalone
- **WHEN** config.yml contains neither a `hub:` nor a `node:` block
- **THEN** the process runs exactly as today (single-process), with no hub/node behavior

### Requirement: Node dials the hub over WebSocket with reconnect
A node SHALL open an outbound WebSocket connection to `node.hub_url`, and on disconnect SHALL re-dial with exponential backoff until reconnected. The node, not the hub, SHALL always initiate the connection.

#### Scenario: Node connects on startup
- **WHEN** a node process starts with a reachable `hub_url`
- **THEN** it establishes a WebSocket to the hub and is ready to serve RPC

#### Scenario: Reconnect after drop
- **WHEN** an established node-to-hub WebSocket drops
- **THEN** the node retries with increasing backoff and resumes serving once reconnected

### Requirement: Per-node Bearer-token authentication
A node SHALL authenticate its WebSocket handshake with `Authorization: Bearer <node.auth_token>`. The hub SHALL accept only tokens that match an entry in `hub.nodes[]` (compared in constant time) and SHALL associate the connection with that entry's node name; any unmatched token SHALL be rejected with HTTP 401.

#### Scenario: Valid token is accepted and named
- **WHEN** a node connects with a Bearer token matching a `hub.nodes[].auth_token`
- **THEN** the hub accepts the connection and registers it under the matching node name

#### Scenario: Invalid token is rejected
- **WHEN** a node connects with a token not present in `hub.nodes[]`
- **THEN** the hub rejects the handshake with 401 and registers no connection

### Requirement: JSON-RPC request/response envelope
Hub-to-node calls SHALL be framed as a JSON envelope `{ id, method, path, query, body }`. The headless node SHALL dispatch each call by invoking the corresponding App Router route handler directly — a plain `Request -> Response` function imported and called without a Next server — extracting dynamic path params (e.g. `[id]`), then reply with `{ id, status, body, headers? }`. The `id` SHALL correlate responses to requests so that concurrent calls on one connection do not cross-talk.

#### Scenario: Request is dispatched and answered
- **WHEN** the hub sends `{ id: 1, method: "GET", path: "/api/runs", query: { project: "a" } }`
- **THEN** the node runs the corresponding handler and replies `{ id: 1, status: 200, body: <runs> }`

#### Scenario: Concurrent calls correlate by id
- **WHEN** the hub sends two requests with ids 1 and 2 before either responds
- **THEN** each response carries its own id and is matched to its originating request

### Requirement: Hub node registry
The hub SHALL maintain an in-memory registry mapping node name to its connection and declared capabilities. A node disconnect SHALL remove its entry; a new connection using an already-registered node name SHALL replace the prior entry.

#### Scenario: Connected node is registered
- **WHEN** a node completes its authenticated handshake declaring capabilities `{ tmux, projects }`
- **THEN** it appears in the registry under its node name with those capabilities

#### Scenario: Disconnect deregisters
- **WHEN** a registered node's connection closes
- **THEN** it is removed from the registry and its projects and tmux are no longer offered to browsers
