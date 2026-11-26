# Spec Delta

## Purpose

Show the owner every registered compute node and its GPUs in one page: what is allocatable, what is running now, and how long each node remains available, as the surface ticket-driven tasks will later fill.

## ADDED Requirements

### Requirement: Cluster overview is restricted to cluster administrators
`GET /api/clusters` and `/manage/clusters` SHALL be available only to identities holding the `access_clusters` capability (the owner/super admin and admins). Share viewers, lower account levels and anonymous requests SHALL be refused (`401` for unauthenticated API calls, a login redirect for the page, `403` otherwise), and navigation to the page SHALL be shown only to identities that can open it.

#### Scenario: Viewer is refused
- **GIVEN** a request carries only a valid project share cookie
- **WHEN** it requests `GET /api/clusters`
- **THEN** the response is refused and contains no node data

### Requirement: Overview groups nodes by cluster without connection details
The API SHALL return every registered node grouped by its `cluster` label (nodes without one under `unassigned`), with id, GPU type, declared GPU count, allocation mode, allocatable GPU indices, `available_until`, `expired`, transport kind and probe state. It SHALL NOT return SSH targets, options, via lines, enter prefixes, process command lines or paths.

#### Scenario: Connection details never leave the server
- **GIVEN** a registry with one `ssh` node and one `via` node
- **WHEN** the owner requests `GET /api/clusters`
- **THEN** both nodes appear under their clusters and the response body contains neither the SSH target nor the via line

#### Scenario: Invalid registry
- **GIVEN** the registry file fails validation
- **WHEN** the owner requests `GET /api/clusters`
- **THEN** the response is `500` with code `NODES_CONFIG_INVALID` and the validation message, and no probe runs

### Requirement: GPUs are probed read-only through each node's transport
For each unexpired node the server SHALL run one read-only `nvidia-smi` query (GPU index, UUID, name, memory used/total, utilization, and compute-process GPU UUIDs) through the node's registered transport, and report per GPU its index, name, memory used and total in MiB, utilization percent, whether it is allocatable, and the count of compute processes. Expired nodes SHALL be listed with state `expired` and never probed.

#### Scenario: Busy and idle GPUs
- **GIVEN** a node's probe reports GPU 0 with one compute process and GPU 1 with none
- **WHEN** the overview is built
- **THEN** GPU 0 reports `processes: 1` and GPU 1 reports `processes: 0`

#### Scenario: Expired node is not contacted
- **GIVEN** a node whose `available_until` is in the past
- **WHEN** the overview is built
- **THEN** that node has state `expired`, no GPU rows, and no transport process was started for it

### Requirement: Probes are bounded and cached
Each probe SHALL time out after 45 seconds, at most two probes SHALL run concurrently, and a node's result SHALL be reused for 45 seconds unless the request carries `refresh=1`. A failed or timed-out probe SHALL report state `unreachable` with the probe time and a bounded error message, without failing the other nodes.

#### Scenario: One node times out
- **GIVEN** one node's transport never answers
- **WHEN** the owner requests the overview
- **THEN** that node reports `unreachable` with a timeout error after at most the probe timeout, and every other node still reports its GPUs

#### Scenario: Cached result is reused
- **GIVEN** a node was probed 10 seconds ago
- **WHEN** the owner requests the overview without `refresh=1`
- **THEN** no new probe runs and the previous probe time is returned

### Requirement: Page shows nodes with a timeline column
The page SHALL show, per cluster, one card per node: a node row followed by its GPU rows. A timeline column SHALL share one time axis from now and draw, per GPU, the node's availability window, with a busy marker when compute processes run. The node row SHALL mark the window's end. Reachable nodes SHALL start expanded and unreachable or expired nodes collapsed.

#### Scenario: Running-now marker
- **GIVEN** a probed GPU reports at least one compute process
- **WHEN** the page renders that node
- **THEN** that GPU row is marked busy with its process count and its lane shows a busy marker

#### Scenario: Unavailable node starts collapsed
- **GIVEN** a node whose probe failed
- **WHEN** the page first renders
- **THEN** that node shows only its header badges until the owner expands it

#### Scenario: Problem nodes expand together
- **GIVEN** two unreachable or expired nodes are collapsed
- **WHEN** the owner presses "Expand issues"
- **THEN** both cards expand, healthy nodes keep their state, and each card can still be toggled on its own

### Requirement: Tasks section shows only real task data
The Tasks section SHALL show only data from the server's task source. With no task source configured, it SHALL say that ticket tasks are not available yet and SHALL NOT render placeholder rows.

#### Scenario: No task source yet
- **WHEN** the owner opens the Tasks tab of `/manage/clusters`
- **THEN** it says that no ticket tasks are available yet and lists no tasks

### Requirement: Freshness is polling-based
The page SHALL refresh the overview through TanStack Query every 60 seconds while visible and on a manual refresh action (which requests `refresh=1`), using the `queryKeys.clusters()` key. It SHALL NOT open an EventSource or filesystem watcher.

#### Scenario: Manual refresh
- **WHEN** the owner presses Refresh
- **THEN** the page requests `GET /api/clusters?refresh=1` and shows the new probe times
