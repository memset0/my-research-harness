## Status

**Abandoned on 2026-08-26.** Do not implement the remaining tasks in this
change. The resident node-to-hub WebSocket architecture has been superseded by
the proposal-only `decouple-web-and-cluster-backend-deployments` direction,
which will define a different centralized Web deployment and remote-target
access model. This change is retained only as implementation history and must
not update the current main specs.

## Why

memon runs its frontend + backend as one co-located process per machine, so each GPU cluster's memon is an island. The user runs experiments across multiple clusters (e.g. `m2`, `nvl72`) and needs to watch and manage them from ONE place. The networking reality forces the shape: clusters sit behind firewalls/NAT (a central server can't reach in), but they CAN reach a public server. There is no way today to aggregate several clusters' projects and tmux sessions into a single dashboard.

## What Changes

Introduce a **hub / node** split of the memon backend — the first step of a multi-phase roadmap; **this change runs entirely on localhost**.

- A process runs as either a **hub** (serves the frontend + a thin broker) or a **node** (the existing full backend, headless), selected by config: `role: hub | node`, mutually exclusive per process.
- Each **node dials OUT** to the hub over a persistent WebSocket (works from behind a firewall) and authenticates with a **per-node Bearer token** (distinct from the human owner credentials).
- The **hub stores nothing**: it wraps every data `/api/*` request in a JSON-RPC envelope, forwards it over the owning node's WS, and relays the response back (thin hub, pure live proxy). It also relays node events into the existing browser SSE stream.
- The left sidebar **merges projects across all connected nodes**, tagged by node.
- `/manage/tmux` gains a **node single-select**: pick a node → see its tmux sessions; attach opens a terminal (on localhost, via the hub proxying to the node's local ttyd port).
- Each node declares a **capability flag** (`tmux` and/or `projects`) for what it shares.
- The node **always dials the hub even locally**, so the topology is migration-faithful: `m2` runs a hub process + a node process dialing `ws://localhost`.

Deferred to later changes: remote nodes over the public internet + public Caddy/Vultr deployment (P3); tunneling a remote node's ttyd terminal WebSocket through the hub (P4).

## Capabilities

### New Capabilities

- `hub-node-transport`: `role: hub|node` config selection; the node→hub outbound WebSocket (dial-out + reconnect-with-backoff); per-node Bearer-token auth at the WS handshake; the JSON-RPC request/response envelope; the hub's in-memory node registry.
- `hub-data-proxy`: the hub forwarding data `/api/*` requests over the transport to the owning node and relaying the response; `/api/projects` fan-out across all connected nodes + merge, namespaced/tagged by node (sidebar grouping); relaying node `rt.events` into the browser SSE stream (viewer-scope filter preserved).
- `tmux-node-picker`: the node single-select on `/manage/tmux`; node-scoped tmux-session listing (RPC `tmux ls`); node-scoped terminal start; localhost terminal attach via the hub proxying to the node's loopback ttyd port.

### Modified Capabilities

None. All behavior here is **new and layered on top**. A single-process memon (no `hub`/`node` config block) behaves exactly as before, so the existing `auth-system`, `live-updates`, `tmux-session-management`, `web-layout`, and `run-discovery` requirements are unchanged. Node-to-hub auth is a distinct new path owned by `hub-node-transport`, not a change to the human owner/viewer modes.

## Impact

- **New code**: `apps/web/lib/node/*` (WS client + RPC dispatch + event relay), `apps/web/lib/hub/*` (node registry + RPC broker + projects fan-out/merge), an extension to `apps/web/lib/server-core.ts` (a `/api/hub/nodes/connect` WS endpoint), and node-scoped tmux/terminal routing.
- **Config**: new optional, mutually-exclusive `hub` / `node` blocks in `packages/core/src/schemas.ts` + `types.ts` + `config/load.ts` + `config.example.yml`, validated in the loader.
- **UI**: `apps/web/components/app-sidebar.tsx` (node-grouped projects), `apps/web/app/manage/tmux/tmux-page.client.tsx` (node `<Select>`).
- **Unchanged**: every existing `app/api/**` handler (they become node-side RPC targets verbatim), `apps/web/lib/runtime.ts`, and the browser SSE machinery (`lib/events-client.ts`, `components/use-memon-events.tsx`).
- **Reuses**: `server-core.ts` http-proxy-3 + WS-upgrade, `lib/auth/basic-auth.ts` constant-time compare, `lib/terminal/tmux-discover.ts`.
- **New operational surface**: a long-lived WS + an RPC layer, and a localhost two-process run model. No remote networking or ttyd tunneling in this change (those are P3/P4).
