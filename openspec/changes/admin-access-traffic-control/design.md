## Context

Forwarded application traffic enters the custom Node server (`server.ts`, loaded by tsx outside Next's bundler) and is handled by the content service gateway before Next sees it:

1. `/api/content-services/<host>/<project>/<kind>/<id>/<path>` — `resolve()` authorizes the request, reads the document's service manifest through the project file layer (File Agent / SSHFS / local, memory-cached at most 30 s), then picks a target by the Project's transport:
   - **File Agent** (`access.kind: agent`): HTTPS with mTLS to the agent endpoint, `/v1/services/<project>/<port><path>`; the agent forwards to the source host's loopback port. The global HTTPS agent pools keep-alive connections per credential set.
   - **SSH tunnel** (`sshfs` with an SSH execution target): a lazily started `ssh -N -L` per Project and port (Compression=yes), idle-closed after 5 minutes.
   - **Native**: plain HTTP to central's own `127.0.0.1:<port>`.
2. `/api/content-assets/...` — rewritten in place to `/api/<kind>-assets/...` and served by Next routes that read files through the same project file layer.
3. WebSocket upgrades of the service path use the same targets.

Live remote Projects use File Agent connections whose endpoints are local forwards/bridges to the source hosts, so the central→host leg is itself a relay; the browser→central leg passes a public reverse proxy and a reverse SSH tunnel.

## Goals / Non-Goals

Goals: split a slow forwarded request into central overhead (resolve), upstream time to first byte, and transfer; measure each network leg on demand without installing anything remotely; keep memory bounded; restructure the admin navbar.

Non-goals: persistence across restarts, alerting, changing forwarding behavior or caching, measuring inside the remote host.

## Decisions

- **In-memory only.** A `globalThis`-keyed tracker (`Symbol.for('memon.traffic-tracker.v1')`) is shared between the tsx-loaded gateway and the Next-bundled API routes. Ring buffer of the last 1000 records; per `{host, project, transport}` key, 60 one-minute buckets with counts, byte totals, sums and fixed log-scale histograms (p95 is the upper bound of the bucket); at most 128 keys, least recently updated evicted. Probe results keep the last 20. No SQLite: a restart starting empty is acceptable for a diagnostic, so the AGENTS.md storage allow-list is unchanged.
- **Paths.** The query string is dropped (only `?…` marks that one existed), the path is truncated to 160 characters. Share tokens and application secrets in queries never reach the tracker.
- **Timings.** `resolveMs` = arrival → target chosen (auth, manifest read, tunnel readiness). `ttfbMs` = arrival → upstream response headers; `upstreamTtfbMs` = upstream request dispatched → headers. `totalMs` = arrival → response finished or closed. Throughput = bytes / (total − ttfb), reported only for bodies ≥ 32 KiB, because smaller bodies are latency-bound. Upstream backpressure from a slow browser inflates transfer time but never TTFB, which is why the browser leg has its own check. `reused` records whether the upstream request rode an existing keep-alive connection (no new TLS/TCP handshake).
- **Assets** are timed in the gateway around Next's handler (headers written → TTFB, finish → total; bytes counted from writes).
- **Probe placement.** The gateway registers a probe hook on `globalThis` exposing its own `target()` (so a service re-fetch uses the live tunnel pool and the same File Agent credentials). Transport probes:
  - File Agent: one keep-alive HTTPS agent with the connection's mTLS material; 6 sequential `GET /v1/capabilities?project=…` calls. The first includes TCP+TLS setup; the rest are steady round trips through the relay to the agent.
  - SSH: `ssh … <target> cat` session (same BatchMode, pinned known-hosts, identity, port options as the tunnel, no compression); session setup time to the first echo, then 10 one-byte echo round trips; then `ssh … <target> head -c 4194304 /dev/urandom` for throughput. Uses only `cat` and `head`, present on every POSIX host.
  - Native: loopback; reported as having no network leg.
  - Service fetch (any transport, optional): GET a document path through the live target, body capped at 16 MiB, recording TTFB, bytes and throughput.
  A Project with neither an agent connection nor an SSH execution target reports "not probeable" with the reason.
- **Browser leg.** `GET /api/traffic/payload?bytes=N` (owner only, N ≤ 16 MiB, `no-store`, `identity` encoding, random incompressible bytes generated per request). The browser times 5 zero-byte requests for latency and one 4 MiB download for throughput with `performance.now()` and a streaming reader.
- **Gating.** `/manage/traffic` and `/api/traffic*` require `configure_instance` (super admin only), like the existing file-access settings. `/manage/access` requires `manage_accounts` or `manage_project_grants`; each card re-checks its own capability server-side and the Users card is rendered only with `manage_accounts`.
- **Redirects** are server-side page redirects after the old capability check, so an identity that could not open an old URL still receives the same refusal.

## Risks / Trade-offs

- Probes add load to a slow link; they are owner-triggered only, bounded (4 MiB SSH, 16 MiB fetch) and serialized per Project.
- Aggregates are approximate percentiles; good enough to see seconds vs milliseconds.
- WebSocket sessions are recorded once, at close, with setup latency and bytes in both directions.
