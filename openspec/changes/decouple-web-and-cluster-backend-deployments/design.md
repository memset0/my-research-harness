## Context

See `proposal.md` for motivation. The current process combines Next.js, browser authentication, project discovery, filesystem access, polling, events, tmux, and ttyd. A previously implemented but abandoned Hub/Node direction added config blocks, node-initiated WebSocket RPC, dynamic imports of Next route handlers, and partial project labels. That code is still present, but its normal CLI serve path does not start the custom server, it buffers whole responses, it cannot carry SSE or remote ttyd safely, it does not bind an authenticated connection to the name announced by the node, and it does not make Project identity Host-qualified. It is implementation to remove, not a migration base.

The existing standalone role must remain available while the first split deployment is proven. Cluster login Hosts may be rootless, have NFS-backed homes, use transient machine hostnames, lack systemd, and share the same home with compute jobs. The central Host can use an external supervisor and a loopback reverse proxy. The current filesystem convention is v6, so the first release under the new release policy is `6.0.0`.

All real deployment topology and credentials are deliberately outside this document. Names such as `host-a`, paths such as `/srv/example`, and ports shown below are synthetic schema examples only. The actual Host ID, public domain, IPs, ports, SSH target, keys, project roots, credentials, commands, and operational commentary live only in selected Git-ignored instance configurations and machine-local reverse-proxy/service configuration.

## Goals / Non-Goals

**Goals:**

- Produce independently runnable central, backend, and backward-compatible standalone roles from one versioned source release.
- Give the browser one central human-auth boundary while each backend has an independent service-auth boundary.
- Make every central Project and cluster-local action unambiguously Host-qualified.
- Use a streaming HTTP contract for ordinary requests, SSE, report/log bytes, and a two-hop ttyd HTTP/WebSocket relay.
- Support a gateway-managed SSH tunnel to a loopback backend without requiring another mesh ACL port.
- Provide safe rootless backend install, supervision, pinned update, health verification, and rollback commands.
- Bootstrap the first deployment alongside the existing standalone service and retain a tested ingress rollback until the new path is stable.

**Non-Goals:**

- Building or managing the underlying private network, DNS provider, SSH account provisioning, firewall, or reverse proxy as a portable memon subsystem.
- Committing a real fleet inventory, token, key, address, port, path, domain, or runbook note.
- Persisting last-known Project payloads for an offline Host.
- Automatic fleet-wide upgrades or automatic backend recovery across a Host reboot.
- Exposing Git update, installation, daemon control, or arbitrary shell execution through the runtime Backend API.
- Preserving the abandoned node-initiated WebSocket RPC protocol or its `hub:`/`node:` configuration.

## Decisions

### 1. Three roles and explicit package boundaries

The runtime has three roles:

- **central** runs the Next.js frontend, human authentication, authorization, Host registry, gateway, Host-status aggregation, Backend event clients, and public terminal relay. It does not discover cluster Project roots or execute cluster tools.
- **backend** runs a framework-neutral HTTP server plus the cluster Runtime, Project service layer, event stream, tmux/Slurm/Herdr operations, and the local terminal manager/relay. It does not build or serve the browser UI and does not initialize human authentication.
- **standalone** keeps the existing single-process behavior and project-only routes during bootstrap and local use. It composes the same backend service layer in-process with the central Web adapters rather than keeping a second implementation.

The shared DTOs, validation schemas, release metadata, and service interfaces live in a shared package. Backend runtime and HTTP entry code live in an independently buildable backend package/application. Central code depends on the protocol package, not on backend filesystem/runtime modules. Next route handlers and SSR loaders call a central gateway service. Backend handlers and standalone adapters call framework-neutral service functions.

The old Hub/Node config, inbound node WebSocket, registry, JSON RPC, route-module filesystem resolver, and direct dynamic import dispatcher are removed. Configuration containing legacy `hub:` or `node:` blocks fails with a migration error. We reject keeping both architectures because it would preserve two incompatible routing and security models.

### 2. One selected, Git-ignored instance configuration per process

Each process uses the existing selected-instance concept: an explicit config path or the Git-ignored `config.yml`. Tracked `config.example.yml` documents the generic schema with synthetic placeholders, but runtime refuses to use or mutate the example.

The role is inferred from mutually exclusive top-level `central:` and `backend:` blocks; neither means standalone. Central config contains human `auth` and `central.hosts[]`. Backend config contains `projects[]`, cluster-local feature settings, and `backend`. A central config does not directly contain Project roots; a backend config does not contain human `auth`. A production central instance has no implicit mock Project. Development may explicitly start and register a separate local backend using mock Project roots.

The generic central Host entry contains:

- stable `id` matching `[a-z0-9][a-z0-9-]*` and optional display label;
- exactly one active service token plus an optional rotation token during a bounded rotation;
- one `url` or `ssh` transport;
- optional machine-readable operations hints such as SSH target, managed checkout, instance config, runtime bootstrap, and supervisor mode;
- arbitrary adjacent YAML comments used as the Agent-maintained runbook.

The generic backend block contains:

- stable `host_id` that must equal the central entry;
- bind address and port, defaulting to loopback;
- one or two accepted service tokens during rotation;
- daemon state/release/runtime directories;
- optional start guards expressed as allowed hostname patterns and forbidden environment-variable presence;
- foreground, native supervised-background, or external-supervisor mode.

Central and backend instance files containing service tokens must be regular files owned by the running user with no group/world permissions on POSIX; parent secret/state directories must be owner-only. Startup fails before opening a listener when schema, permissions, duplicate Host IDs, duplicate active tokens, port collisions, or incompatible role fields are found. Status and validation redact secrets. Runtime never round-trips YAML and never rewrites registry or operations comments. Central first-run human-auth initialization may only splice the missing auth values while preserving all other bytes/comments and must leave the file mode owner-only.

### 3. Human credentials and per-Backend service tokens are separate principals

Browser-to-central authentication remains one owner username/password plus the central session-signing secret and Host-qualified viewer shares. It is accepted only by the central/standalone public surface.

Central-to-backend calls use `Authorization: Bearer <service-token>`. Every Backend has independent random credentials; a token accepted by Backend A cannot authenticate to Backend B. Tokens are compared in constant time. The Backend rejects Basic credentials, human session cookies, viewer cookies, and missing/invalid Bearer tokens. It returns its configured Host ID from authenticated metadata, and the central blocks all data traffic when that identity differs from the configured Host entry.

For zero-interruption rotation, a backend may temporarily accept `current` and `next`, while the central presents exactly one. Rotation is backend-add-next, central-switch-and-verify, backend-remove-old. The CLI never prints token values in status, logs, process arguments, diagnostics, or structured results.

At the public gateway, routing and authorization happen before choosing an upstream. Backend requests are built from a clean header set. Browser `Authorization`, `Cookie`, `Proxy-Authorization`, `Host`, `Forwarded`, `X-Forwarded-*`, client-provided `X-Memon-*`, hop-by-hop headers, and headers named by `Connection` are never forwarded. The gateway then injects its service token and a validated actor context (`owner` or `viewer` plus the exact Host-qualified scope) for Backend defense-in-depth route-class enforcement. Backend `Set-Cookie`, `WWW-Authenticate`, hop-by-hop headers, and unapproved redirects are not relayed to browsers.

### 4. The static Backend HTTP API is the only runtime data plane

Each Backend exposes a versioned `/api/backend/v1` namespace on one static listener. It includes authenticated metadata/readiness, capability and Project discovery, Project reads/mutations, event SSE, cluster feature operations, and terminal relay. Installation, Git synchronization, daemon control, and arbitrary operations commands are absent.

Metadata includes the configured Host ID, release version, Backend API major, instance epoch, running revision, capabilities, and readiness. DTOs are runtime-validated on both sides. The central never trusts a Backend-provided URL or authority.

The gateway maps validated central API calls to fixed Backend paths using an allow-listed route table; browser input can select only a configured Host ID and resource identifiers. It cannot supply an upstream authority or arbitrary Backend path. Configured URLs reject userinfo, query, fragment, and unexpected base paths. Redirect following is disabled so a token cannot be sent to a redirected authority. Plain HTTP is accepted only when the local config explicitly permits it for a trusted loopback/private transport.

Project-relative resource identifiers replace cross-boundary absolute paths. A Backend does not return cluster absolute roots to the browser and does not accept an arbitrary absolute path from central APIs. Each filesystem access resolves an identifier beneath the configured Project root, performs lexical and realpath containment (including existing parents for creation), and rejects traversal, encoded separators, symlink escape, device paths, and cross-Project targets.

HTTP bodies and responses are streamed with backpressure. JSON/control bodies have explicit limits; report assets and logs are byte streams rather than base64 JSON. Browser disconnect propagates cancellation to the Backend. Read timeouts are bounded. The gateway does not automatically replay a mutation after an ambiguous timeout; existing optimistic locks remain the protection against concurrent writers.

We reject the old JSON-RPC/direct-Next-handler dispatcher because it depends on a source tree and Next request context, buffers the full response, cannot support long-lived streams/cancellation correctly, and silently makes every new Next route part of a remote privileged API.

### 5. URL and SSH transports normalize to one Backend upstream

`url` mode uses an explicitly configured private HTTP(S) base URL. It covers a local Backend, a private overlay route, or forwarding maintained by another system.

`ssh` mode is the default for a remote loopback-only Backend. Its local config supplies an SSH executable/target, pinned known-hosts file, identity reference, fixed center-loopback forwarding port, and remote loopback host/port. The gateway invokes SSH with an argv array and no shell, using batch mode, identities-only, strict host-key checking, exit-on-forward-failure, keepalive, no remote command, and a loopback-only local bind. A runtime tunnel identity is distinct from an Agent's interactive operations identity and can be restricted to the configured forwarding destination.

The gateway owns one tunnel process per Host, validates the local port before use, probes authenticated readiness only after forwarding succeeds, terminates the whole tunnel process group on shutdown, and reconnects with bounded exponential backoff plus jitter. A port collision or invalid pin is `misconfigured`; an SSH/process/connect failure is `offline`; Backend 401/403 is `authentication_failed`; metadata Host mismatch is `identity_mismatch`.

Both transports yield the same `BackendUpstream` abstraction, so ordinary requests, SSE, and terminal HTTP/WebSocket use identical routing and authentication. The operations path remains an Agent opening a separate SSH session and invoking the local CLI according to the Git-ignored runbook.

### 6. Host-qualified identity is mandatory in central mode

The stable reference is `{ host, project }`; resource references add their resource ID. Central browser routes use `/h/<host>/p/<project>/...`. Central share routes use `/share/<host>/<project>/<token>`. Central Project-scoped APIs require validated `host` and `project` selectors, including APIs whose resource ID was historically searched globally. Missing or unknown Host selectors fail explicitly; no GET or mutation broadcasts across Backends.

`GET /api/hosts` returns every configured Host and its current state. `GET /api/projects` returns the live union from usable Hosts, with every Project carrying its Host ID, and separately preserves Host status so offline Hosts remain visible even though their stale Project payloads are absent.

Types use `HostId`, `ProjectRef`, and Host-qualified resource/terminal targets instead of optional `node` labels. URLs, SSR parameters, client fetches, TanStack keys, localStorage keys, BroadcastChannel messages, SSE payloads, viewer scopes, report links, terminal popup links, and mutations include the Host. Equal Project and resource names on different Hosts remain unrelated.

During bootstrap, legacy project-only browser URLs may redirect only when the central live registry resolves exactly one matching Host. Ambiguous or unavailable resolution produces a chooser/error and never picks a first match. Legacy share landing may be validated against an explicitly configured migration Host or rejected as ambiguous; newly issued shares are always Host-qualified. Standalone mode retains its existing project-only URLs.

A Host ID is durable configuration identity, not the current OS hostname. Renaming it changes public identity and is treated as an explicit migration. Moving a Project to another Host likewise creates a new `ProjectRef`; no transparent alias is inferred.

### 7. Authorization and shares move to the central boundary

The central service classifies public routes and resolves owner/viewer identity before proxying. Viewer cookie entries and scopes store `(host, project)` tuples. Share creation/revocation data remains with the owning Backend's Project; central share landing asks that exact Backend to validate the token, then signs a central cookie containing the tuple. Revocation is checked against the Backend on later requests just as standalone currently checks Project-local share state. An offline Backend cannot mint or revalidate access.

Mutating and shell routes remain owner-only at central. The Backend receives the central-authenticated actor context and independently rejects a viewer context on mutating/shell route classes. It never uses browser cookies or the central human password.

### 8. Availability and compatibility are distinct, observable state machines

Each configured Host is always present with one of these primary states:

- `connecting` or `offline` for transport lifecycle;
- `authentication_failed` for service-token rejection;
- `identity_mismatch` for metadata Host mismatch;
- `misconfigured` for invalid local config, port, or tunnel prerequisites;
- `filesystem_migration_required` for a release Major mismatch;
- `upgrade_required` for a Backend more than one Minor behind;
- `central_update_required` for a Backend newer than central;
- `update_available` for the immediately preceding Backend Minor;
- `online` for the current Backend Minor.

Only `online` and `update_available` serve data. Host state includes safe diagnostic text, last successful check time, central/backend release versions, and capabilities but never secrets or raw SSH output. One Host failure does not fail aggregation, another Host, or the central login/UI.

No last-known Project payload is served while a Host is unusable. Direct navigation can still show the Host-specific failure. Fan-out has a per-Host deadline and returns usable Hosts without waiting indefinitely for a failed one.

### 9. Backend events fan into one central SSE stream with gap recovery

Each usable Host has one authenticated Backend event SSE connection with heartbeat, bounded parsing, instance epoch, and monotonic sequence within that epoch. The central adds the configured Host ID to every event and publishes it through the existing single browser SSE connection. Browser invalidation keys include Host and Project.

Transport loss does not close the aggregate browser SSE stream. On reconnect, an epoch change, or a detectable sequence gap, central emits a Host-resync event and invalidates all live queries for that Host before accepting further incremental events. This favors fresh refetch over an event journal or offline cache.

### 10. Remote terminals use a two-hop relay over the static Backend listener

The Backend terminal manager remains the owner of the local tmux/Herdr target, ttyd process, dynamic loopback port, LRU/TTL, and session-to-port registry. It exposes a service-token-protected HTTP/WebSocket relay under the static Backend API. That final local hop resolves an opaque terminal route to the current loopback ttyd port; it never returns the port to central or the browser.

The central public relay authenticates the owner, resolves `{host, session}`, selects exactly one Backend upstream, strips browser credentials, injects the Backend token, and proxies both ttyd HTTP assets and WebSocket upgrades to the Backend relay. The Backend revalidates its token and route, rewrites the known base path, and proxies to ttyd. HTTP and WebSocket preserve streaming/backpressure and close propagation. Origin, Host, path, subprotocol, and upgrade validation fail closed.

Session/route keys and popup/drawer/BroadcastChannel state are Host-qualified. Start/attach registers a route, reconnect reuses that route only on the same Host, and stop/kill/LRU/stale cleanup removes it. Unknown, expired, Host-mismatched, offline, or incompatible routes return a bounded gateway error and never fall through to another Host. `url` and `ssh` transports behave identically because terminal traffic uses the same static Backend upstream.

### 11. Release version follows the filesystem/backend/frontend axes

One tracked release version uses `MAJOR.MINOR.PATCH` with project-specific rules:

- `MAJOR` equals `FS_CONVENTION_VERSION` exactly. `6.0.0` is the first release because the current convention is v6. A change to v7 must include the reviewed v6-to-v7 migration and begins `7.0.0`.
- `MINOR` changes whenever Backend or CLI source/artifacts change. Such a release updates the central first and then reinstalls affected cluster distributions. The first Backend/CLI-changing release after the baseline is `6.1.0`.
- `PATCH` changes only central Web/gateway code and artifacts. Backend/CLI bytes must not change in a Patch release.

An OpenSpec change is not a release container. This change may remain active across `6.0.0` and later Patch or Minor releases while implementation, deployment, observation, and refinements continue. Before every deployment boundary, reviewed implementation changes receive their own commit(s), followed by a separate release commit that advances only the canonical version and required release metadata/assertions. The release commit uses a stable semantic message without a version literal. That commit is pushed and its exact 40-character revision is recorded; central and all affected nodes then use that same revision and never independently resolve a moving branch or `latest`. Archival occurs only after the complete change outcome is reviewed, not merely because its first release shipped.

The API path has its own Backend API major (`v1`) for wire validation, but fleet compatibility is decided from release Major/Minor. Central `M.N.P` accepts Backend `M.N.*` as `online` and `M.(N-1).*` as `update_available`; Patch is ignored. Older Minor is `upgrade_required`; newer Minor is `central_update_required`; different Major is `filesystem_migration_required`; malformed or unsupported API metadata is `misconfigured`/incompatible. Central contains explicit adapters/capability gates for exactly current and prior Minor and never invokes an unsupported capability.

Future normal Minor rollouts are central-first. Central rollback after any Backend has advanced must first verify the rollback central still accepts that Backend; otherwise affected Backends are rolled back before central. Cross-Major compatibility is not promised and every Major change must provide its own migration/cutover/rollback design.

### 12. Backend distribution and daemon lifecycle are native CLI surfaces

The cluster distribution contains the versioned Backend server, CLI, shared protocol/runtime code, and a manifest with release, revision, artifact digest, platform, and required Node/runtime versions. It does not require the Web frontend build.

The supported commands are:

- `memon backend serve --config <instance>`: foreground worker for debugging/external supervision;
- `memon backend daemon start|stop|restart|status --config <instance>`: native rootless supervisor lifecycle;
- `memon backend install --revision <exact> --config <instance>`: prepare and verify the initial immutable release;
- `memon backend update --revision <exact> --config <instance>`: prepare, activate, restart, verify, and roll back on failure;
- `memon backend rollback --config <instance> [--revision <installed>]`: activate a retained release and verify it;
- `memon backend token generate`: print a newly generated token only on explicit invocation for placement into protected local configs.

Machine-readable command output includes action, outcome, installed/running release and revision, daemon state, readiness, rollback outcome, and redacted error codes. It never returns secrets. Existing ordinary local Project CLI commands continue to use local Project config without going through central.

Install/update uses an Agent-managed checkout or fetched source only as input. It fails before stopping the running worker if the configured checkout is dirty, divergent from the requested revision, the revision cannot be verified, dependency lock is unavailable, platform/runtime checks fail, or the build/tests fail. It never reset-hard, autostashes, or resolves moving `latest` independently.

Each build lands in an immutable release directory; an atomic `current` pointer selects it. Runtime state/locks are separate from release bytes. Activation retains at least the previous known-good release. After restart the CLI checks authenticated readiness, Host ID, running release/revision, and capabilities. Failure restores the prior pointer, restarts the prior worker, verifies it, and reports both the original and rollback results. Running and installed revisions cannot be silently different.

### 13. Rootless supervision is NFS- and multi-node-safe

Native supervised mode owns one worker process group and one node-local exclusive lock. PID/lock/socket/start-time/boot identity live in a configurable node-local runtime directory, not a shared home. Persistent config, immutable releases, and logs may live on NFS, but running files are never overwritten in place. Duplicate start is idempotent or returns `already_running`; stale metadata is distinguished from a live matching process; stop records intent before terminating the process group so the supervisor does not restart it.

Unexpected worker exits restart with bounded exponential backoff and a crash-loop terminal state visible from `status`. Readiness verifies the expected process identity, authenticated Backend metadata, listener, Host ID, and release. Configured hostname and forbidden-environment guards are evaluated before locks or processes are created, preventing a shared-home invocation from a compute job. The configured stable Host ID never depends on the transient OS hostname.

Foreground mode uses the same worker/readiness contract without a supervisor. External-supervisor mode makes `serve` foreground and makes update return a structured `restart_required` unless an explicitly configured safe restart argv is present; it never guesses how to control systemd or another manager. Cross-reboot auto-start is absent. A reboot therefore produces stopped/offline until an Agent follows local operations notes and starts the daemon.

### 14. The initial split uses a side-by-side, no-double-writer cutover

The first transition is not a normal Minor rollout because the legacy standalone service has no Backend API. It follows these gates:

1. Build and test central, Backend, standalone composition, CLI lifecycle, current/prior compatibility, and synthetic multi-Host fixtures locally.
2. Generate protected local central/Backend instance configs and independent Backend tokens. Concrete values and runbook comments remain local.
3. Install a candidate Backend in a separate immutable release/runtime/config location and on a separate remote loopback port while the legacy standalone listener/watchdog remains unchanged. Candidate data mutation and terminal endpoints stay disabled; only metadata, discovery, and read verification are allowed.
4. Start a candidate central service on a separate loopback port. Establish its configured transport and verify Host identity, release/capabilities, aggregation, reads, large streaming responses, event reconnect, viewer scope, and offline/auth/version states.
5. Enter a short quiesce gate: stop accepting writes/terminal creation through the legacy public ingress, enable candidate Backend mutation/terminal capabilities, then verify one optimistic-lock write and rollback, SSE invalidation, tmux operations, and ttyd HTTP/WebSocket through the candidate central service. At no time are two public writable control planes active.
6. Add or update a machine-local reverse-proxy route only after candidate readiness. Validate the proxy configuration before reload; verify TLS, anonymous rejection, central login, HTML markup/CSS, API, SSE, and WebSocket through the public endpoint.
7. Keep the old ingress mapping and standalone release/watchdog configuration as an immediate rollback but prevent it from being a second writable public entry. Observe the new path, then stop the old standalone watchdog/process and remove or replace any login hook that could revive it.
8. Only after the new path is stable may old runtime material be retired. Archival of this OpenSpec change remains a separate user decision after the complete implementation and deployment are reviewed.

Rollback before the proxy switch simply stops candidates. Rollback after the switch first disables new writes, restores the prior proxy mapping, re-enables/verifies the legacy process, and only then stops the candidate. Any login-hook edit is backed up and reversed with the service rollback. No Project filesystem migration occurs for `6.0.0` because it remains FS convention v6.

## Risks / Trade-offs

- **[The scope crosses most Web/API surfaces]** → Introduce `ProjectRef` and a central/backend contract first, then migrate route families under compile-time types and a repository-wide name-only audit before deployment.
- **[A service token in a local YAML file increases config sensitivity]** → Require owner-only files/directories, redact every diagnostic, separate per-Host and SSH principals, support two-token rotation, and keep credentials out of tracked artifacts/Caddy/browser traffic.
- **[SSH tunnel instability interrupts requests and events]** → Keep the legacy ingress during bootstrap, monitor/reconnect with explicit Host state, cancel affected streams, invalidate only that Host after reconnect, and never retry ambiguous writes automatically.
- **[Two-hop terminal proxy adds latency and failure modes]** → Use streaming HTTP/WS at both hops, one static Backend tunnel, bounded buffers, close propagation, opaque routes, and end-to-end browser tests through the reverse proxy.
- **[A candidate and legacy process share Project roots]** → Keep candidate mutation/terminal capabilities disabled until a quiesced cutover gate; never expose two public writable surfaces.
- **[NFS and transient login Hosts can make PID files lie]** → Put runtime identity and locks on node-local storage, validate boot/start identity and authenticated readiness, and enforce machine/environment guards.
- **[Central-first rollback can meet a newer Backend]** → Check compatibility before rollback and roll Backends back first when required; preserve the previous release on every Host.
- **[No offline cache reduces availability]** → Keep every configured Host visible with an exact state and fail only its data; prefer correctness over stale research state.
- **[Standalone compatibility lengthens the transition]** → Compose it from the same service layer and mark the legacy Hub/Node config as rejected, avoiding a fourth implementation.
