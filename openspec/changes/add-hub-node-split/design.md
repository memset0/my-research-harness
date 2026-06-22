## Context

Today memon runs its frontend + backend as one co-located process; the whole backend is the `apps/web/lib/runtime.ts` singleton (config + discovery + poller + index + caches + `rt.events`). The user needs to manage several firewalled GPU clusters from one public place. Two existing facts make a hub/node split cheap: (1) the backend already has a clean singleton boundary, and (2) `apps/web/lib/server-core.ts` already runs an `http-proxy-3` HTTP+WebSocket-upgrade proxy (for ttyd), and Caddy already passes WebSockets through. See `proposal.md` for motivation and `specs/` for the normative requirements. This change is **localhost-only**; remote and ttyd-tunnel are later phases.

## Goals / Non-Goals

**Goals:**
- A `role: hub | node` split selected by config, mutually exclusive, additive (no block ⇒ today's behavior).
- Node dials OUT to the hub over one persistent WebSocket and answers a JSON-RPC envelope dispatched onto the **existing, unchanged** request handlers.
- Thin hub: stores nothing, forwards data routes live, relays events, fans out + merges projects (tagged by node).
- tmux node single-select + node-scoped listing + working localhost terminal attach.
- Migration-faithful topology (the node always dials the hub, even on localhost) so P3 is config-only.
- Reuse `server-core.ts` proxy plumbing, `basic-auth.ts` constant-time compare, the existing `/api/events` SSE, and `tmux-discover.ts`.

**Non-Goals:**
- Remote nodes over the public internet, public Caddy/Vultr deploy, token rotation UX (P3).
- Tunnelling a remote node's ttyd binary WebSocket through the hub (P4).
- Any hub-side caching / aggregation storage, or offline last-known-state.
- Changing single-process behavior, or the human owner/viewer auth modes.

## Decisions

- **Thin hub, pure live proxy** (not aggregate/cache). Simplest hub, always fresh, no sync or storage layer. Trade: an offline node is invisible and reads carry a network hop. Aggregation was rejected for v1 as premature complexity.
- **Node dials out; hub never dials in** — even on localhost. Forced by the firewall reality and keeps the topology identical from localhost to remote (P3 is just a different `hub_url`). Hub→node was rejected (can't reach behind NAT).
- **One WebSocket carrying a JSON-RPC envelope `{id,method,path,query,body}` → `{id,status,body}`, dispatched onto the existing handlers.** Zero handler changes (behavior can't drift from single-process); `id` multiplexes concurrent calls on one socket. Alternatives rejected: per-route hub stubs (duplication), exposing node HTTP for the hub to call (defeats the firewall purpose).
- **Per-node Bearer token, separate from owner creds.** Daemon-to-daemon, rotatable, node-scoped; verified with the existing constant-time compare. Reusing the human owner password was rejected (couples daemon auth to human login; no per-node scoping).
- **Reuse `server-core.ts` (http-proxy-3 + WS-upgrade)** for the new `/api/hub/nodes/connect` endpoint and for the localhost ttyd proxy. Proven plumbing; Caddy already upgrades WS, so deployment is unchanged.
- **Relay node events into the existing `/api/events` SSE** rather than a new browser channel. The browser SSE client (`events-client.ts`, `use-memon-events.tsx`) and the viewer-scope filter are reused untouched.
- **Two processes on localhost (hub + node), not a combined in-process mode.** Honest topology, no special-case code path; the local node is just a node that dials `ws://localhost`. A combined dev-convenience wrapper can come later. Trade: two processes to launch locally.
- **Node runs headless and dispatches RPC directly onto the route handlers** (resolved during apply). The node process runs `runtime.ts` + the WS client + an RPC dispatcher — it does NOT boot Next or serve the browser (the hub does). The dispatcher maps each `{method, path}` to the corresponding App Router route handler — a plain `Request -> Response` function, importable and callable WITHOUT a Next server — using `lib/server/data.ts` for reads and the route modules for writes, and extracting dynamic params (e.g. `[id]`) from the path. Chosen over "node runs full Next + RPC re-issued as localhost HTTP" to keep a single Next (the hub only) and the slimmest node; cost is a small route-dispatch table + synthetic `Request` construction. `runtime.ts` stays intact.
- **Project→node ownership is node-reported**: each node advertises its projects on connect; the hub registry maps project→node and tags projects by node for the sidebar. For v1's single node this is trivial but is written for N nodes.

## Risks / Trade-offs

- Offline node ⇒ its data/tmux vanish, no last-known view → Accept for v1 (thin-proxy by design); revisit optional caching post-P3.
- Extra WS hop adds latency → Negligible on localhost; keep the envelope lean; remote latency is a P3 concern.
- Large response bodies / backpressure over one multiplexed WS → v1 payloads are small JSON; cap body size and add streaming for big payloads (e.g. logs) later if needed.
- New two-process operational surface → Ship clear hub + node `config.example.yml` snippets and a run-model note; add a dev wrapper later.
- Localhost ttyd attach needs the node's loopback port → Node returns the proxy target via RPC; cross-machine attach is explicitly deferred to P4.
- Project-name collisions across nodes → Namespaced by node tag in the registry + UI; no collision with a single node.

## Migration Plan

Purely additive and opt-in. A config with no `hub`/`node` block keeps today's single-process behavior. Localhost rollout: write a hub config + a node config, start the hub then the node, verify projects + tmux through the hub. Rollback = delete the blocks (back to standalone). No data migration; nothing is persisted by the hub.

## Open Questions

- RPC framing: raw `ws` + JSON vs a tiny request-id helper — keep minimal; decide in apply.
- Whether `/api/projects` ownership should ever be hub-config-driven instead of node-reported — default to node-reported.

_Resolved during apply:_ node-process shape — the node runs **headless** and dispatches RPC **directly** onto the App Router route handlers (no Next on the node, no self-HTTP loop). See Decisions.
