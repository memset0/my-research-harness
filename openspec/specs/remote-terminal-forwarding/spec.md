# remote-terminal-forwarding Specification

## Purpose
Defines secure Host-qualified ttyd HTTP/WebSocket forwarding through central and the selected Backend's static authenticated relay.

## Requirements

### Requirement: Remote terminal traffic uses a two-hop relay
The public path SHALL be browser to central Host-qualified relay, central to the selected static Backend relay, and Backend to its local dynamic-loopback ttyd port. Central SHALL own public human authentication and Host routing; Backend SHALL own local session-to-port resolution and the final loopback hop. A dynamic ttyd port SHALL never be returned to the browser or exposed publicly.

#### Scenario: Terminal works through SSH-normalized Backend
- **WHEN** an owner opens a terminal on a Host reached through gateway-managed SSH
- **THEN** ttyd HTTP assets and WebSocket traffic traverse the single static Backend tunnel and reach only that Host's local ttyd

#### Scenario: URL transport uses the same contract
- **WHEN** a Host uses `url` transport
- **THEN** central still targets the Backend relay rather than attempting to dial a remote loopback ttyd port directly

### Requirement: Public terminal identity includes Host and session
Every terminal start, attach, public proxy URL, popup/drawer target, and lifecycle operation SHALL include the stable Host ID and opaque session/route ID. Equal tmux or session names on different Hosts SHALL remain distinct.

#### Scenario: Equal session names do not cross Hosts
- **WHEN** Host A and Host B each have a session named `work`
- **THEN** attaching `{host-a, work}` cannot resolve or affect `{host-b, work}`

### Requirement: Both relay hops enforce their own authentication boundary
Central SHALL require an owner session/credential and reject viewers for terminal routes. It SHALL strip browser credentials before injecting the selected Backend service token. Backend SHALL revalidate the service token and owner actor context before resolving a terminal route. Origin, Host, path, WebSocket upgrade, and subprotocol validation SHALL fail closed.

#### Scenario: Viewer cannot upgrade terminal WebSocket
- **WHEN** a viewer attempts a terminal WebSocket upgrade
- **THEN** central rejects it before contacting Backend

#### Scenario: Stolen browser cookie is not a Backend credential
- **WHEN** a central session cookie is sent directly to Backend relay
- **THEN** Backend returns 401 and does not resolve a ttyd route

### Requirement: Terminal relay preserves streaming and lifecycle
HTTP and WebSocket relays SHALL preserve backpressure, bounded buffering, binary bytes, subprotocol where allowed, cancellation, and close propagation. Start/attach SHALL register or reuse only the exact Host route; stop, kill, LRU, idle-TTL, and stale cleanup SHALL remove it immediately.

#### Scenario: Cleanup invalidates route
- **WHEN** Backend terminal cleanup removes a ttyd process
- **THEN** subsequent central HTTP and WebSocket requests for that route return a bounded unavailable response and never fall through elsewhere

#### Scenario: Tunnel loss does not retarget session
- **WHEN** a Host tunnel drops during a terminal connection
- **THEN** that connection closes and any reconnect remains bound to the same Host or fails visibly
