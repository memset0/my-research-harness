# Tasks

## 1. Server probe and API

- [x] 1.1 Implement `apps/web/lib/server/cluster/probe.ts` (probe line, CSV parsing, per-GPU process counts, allocatable flags, 45 s timeout, concurrency 2, 45 s cache, in-flight dedupe, 256 KiB output cap) and `lib/server/cluster/tasks.ts` (`listTasks()` returning `null`), and verify `probe.test.ts` covers parsing, timeout → unreachable, cache reuse/refresh, expired-not-probed and no connection details in the overview
- [x] 1.2 Add the DTO in `lib/dto/clusters.ts`, `GET /api/clusters` (owner check, `refresh=1`, `NODES_CONFIG_INVALID` → 500) and its route-class rule (`read` + `global`), and verify `route.test.ts` (owner gets data, viewer refused) and the route-classes tests
- [x] 1.3 Add `queryKeys.clusters()` and the client fetcher, and verify the `query-keys.test.ts` snapshot

## 2. Page

- [x] 2.1 Build `/manage/clusters` with the cluster → node → GPU view, per-cluster headings with one collapsible card per node (unavailable nodes collapsed, a global expand/collapse-issues button), a timeline column (shared axis, availability window, busy marker, expires-in marker), the Tasks section with the no-task-source state, polling every 60 s, and a Refresh button, plus its navigation link; verify typecheck and Biome
- [x] 2.2 Verify the rendered page per AGENTS §4.3 on a 3738 preview with a neutral registry (fake `via: "sh -c"` node printing canned `nvidia-smi` output, an expired node, an unreachable node): markup and CSS-token checks, then `scripts/verify-page.mjs` desktop and 390 px screenshots without page exceptions

## 3. Release verification

- [ ] 3.1 After deployment, verify `/manage/clusters` renders the real registry's nodes with probed GPUs, and record the screenshot path
