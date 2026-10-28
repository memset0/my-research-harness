## Why

Service Reports (live dashboards) must not run on a login node or listen only on loopback; owners now run them on cluster compute nodes bound to all interfaces. The File Agent forwards a service port only to its own 127.0.0.1, so a dashboard on another node is unreachable without extra tunnels, and compute nodes refuse SSH forwarding.

## What Changes

- File Agent `servicePorts` entries may be `{ "host": "<name or IP>", "port": N }` next to bare integers (which still mean 127.0.0.1). Port N is the port a Report manifest names; the agent forwards it to `<host>:N`.
- The host comes only from the operator's agent config (validated: IP address or DNS name, no scheme, path or port; each port at most once). Manifests are unchanged and cannot name a host.
- Grants, identity checks, admission and the TLS path between central and the agent are unchanged; only the upstream hop changes. Unreachable upstreams answer `SOURCE_UNAVAILABLE` (5 s connect, 10 s response headers). The agent advertises `service-hosts-v1`.

## Capabilities

### New Capabilities
- `agent-service-hosts`: host-qualified service ports in the File Agent.

### Modified Capabilities

## Impact

`packages/file-agent/internal/agent/{services,files,server}.go` and tests, `packages/file-agent/README.md`. Agent-only: installed separately, no central or CLI release. Older agents refuse the object form at load.
