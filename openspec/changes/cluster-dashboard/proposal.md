# Proposal

## Why

The owner holds GPU nodes on several clusters, registered in the machine-local node registry (`node-access`). Nothing shows them in one place: which clusters and nodes are in the pool, which GPUs each node has, which are allocatable, what is running on them now, and how long each node stays available. Every check today is a manual `memon ssh … nvidia-smi`. The dashboard also sets the page layout that the coming ticket system will fill with queued and running tasks.

## What Changes

- **`/manage/clusters` page for cluster administrators** (`access_clusters`: the owner/super admin and admins), reachable from the admin navigation.
  - It groups registered nodes by cluster.
  - Per node it shows: allocation mode, expiry (`available_until`, expired/expires-in), reachability, last probe time and last error.
  - Per GPU it shows: index, name, memory used/total, utilization, whether it is allocatable, and the number of compute processes. It never shows process command lines or paths.
- **Compact stock shadcn layout.** There is one table per cluster, with a collapsible row group per node; unavailable nodes start collapsed. A timeline column draws each GPU's availability window and busy marker on a shared time axis. A **Tasks** tab is reserved for ticket-driven tasks: this change renders it from a task source that returns an empty list, and states plainly that no task source exists yet. It never shows fabricated rows.
- **`GET /api/clusters`, gated by `access_clusters`.**
  - It probes every unexpired node once through the node's own transport with a read-only `nvidia-smi` query.
  - Probes are bounded: a per-node timeout and a small concurrency cap.
  - Results are cached in memory for 45 s. `?refresh=1` bypasses the cache.
  - Expired nodes are listed but never probed.
- Polling only, through TanStack Query (60 s while visible), plus a manual refresh button. No watchers, no SSE.

## Capabilities

### New Capabilities
- `cluster-dashboard`: the cluster-administrator (`access_clusters`) cluster/node/GPU overview, its probe contract and limits, timeline column, and the reserved task source that a ticket change will fill.

### Modified Capabilities

## Impact

- **Web** (`apps/web`):
  - a page under `app/manage/clusters`;
  - client components;
  - an API route;
  - a server probe module under `lib/server/`;
  - a DTO;
  - a query key;
  - a route-class rule;
  - a sidebar link.
- **Core:** consumes the shared node registry and invocation builder from `node-access` (`@memon/core`).
- **Release:** shipped together with the `node-access` allocation fields, which touch the CLI, so this is a MINOR release, and the central deployment is required.
- **Deployment data:** none tracked. The page reads the operator's untracked `~/.config/memon/nodes.yml` at request time.
