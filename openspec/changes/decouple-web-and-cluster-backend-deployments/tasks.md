## 1. Release, Protocol, and Configuration Foundation

- [x] 1.1 Add one canonical `6.0.0` release source whose Major is asserted equal to `FS_CONVENTION_VERSION`, expose release/revision metadata to all packages, and verify tests reject a mismatched Major.
- [x] 1.2 Define runtime-validated shared DTOs for `HostId`, `ProjectRef`, Host-qualified resources, capabilities, metadata, availability states, actor context, events, and errors; verify malformed and name-only variants fail schema tests.
- [x] 1.3 Replace abandoned `hub:`/`node:` schemas with mutually exclusive `central:`/`backend:` role schemas plus standalone fallback; verify generic `url`/`ssh`, token rotation, daemon guards, unique Host/token, bind, and operations-hint validation.
- [x] 1.4 Enforce owner-only service-bearing instance config and parent-secret-directory permissions on POSIX, preserve registry comments during central auth initialization, redact secrets from validation, and verify permission/comment/redaction tests.
- [x] 1.5 Update `config.example.yml` with synthetic role examples and no real topology, then verify the example remains protected from runtime selection/writes and parses in template tests.

## 2. Shared Backend Service Layer and Role Builds

- [x] 2.1 Inventory every existing API/SSR/runtime call by route class, owning service, Project selector, streaming behavior, and capability; add a checked-in neutral routing manifest/test that fails when a new cluster route lacks ownership and authorization metadata.
- [x] 2.2 Extract cluster Runtime, discovery, cache, filesystem, Git, report, share, Slurm, tmux, Herdr, and terminal operations behind framework-neutral services without changing standalone behavior; verify the existing core/web/CLI suites after each route-family migration.
- [x] 2.3 Move cross-boundary filesystem inputs from absolute paths to Project-relative/opaque identifiers and enforce lexical plus realpath containment for reads and creates; verify traversal, encoded separator, symlink, device/absolute path, and cross-Project tests.
- [x] 2.4 Create an independently buildable Backend entry/artifact that runs the cluster Runtime and Backend HTTP server without Next/Web assets or human-auth initialization; verify its dependency/build output excludes the central frontend.
- [x] 2.5 Recompose standalone from the shared Backend services and existing Web adapters, then verify existing project-only routes, reads, writes, shares, SSE, tmux, and terminal behavior remain green.

## 3. Backend HTTP API and Service Authentication

- [x] 3.1 Implement `/api/backend/v1` metadata/readiness and capability discovery with Host ID, `6.0.0`, API major, revision, instance epoch, readiness, and redacted diagnostics; verify central-facing schema tests.
- [x] 3.2 Implement constant-time per-Backend Bearer authentication with old/next overlap and Host identity checks, reject Basic/cookies/foreign tokens, and verify token A cannot access Backend B.
- [x] 3.3 Implement Backend actor-context validation so owner/viewer reads are tuple-scoped and viewer mutation/shell requests fail even with a valid service token; verify route-class coverage tests.
- [x] 3.4 Expose all cluster data route families through the allow-listed versioned API using shared services and runtime-validated DTOs; verify read/write/mtime-conflict behavior against mock Projects.
- [x] 3.5 Implement streaming request/response piping, JSON/control size limits, cancellation, timeouts, Range/cache/content headers, and no automatic mutation replay; verify large binary/log streaming has bounded memory and downstream disconnect aborts upstream work.
- [x] 3.6 Implement authenticated Backend event SSE with heartbeat, instance epoch, monotonic sequence, bounded frames, and cancellation; verify restart/gap metadata and long-lived stream tests.
- [x] 3.7 Add negative runtime-API tests proving Git install/update, daemon control, arbitrary shell, absolute roots, and unregistered paths are unavailable.

## 4. Central Registry, Transports, and Secure Gateway

- [x] 4.1 Implement the local central Host registry, normalized Backend upstream interface, per-Host health state machine, deadlines, safe diagnostics, and no stale Project payload storage; verify all enumerated states and one-Host failure isolation.
- [x] 4.2 Implement `url` transport validation with private/insecure opt-in, fixed authority/base path, no userinfo/query/fragment, disabled credentialed redirects, and verify SSRF/redirect negative tests.
- [x] 4.3 Implement gateway-owned `ssh` tunnel processes with argv/no-shell execution, loopback local forwarding, pinned known-hosts, identities-only, batch mode, exit-on-forward-failure, keepalive, process-group cleanup, jittered backoff, and authenticated readiness; verify fake-SSH lifecycle, pin failure, collision, reconnect, and shutdown tests.
- [x] 4.4 Implement exact Host route resolution and fixed Backend route mapping with no broadcast/first-hit fallback; verify missing/unknown Host and duplicate resource-name tests contact zero or one expected upstream.
- [x] 4.5 Build Backend requests from a clean header allow-list, inject service token/actor context, filter unsafe Backend response headers and redirects, and verify forged auth/cookie/forwarding/internal/hop-by-hop headers cannot cross either direction.
- [x] 4.6 Implement partial Project aggregation plus `/api/hosts` so configured unusable Hosts remain visible while only usable Hosts contribute live Projects; verify bounded fan-out and equal Project names.

## 5. Host-Qualified Web, API, Cache, and Layout Migration

- [x] 5.1 Replace optional node labels and name-only central types with required `ProjectRef`/Host-qualified resource types across server and client; verify TypeScript prevents central fetches/mutations without Host.
- [x] 5.2 Add canonical `/h/<host>/p/<project>/...` Web routes and Host-qualified API selectors across every Project/resource route family, with standalone project-only adapters; verify direct navigation and SSR for duplicate Projects/resources.
- [x] 5.3 Migrate all client fetches, TanStack query keys, localStorage keys, BroadcastChannel messages, popup/report links, and mutations to include Host; run a repository audit/test that rejects known name-only central key patterns.
- [ ] 5.4 Redesign sidebar/top navigation to group configured Hosts and live Projects, show exact Host states, remove stale offline Project links, and keep responsive/persisted state Host-qualified; verify rendered markup and compiled CSS tokens per `CLAUDE.md`.
- [x] 5.5 Add unique-match-only legacy project-route redirects and explicit ambiguous/offline chooser/error behavior; verify no redirect or mutation selects the first matching Host.
- [x] 5.6 Update central page titles for Project/resource/error/terminal/tmux pages to include Host and Project while preserving standalone titles; verify title tests with duplicate names.
- [x] 5.7 Verify production central with no explicit local Backend shows no mock Projects, while an explicit development mock Backend traverses the same authenticated gateway path.

## 6. Central Human Auth and Host-Qualified Shares

- [x] 6.1 Keep owner password/session/rate-limit enforcement central-only, remove human-auth initialization from Backend, and verify one central login authorizes configured Hosts without exposing a Backend credential.
- [x] 6.2 Change viewer cookie payloads, route classification, middleware/project resolution, and server actor context to `{host, project}` scopes; verify equal-name cross-Host reads return 403 and mutations/shell remain owner-only.
- [x] 6.3 Route share create/list/revoke/validate to the exact owning Backend, issue `/share/<host>/<project>/<token>` links, and verify revocation/expiry/offline behavior through central.
- [x] 6.4 Add bounded migration support for legacy project-only shares using only explicit/unique Host resolution, and verify ambiguous tokens grant no scope.
- [x] 6.5 Verify no Backend token, service-auth challenge, absolute cluster path, session secret, or private SSH detail appears in browser responses, source maps, logs, status, or diagnostics.

## 7. Host Availability and Live Updates

- [x] 7.1 Implement one Backend SSE client per usable Host and merge Host-tagged events into the existing single browser SSE connection with Host-qualified viewer filtering; verify simultaneous equal-Project events do not cross-invalidate.
- [x] 7.2 Keep aggregate browser SSE alive when one Host disconnects/auth-fails/becomes incompatible and continue other Host events; verify isolated transition tests.
- [x] 7.3 Detect Backend reconnect, epoch change, and sequence gap, emit Host-resync, and invalidate every live query for only that Host before incremental events resume; verify missed-event recovery tests.
- [x] 7.4 Surface `connecting`, `offline`, `authentication_failed`, `identity_mismatch`, `misconfigured`, `filesystem_migration_required`, `upgrade_required`, `central_update_required`, `update_available`, and `online` in UI/API with safe diagnostics; verify each state renders and gates data/capabilities correctly.

## 8. Host-Scoped Cluster Features

- [x] 8.1 Migrate tmux list/detail/create/rename/kill/stale/pane-info APIs and `/manage/tmux` selection/query/cache/URL state to `{host, session}`; verify same-name sessions on two Hosts and all owner-only mutations.
- [x] 8.2 Route Slurm capability/status to only the selected Backend and disable the widget without shell-out for unavailable/disabled Hosts; verify two-Host capability tests.
- [x] 8.3 Route Herdr capability, workspace/launch/attach, and terminal targets to only the selected Backend; verify one Host lacking Herdr does not affect another.
- [ ] 8.4 Render and inspect Host selectors/statuses/tmux controls at desktop and mobile sizes, confirm expected markup and required Tailwind token definitions, and record visual verification.

## 9. Two-Hop Remote Terminal Relay

- [x] 9.1 Add a service-authenticated Backend terminal HTTP/WebSocket relay that resolves opaque routes through the local manager to dynamic loopback ttyd ports without returning ports; verify assets, binary WS frames, base paths, and unknown-route failures.
- [x] 9.2 Add central owner-authenticated `/Host + session/` terminal HTTP/WebSocket routing that strips browser auth, injects the selected Backend token/context, and verifies Origin/Host/path/upgrade/subprotocol; cover viewer, forged-header, foreign-token, and cross-Host negative tests.
- [x] 9.3 Host-qualify terminal check/install/start/attach/list/stop plus drawer/split/popup/BroadcastChannel/cache state; verify equal session names, navigation persistence, and no retarget after Host failure.
- [x] 9.4 Preserve backpressure, bounded buffering, cancellation, close propagation, LRU/TTL, stop/kill/stale cleanup, copy/mouse behavior, and verify cleanup invalidates only the exact route.
- [x] 9.5 Run end-to-end ttyd HTTP and WebSocket tests through both `url` and `ssh` normalized Backend transports and through a reverse-proxy fixture.

## 10. Release Compatibility and Capability Adapters

- [x] 10.1 Enforce `MAJOR == FS_CONVENTION_VERSION`, Backend/CLI-changing Minor, central-only Patch, and Backend/CLI artifact immutability on Patch in release/build validation tests.
- [x] 10.2 Implement the compatibility matrix for current/prior/old/new/Major-mismatch/malformed Backend versions and verify Patch-insensitive negotiation.
- [x] 10.3 Add explicit current and previous Minor protocol adapters/capability gates, with fixture Backends proving central never calls a capability absent from the prior Minor.
- [x] 10.4 Add rollout/rollback preflight logic that pins one target revision and rejects central rollback that would strand newer Backends; verify partial-rollout simulations.

## 11. Backend Distribution, Native Daemon, Update, and Rollback

- [x] 11.1 Produce a Backend/CLI distribution manifest and immutable release layout with atomic current pointer and retained known-good release; verify release/digest/platform/runtime metadata after install.
- [x] 11.2 Implement `memon backend serve` and `daemon start|stop|restart|status` with node-local lock/PID/socket/start-time/boot identity, process-group ownership, intentional-stop state, and structured redacted output; verify duplicate start, stale PID, orphan, stop, and status tests.
- [x] 11.3 Implement configurable hostname/forbidden-environment guards and node-local runtime-directory validation before spawn; verify shared-home compute-context invocations create no process or state.
- [x] 11.4 Implement bounded worker restart/backoff and observable crash-loop state, plus foreground and external-supervisor contracts; verify worker recovery, terminal crash state, and external `restart_required` behavior.
- [x] 11.5 Implement explicit token generation plus pinned `backend install|update|rollback` preflight for clean/non-divergent source, exact revision/digest, locked dependencies, platform/runtime, build/tests, and no hard-reset/autostash/latest; verify every preflight failure leaves the live daemon untouched.
- [x] 11.6 Implement activate/restart/authenticated readiness verification and automatic prior-release rollback, checking Host ID, capabilities, release, and running revision; verify failed new worker restores a verified old worker and reports both outcomes.
- [x] 11.7 Verify NFS-safe update never overwrites running release bytes in place and that reboot leaves the daemon explicitly stopped/offline until the local start path is invoked.

## 12. Canonical Entrypoints and Abandoned Implementation Removal

- [x] 12.1 Wire CLI central/Backend/standalone commands to the actual custom HTTP/WebSocket entrypoints and configured bind address/port, then verify no canonical serve path bypasses gateway or ttyd upgrade handling.
- [x] 12.2 Remove old Hub/Node schemas/types/config example, node-initiated WS client, inbound connect endpoint, registry/JSON RPC/proxy, route-module resolver/dispatcher, optional node badges, and obsolete tests/dependencies; verify repository search finds no active `add-hub-node-split`, `hub:`/`node:` runtime, or broadcast-first-hit implementation.
- [x] 12.3 Add negative tests proving legacy Hub/Node configs and connect endpoints cannot reactivate the abandoned architecture.
- [ ] 12.4 Run full core/web/CLI typecheck, lint, build, and tests from a clean build output and fix all failures without weakening the new security/identity contracts.
  - Deployment preview may proceed with the operator-approved Web component-test deferral; keep this task open until those tests are repaired and the complete suite passes.

## 13. Synthetic Multi-Process and Security Verification

- [x] 13.1 Start one central plus at least two synthetic Backends with duplicate Project/resource/session names and verify all reads, writes, conflicts, URLs, caches, events, shares, tmux, Slurm/Herdr gates, and terminals remain Host-isolated.
- [x] 13.2 Verify anonymous central/Backend access, cross-Backend tokens, forged headers, SSRF/redirects, path traversal/symlinks, oversized JSON, slow/aborted streams, and ambiguous mutations all fail closed.
- [x] 13.3 Verify current/prior/too-old/newer/Major-mismatch/offline/auth-failed/identity-mismatch/misconfigured Host fixtures remain distinguishable while usable Hosts continue.
- [x] 13.4 Run a large streamed asset/log benchmark and long-lived SSE/terminal soak test, record bounded memory/cancellation/reconnect behavior, and resolve any leak or unbounded queue.
- [ ] 13.5 Serve the production central build, inspect real Host-qualified page markup and compiled CSS variables, exercise mobile/desktop navigation, and capture browser-level API/SSE/WebSocket evidence per `CLAUDE.md`.

## 14. Side-by-Side Bootstrap Deployment

- [ ] 14.1 Create owner-only Git-ignored central and Backend instance configurations with all concrete Host/domain/address/port/SSH/key/token/path/runbook values only there; verify Git ignore status, permissions, schema, token separation, and SSH host-key pinning without printing secrets.
- [ ] 14.2 Install the candidate Backend into separate immutable release/runtime/config locations on the target cluster Host, bind it to a separate remote loopback port with read-only candidate capabilities, and verify the existing standalone listener/watchdog/hook/PIDs and public behavior remain unchanged.
- [ ] 14.3 Start the candidate central service on a separate center-loopback port, establish the gateway-managed SSH tunnel, and verify authenticated identity/release/capabilities, Projects, reads, large streams, events, viewer scopes, and all failure states while legacy remains live.
- [ ] 14.4 Enter the documented quiesce gate, prevent the legacy ingress from accepting writes/terminal creation, enable candidate mutation/terminal capabilities, and verify one reversible optimistic-lock write, SSE invalidation, tmux lifecycle, and ttyd HTTP/WebSocket without two public writable planes.
- [ ] 14.5 Back up and replace/remove any legacy login hook or watchdog activation that could revive standalone, verify the new rootless daemon guard/runtime state, and retain a tested hook/watchdog rollback path.

## 15. Central Ingress Cutover and Observation

- [ ] 15.1 Install the central production build under the selected local supervisor and verify loopback readiness, restart behavior, logs, running `6.0.0` revision, and rollback before modifying reverse-proxy ingress.
- [ ] 15.2 Add a machine-local credential-free reverse-proxy drop-in from the local runbook, validate before reload, and verify the public endpoint's TLS, anonymous rejection, owner login, Host UI, HTML/CSS, API, SSE flushing, and terminal WebSocket.
- [ ] 15.3 Keep the prior ingress/runtime as a non-writable immediate rollback during observation, simulate and recover from Backend/tunnel/central failure, and verify rollback restores the legacy path before stopping candidates.
- [ ] 15.4 After the observation gate passes, stop the legacy standalone watchdog/process, confirm it cannot revive on login/reboot, retain recovery material, and verify only central ingress plus the private Backend remain active.
- [ ] 15.5 Review the complete change diff, task evidence, local deployment status, and remaining user-requested refinements; leave the change unarchived until the user confirms the entire implementation and deployment are complete.
