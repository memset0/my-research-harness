# Design

## Context

See proposal.md for motivation. The node registry, its validation and the transport invocation builder come from `node-access` and now live in `@memon/core`. Central runs as the operator account, so it reads the same `~/.config/memon/nodes.yml` (or `MEMON_NODES_CONFIG`) that `memon ssh` uses. Some transports are slow: a relay-backed via can take tens of seconds, delivers stdin only at EOF, and allows only a few concurrent sessions.

## Goals / Non-Goals

**Goals:** one owner page that answers "what do we hold, what is free, what is running, how long do we have it". Bounded, read-only probing. A layout that a ticket change can fill by adding a data source, without reworking the page.

**Non-Goals:**
- tickets, queues, allocation or killing anything;
- historical utilization charts;
- persistent storage;
- probing through anything other than the node's own transport;
- showing process command lines.

## Decisions

1. **Probe = one remote line per node.** The line is built with core's `commandInvocation(node, [line])` and runs:

   `nvidia-smi --query-gpu=index,uuid,name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits; echo __MEMON_APPS__; nvidia-smi --query-compute-apps=gpu_uuid --format=csv,noheader`

   Processes are counted per GPU UUID, and only counts leave the server. This reuses the CLI transport exactly (enter prefixes, via contract), so there is no new transport code. stdin is `ignore`, so EOF-buffering vias return promptly.

2. **Limits.**
   - Timeout of 45 s per probe: the child is SIGKILLed and the node reports `unreachable`.
   - Concurrency cap of 2, which keeps relay-backed vias well under their session limit.
   - Output is capped at 256 KiB.
   - Results are cached in memory per node for 45 s, keyed by node id.
   - Concurrent requests for the same node share one in-flight probe, so polling never stacks probes.
   - `refresh=1` bypasses only the 45 s reuse, never the in-flight dedupe.

3. **Access goes through one guard.** The route class is `read` + `global`, and the middleware capability table maps `/api/clusters` and `/manage/clusters` to `access_clusters`. Both the handler and the page call `canAccessClusters()`, the single guard (owner/super admin, or an account level holding `access_clusters`).

4. **Timeline column in the node table.**
   - The last, widest column shares one time axis in its header: now, then up to six day ticks, on a horizon from now to `max(available_until)`, clamped to 1–60 days.
   - Each GPU row has a 6 px lane built from theme tokens: a `bg-muted` track, the availability window (now → `available_until`) in `bg-primary/60` (`bg-muted-foreground/30` when reserved), and a `bg-destructive` "busy now" cap at the left edge.
   - Each segment carries a `Tooltip`. The node header row marks the window's end with "expires in …".
   - shadcn ships no timeline primitive, so the lane is the one composed element; it uses only theme tokens. A separate availability chart was tried and dropped at owner review.

5. **Ticket contract (filled by the ticket change, not here).**
   - The server exposes `listTasks(): Promise<ClusterTask[] | null>` in `lib/server/cluster/tasks.ts`. `null` means "no task source", which is the only implementation in this change. The API returns it as `tasks: { available: false, items: [] }`.
   - A task source returns `ClusterTask = { id, state: 'QUEUED' | 'RUNNING', node: string | null, gpus: number[], granted_at: string | null, requested_duration_s: number, label?: string }`. Both timestamps are offset-qualified ISO 8601.
   - The page draws each `RUNNING` task as a `bg-primary` segment in its GPUs' lanes, from `granted_at` lasting `requested_duration_s` (already implemented against the contract), and lists every task in the Tasks tab with state, node, GPUs and time left.
   - `QUEUED` tasks, which have no node, `granted_at` or bar, are listed in the Tasks section in queue order.
   - The ticket change only swaps the `listTasks` implementation and extends the Tasks list. The DTO and layout stay as they are.

6. **UI composition: compact, stock shadcn components.**
   - `Tabs` switches between Nodes and Tasks. A muted summary line sits beside them.
   - Each cluster has a small heading, followed by one compact `Card` per node.
   - Each node card is a `Collapsible` holding one dense `Table` (about 28 px rows, fixed narrow columns). The table header is the node row: the trigger, small `Badge`s (transport and probe age in a `Tooltip`) and the "expires in" marker. When the card is open, a column row with the shared time axis and the GPU rows follow.
   - Reachable nodes start expanded; unreachable and expired nodes start collapsed, with only the node row showing. A header button ("Expand issues · n" / "Collapse issues · n") opens or closes every problem node at once. Healthy nodes are unaffected, and each card stays individually toggleable. The state is not persisted.
   - Probe errors appear in a destructive `Alert` row when the node is expanded.
   - GPU rows show memory as `Progress` plus text, utilization as text, and Allocatable and Busy/Idle as `Badge`s, with the GPU name in a `Tooltip`.
   - The Tasks empty state uses `Empty`.
   - Components are composed with `cn()`/`className` only; nothing under `components/ui` is edited.
   - The component mounts its own `TooltipProvider` and is self-contained.
   - Access goes through the single server-side guard, `canAccessClusters()`.

## Risks / Trade-offs

- [A slow node delays the whole response] → Each probe is bounded at 45 s and the concurrency cap is 2, so the worst case is about 45 s × ⌈n/2⌉. The page shows a loading state, and cached nodes answer immediately. Background refresh is a later improvement.
- [`nvidia-smi` missing or a non-NVIDIA node] → The node reports `unreachable` with the stderr excerpt. GPU rows fall back to the declared count with unknown metrics.
- [Probes appear as short sessions on remote nodes] → They are read-only and rare (one per 45 s per node, only while someone has the page open).

## Migration Plan

- Additive: a new page, route and sidebar link.
- Rollback by deploying the previous release.
