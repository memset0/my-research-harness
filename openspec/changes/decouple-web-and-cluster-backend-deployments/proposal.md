## Why

memon currently couples the Web UI and cluster-local backend into the same deployment, so even a frontend-only change can require redeploying every experimental cluster. The project needs one centrally deployed Web entry point backed by independently deployed cluster services, allowing each side to evolve and roll out without unnecessary fleet-wide updates.

## What Changes

- Split memon into two independently deployable roles:
  - a single central Web service containing the frontend and a lightweight gateway for routing, aggregation, and cross-cluster presentation;
  - one backend service on each experimental cluster, responsible for that cluster's project directories, discovery, file access, events, and supported cluster-local operations.
- Keep cluster-backend configuration close to today's deployment model: each backend declares the local project directories and cluster-local features it exposes.
- Give the central service a local configuration that declares which cluster backends it connects to, their identities, endpoints, credentials or connection references, and any routing metadata required to distinguish them.
- Keep the central configuration out of Git. Its comments may serve as a local, Agent-maintained operations notebook describing how each cluster is reached, deployed, restarted, or otherwise administered; machine-readable connection settings and human/Agent operational guidance live together in that local file.
- Let the central gateway query all configured backends, merge their project and status views, preserve the source-cluster identity, and route target-scoped reads and mutations back to the correct backend.
- Establish a versioned central-to-backend contract so a central frontend/gateway release can remain compatible with already-deployed cluster backends. A frontend-only change must require redeploying only the central service; backend rollouts must support staged cluster-by-cluster deployment where compatibility permits.
- Treat the network path as an operational prerequisite. The operator may provide direct routing, SSH-based access, a private overlay, or another mechanism; this proposal defines the memon service boundary and configuration, not how the underlying network is built.
- Isolate failures by cluster: an unreachable or incompatible backend is shown as unavailable without taking down the central UI or other reachable clusters.
- Remain provider-neutral. The central service may run on Vultr or any other reachable public/private host.
- **BREAKING**: separate the current co-located Web/backend runtime, release artifacts, configuration, and deployment lifecycle into central and cluster roles.
- **BREAKING**: cluster-local assumptions in URLs, APIs, caches, events, and operational features become explicitly cluster-scoped.
- Reconcile this proposal with the open `add-hub-node-split` change before implementation. That change provides related hub/node groundwork, but its exact transport and deployment contract are not automatically adopted here.

## Capabilities

### New Capabilities

- `split-service-deployment`: Independently buildable and deployable central-Web and cluster-backend roles, their configuration ownership, lifecycle, rollout, rollback, and compatibility expectations.
- `cluster-backend-api`: The authenticated, versioned contract through which the central gateway discovers backend capabilities and performs cluster-scoped reads, writes, events, and supported operational actions.
- `central-cluster-registry`: The Git-ignored local central configuration that names cluster backends, supplies connection/routing data, and permits Agent-maintained operational notes in comments without turning the repository into the source of machine-specific secrets or topology.

### Modified Capabilities

- `web-dashboard`: The central dashboard aggregates projects from all configured backends, identifies their source clusters, and keeps navigation and mutations scoped to the selected backend.
- `memon-cli`: Serving the central Web role and serving a cluster-backend role become explicit deployment paths, while ordinary CLI commands continue to work locally on experimental clusters.
- `live-updates`: Backend events cross the service boundary and are merged by the central gateway without requiring the frontend deployment to own cluster-local polling.
- `tmux-session-management`: Session discovery and management are cluster-scoped and routed to the selected cluster backend.
- `browser-terminal`: Terminal start, attach, proxy, and lifecycle behavior work through the central gateway while the terminal process remains owned by the selected cluster backend.
- `auth-system`: Human access remains enforced at the central service, while central-to-backend service authentication and remote-operation authorization form a separate trust boundary.

## Impact

- **Repository/package boundaries**: frontend, central gateway, shared protocol/types, and cluster backend need release boundaries that permit independent builds and deployment.
- **Configuration**: the central host gains a Git-ignored local cluster registry and operations notes; every cluster retains a local backend configuration for project roots and local capabilities. The exact filename and schema are deferred to design.
- **Backend/runtime**: project discovery, indexing, filesystem access, polling, tmux/ttyd, and event production remain cluster-local and must be exposed through a stable backend contract.
- **Frontend/gateway**: aggregation, cluster-qualified identity, API routing, event fan-in, compatibility reporting, and per-cluster unavailable states move to the central deployment.
- **Security**: the central service holds backend connection credentials or references; both human-to-central and central-to-backend boundaries require explicit authentication, authorization, secret handling, and path safety.
- **Operations**: frontend-only releases affect one central deployment; backend releases can be rolled out per cluster. Agents may update the local central configuration and its comments when connection or operating procedures change.
- **Related open change**: `add-hub-node-split` overlaps substantially. No implementation should begin until reuse, supersession, and migration decisions are documented in the later design phase.
