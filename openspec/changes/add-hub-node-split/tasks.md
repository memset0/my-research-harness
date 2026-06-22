# Tasks

## 1. Config: hub/node blocks
- [x] 1.1 Add `HubConfigRawSchema` + `NodeConfigRawSchema` to `packages/core/src/schemas.ts`; wire both (optional) into `ConfigRawSchema` (also relaxed `projects` to allow a project-less hub)
- [x] 1.2 Add `HubConfig` / `NodeConfig` / `NodeCapabilities` types + `Config.hub?` / `Config.node?` in `packages/core/src/types.ts`
- [x] 1.3 Parse + validate in `packages/core/src/config/load.ts`: snake→camel; reject both blocks present; node requires `name`+`auth_token`+`hub_url`; hub `public_url` optional + `nodes[]` defaults `[]`; reject duplicate node names; enforce ">=1 project unless hub"; default `capabilities {tmux:true, projects:true}`
- [x] 1.4 Document both blocks in `config.example.yml`
- [x] 1.5 Unit tests (9): node camelCase, capabilities override, hub defaults+registry, hub-no-projects ok, non-hub-no-projects→error, both→error, missing hub_url→error, non-kebab name→error, duplicate node name→error

## 2. Transport — node side (`apps/web/lib/node/`)
- [x] 2.1 WS client (`lib/node/hub-client.ts`) dialing `node.hub_url` + connect path with `Authorization: Bearer`; reconnect w/ exponential backoff. Real-ws smoke test.
- [x] 2.2 RPC dispatcher (`lib/node/dispatch.ts` + `lib/node/route-resolver.ts` + `lib/hub-node/protocol.ts`): resolve path→route module via filesystem walk, dynamic-import + invoke the handler with a synthetic Request + `{params}`, serialize `{status,body,headers}`. Verified against real handlers.
- [x] 2.3 Event relay (`lib/node/node-link.ts` + hub-client): relay `rt.events` topics as `event` frames.
- [x] 2.4 On connect, advertise `hello` (name + capabilities + project list).
- [x] 2.5 Node entrypoint: `server.ts` runs headless (runtime + WS client, no Next) when `role=node`.

## 3. Transport — hub side (`apps/web/lib/hub/` + `lib/server-core.ts`)
- [x] 3.1 Node registry (`lib/hub/registry.ts` `NodeRegistry` + `HubLink`): name→link, capabilities, projects; `forProject`/`tmuxNodes`/`projectNodes`.
- [x] 3.2 `/api/hub/nodes/connect` WS endpoint in `server-core.ts` upgrade path; Bearer verify vs `hub.nodes[]` (`lib/hub/node-auth.ts`, constant-time); register on hello, 401 on fail.
- [x] 3.3 RPC client (`HubLink.call`): send req frames, correlate by `id`, timeout + node-offline error.
- [x] 3.4 Deregister on disconnect; replace on duplicate node name (`NodeRegistry.attach`).

## 4. Hub data proxy + event relay
- [x] 4.1 Hub-mode data-route forwarding (`lib/hub/proxy.ts` `forwardRequest` + `server-core.ts` `forwardToNode`): data `/api/*` → owning node (by project, single-node, or broadcast-first-hit) → RPC → relay; 503 if offline. **Owner-auth enforced at the forward point** (viewers deferred to P3).
- [x] 4.2 `/api/projects` fan-out across `projects`-capable nodes + merge + tag by node (`fanOutProjects`).
- [x] 4.3 SSE relay: `registry.setEventSink` re-emits node events onto the hub's `rt.events`, so the existing `/api/events` stream + viewer-scope filter fan them to browsers unchanged.
- [x] 4.4 Hub runtime: reuses the full runtime with empty `projects` (idle discovery/poller) to supply `rt.events` + `rt.auth`; a leaner bespoke stub is a future optimization, not needed for correctness.

## 5. Projects UI (sidebar)
- [ ] 5.1 Carry the node tag on projects through `apps/web/lib/api.ts` types
- [ ] 5.2 `apps/web/components/app-sidebar.tsx`: group/label projects by node

## 6. tmux node-picker
- [ ] 6.1 Node-scoped tmux listing: thread `?node=` through the tmux-list fetch; hub RPC-forwards `tmux ls` (via `lib/terminal/tmux-discover.ts`) to the node
- [ ] 6.2 `apps/web/app/manage/tmux/tmux-page.client.tsx`: shadcn `<Select>` of tmux-capable nodes above the list; scope list + query key by node
- [ ] 6.3 Node-scoped terminal start (`apps/web/app/api/terminal/start`): target the selected node
- [ ] 6.4 Localhost attach: hub proxies `/api/terminal/proxy/*` to the node's loopback ttyd port (resolved via RPC)

## 7. Localhost run model
- [ ] 7.1 Role selection on `memon serve` (config block, optional `--role` override)
- [ ] 7.2 Hub + node `config.example.yml` snippets + a short run-model note (start hub, then node)

## 8. Tests + verification
- [ ] 8.1 Unit: RPC envelope round-trip (request → dispatch → response, id correlation)
- [ ] 8.2 Unit: `/api/projects` fan-out/merge + node tagging
- [ ] 8.3 Unit: Bearer handshake accept/reject
- [ ] 8.4 `pnpm --filter @memon/core typecheck` + `pnpm --filter @memon/web typecheck`
- [ ] 8.5 Manual e2e (localhost): start hub+node; sidebar shows the node's projects tagged; run detail loads (proxied); a README edit triggers SSE invalidation; tmux picker lists the node; attach opens a working terminal
