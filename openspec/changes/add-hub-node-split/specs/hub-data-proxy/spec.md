## ADDED Requirements

### Requirement: Data API requests are proxied to the owning node
In hub mode, a data `/api/*` request SHALL be forwarded over the transport to the node that owns the request's target project, and the node's response SHALL be relayed back to the browser verbatim (status and body). If the owning node is not connected, the hub SHALL return a node-unavailable error rather than hang.

#### Scenario: Request routed to the owning node
- **WHEN** the browser requests `GET /api/runs?project=X` and project X is owned by node N
- **THEN** the hub forwards the request to N over the WebSocket and returns N's response unchanged

#### Scenario: Offline node yields an error, not a hang
- **WHEN** the browser requests data for a project whose node is currently disconnected
- **THEN** the hub responds promptly with an error indicating the node is unavailable

### Requirement: Projects are aggregated across nodes and tagged by node
`GET /api/projects` in hub mode SHALL query every connected node that declares the `projects` capability, merge their project lists, and tag each project with its source node name. The sidebar SHALL group or label projects by node.

#### Scenario: Union of nodes' projects
- **WHEN** nodes `m2` and `nvl72` each share projects
- **THEN** `/api/projects` returns the union, each project carrying its node tag, and the sidebar shows them grouped by node

#### Scenario: Node without the projects capability is excluded
- **WHEN** a connected node declares `capabilities.projects = false`
- **THEN** none of its projects appear in `/api/projects`

### Requirement: Node events relay into the browser SSE stream
A node SHALL relay its runtime events (`run-change`, `experiment-change`, `anomaly`, `code-reviews-change`) over the transport. The hub SHALL re-emit them into the existing `/api/events` SSE stream, preserving viewer-scope filtering, so the browser invalidates its caches with no client-side change.

#### Scenario: A node-side edit reaches the browser
- **WHEN** a README is edited on node N, emitting a `run-change`
- **THEN** the event is relayed to the hub and delivered on the browser's `/api/events` stream, invalidating the affected query

#### Scenario: Viewer scope is preserved
- **WHEN** a viewer is scoped to project P and an event fires for a project outside P
- **THEN** the hub does not deliver that event to the viewer
