## Why

The admin area spreads three permission surfaces (Users, Projects, Shares) over three navbar sections, and calls its network/filesystem operations page "File access". Separately, dynamic websites forwarded through service forwarding from remote hosts sometimes load resources very slowly, and the owner has no way to tell whether the slowness is the central→host network leg, the remote application, central's own per-request overhead, or the browser→central leg (central sits behind a public reverse proxy and a reverse tunnel).

## What Changes

- Admin navbar becomes **Clusters**, **Access control**, **Traffic control** (in that order, each still capability-filtered).
- New `/manage/access` page ("Access control") shows Users, Projects and Shares as separate cards, each with its existing capability gating; `/manage/users`, `/manage/projects` and `/manage/shares` redirect to its `#users`, `#projects` and `#shares` anchors.
- "File access" is renamed **Traffic control** and moves to `/manage/traffic`; `/manage/file-access` redirects there. Its existing content stays.
- Passive network tracking: central records every forwarded service request (HTTP and WebSocket) and every content-asset request — Host, Project, transport (native loopback, SSH tunnel, File Agent), document, query-free truncated path, status, bytes, central resolve time, upstream time to first byte, total duration, connection reuse and transfer throughput — in bounded memory (ring buffer plus per-Host/Project/transport minute aggregates).
- Active probes, super admin only: a central→host probe per Project through the same transport (File Agent capability round trips over the mTLS connection; SSH echo round trips and a bounded random-byte download over an SSH session; an optional re-fetch of a service path through the live forwarding target); and a browser→central check that downloads bounded payloads from an owner-only central endpoint and reports latency and throughput measured in the browser. Transports that cannot be probed say so.
- Traffic control shows compact tables of per-Host aggregates, recent and slowest requests, and probe results.

## Capabilities

### New Capabilities
- `traffic-tracking`: passive measurement of forwarded service and content-asset requests, owner-triggered central→host and browser→central probes, and their presentation in Traffic control.

### Modified Capabilities
- `user-accounts`: the admin navbar order and sections, the merged Access control page and the redirects of the old section URLs. This delta modifies requirements introduced by the still-active `user-accounts-admin` change and must be archived after it.
- `file-access-settings`: the settings panel is reached as part of Traffic control at `/manage/traffic`.

## Impact

`apps/web/lib/server/auth/{capabilities,route-classes}.ts`, `apps/web/lib/server/api-route-manifest.ts`, `apps/web/app/manage/**`, `apps/web/components/admin-*-panel.tsx`, `apps/web/components/file-access-settings-panel.tsx`, new `apps/web/components/traffic-*.tsx`, new `apps/web/lib/server/traffic/*`, `apps/web/lib/server/content-service-gateway.ts`, new `apps/web/app/api/traffic/**`, `apps/web/lib/{query-keys,traffic-api}.ts`. No persistence, no new external service, nothing installed on remote hosts. Central-only: PATCH release.
