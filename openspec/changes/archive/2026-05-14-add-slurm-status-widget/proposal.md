## Why

The user runs experiments on a Slurm cluster and currently has to alt-tab
to a terminal and type `squeue --me` to check how many nodes their jobs
are occupying. There's already a sidebar footer (it carries the "Manage
tmux" link); a small always-visible "X / N" indicator there — with hover
/ tap details for the per-job breakdown — would surface that info inside
the dashboard the user is already looking at.

The host this dashboard runs on (`fs-mbz-gpu-*`) has `squeue` available
and a known cluster size of 8 nodes. The cluster total has to be
configurable rather than hardcoded because other deployments will have
different sizes (or no Slurm at all).

## What Changes

### Config: opt-in Slurm block

- Add a new top-level `slurm:` block in `config.yml`:
  ```yaml
  slurm:
    total_nodes: 8     # cluster capacity; -1 disables the feature entirely
  ```
- `total_nodes: -1` (default when block is absent) → feature disabled;
  no probe, no widget, no API.
- `total_nodes >= 1` → feature enabled; at server startup memon SHALL
  probe `squeue --me`. If the probe fails (binary missing / non-zero
  exit / `--me` unsupported), `memon serve` SHALL refuse to start with
  a clear error pointing at `config.yml`. This is intentionally strict:
  if the user wrote a positive number they expect the widget to work.

### Backend: capability probe + read-only API

- New `apps/web/lib/slurm/probe.ts`: runs `squeue --version` and
  `squeue --me --noheader` once at runtime init; caches the result.
- New `apps/web/lib/slurm/squeue.ts`: `runSqueueMe()` executes
  `squeue --me --noheader -O 'JobID,Partition,Name,State,TimeUsed,NumNodes,NodeList'`
  via `execFile` (no shell), 10s timeout, stdout cap, returns parsed
  rows.
- New `GET /api/slurm/status` route:
  - When disabled: `{ enabled: false }` (200).
  - When enabled: `{ enabled: true, totalNodes, usedNodes, jobs[] }`
    where `usedNodes` is the sum of `NumNodes` for `R`-state jobs
    only, and `jobs[]` carries one entry per row from `squeue --me`
    (regardless of state) with `{ jobId, partition, name, state, time,
    numNodes, nodeList }`.
  - When enabled but the runtime probe says unsupported: 500 with
    `{ error: { code: 'SLURM_UNAVAILABLE', message } }`. (This should
    not normally happen because the probe would have prevented
    startup; the path exists for "squeue was working at boot then
    broke" edge cases so the widget can surface the problem rather
    than silently hang.)
- The route is owner-only (HTTP Basic / session cookie). Viewers and
  anon SHALL receive 401 (no `read`-class share access — Slurm status
  is host-level info, not project-scoped).

### Frontend: sidebar footer widget

- New `apps/web/components/slurm-status-widget.tsx`:
  - Polls `/api/slurm/status` every 30s via TanStack `useQuery`
    `refetchInterval`.
  - Renders inside the existing `<SidebarFooter>` above the
    `Manage tmux` link. Hidden for viewers (same gate as Manage tmux).
  - When `enabled: false` (config = `-1`): renders NOTHING (no row,
    no placeholder — feature is off).
  - When enabled: renders a single `SidebarMenuButton`-styled row
    showing a server/cluster icon, the static label `Slurm Usage`,
    and a right-aligned shadcn `Badge` carrying `<usedNodes> / <totalNodes>`
    (e.g. the badge reads "3 / 8").
  - Desktop (`!useIsMobile()`): a shadcn `Tooltip` wraps the row;
    hover/focus reveals a table with columns `Job`, `Name`, `State`,
    `Time`, `Nodes`, `Hosts`, one row per job from `jobs[]`. Empty
    state: `"No active jobs"`.
  - Mobile (`useIsMobile()`): tapping the row opens a shadcn `Dialog`
    with the same table (no new page / route is introduced).
  - Error state: if the API returns 500 / `SLURM_UNAVAILABLE`, the row
    swaps the icon to `AlertTriangle`, colors the row destructive, and
    flips the right-edge badge to `variant="destructive"` reading
    `error`; hover/tap reveals the error message. Polling continues so
    a transient failure self-heals.

### Skipped on purpose

- No new top-level page or route (per user spec: hover / dialog only).
- No persistence: nothing is written to disk; data is fetched live.
- No cross-project gating: the widget reflects the host's `squeue --me`
  regardless of which project the user is currently viewing.

## Capabilities

### New Capabilities
- `slurm-status`: config-gated polling widget that surfaces
  `squeue --me` output in the sidebar footer. Covers the config schema,
  the capability probe, the `/api/slurm/status` endpoint, the widget's
  hover-on-desktop / dialog-on-mobile UX, and the disabled / error
  states.

### Modified Capabilities
- `web-layout`: the existing "Sidebar footer with link to tmux
  management page" requirement is widened so the footer SHALL ALSO
  render the slurm-status widget above the Manage tmux link when the
  feature is enabled and the viewer is the owner.

## Impact

- `packages/core/src/schemas.ts` — add `SlurmConfigRawSchema` and wire
  into `ConfigRawSchema`.
- `packages/core/src/types.ts` — add `SlurmConfig` interface,
  `DEFAULT_SLURM` constant, extend `Config`.
- `packages/core/src/config/load.ts` — parse `slurm:` block, validate
  `total_nodes` (integer, `>= -1`).
- `apps/web/lib/slurm/probe.ts` (NEW) — startup capability probe.
- `apps/web/lib/slurm/squeue.ts` (NEW) — `runSqueueMe()` executor +
  parser.
- `apps/web/lib/runtime.ts` — invoke probe during init; surface as
  `runtime.slurm = { enabled, totalNodes, supported }`; throw on
  startup when `total_nodes != -1` and probe fails.
- `apps/web/app/api/slurm/status/route.ts` (NEW) — GET endpoint.
- `apps/web/lib/api.ts` — `fetchSlurmStatus()` typed client.
- `apps/web/lib/auth/route-classes.ts` — register `/api/slurm/status`
  as owner-only `read` class (no viewer fallback).
- `apps/web/components/slurm-status-widget.tsx` (NEW) — sidebar
  widget.
- `apps/web/components/app-sidebar.tsx` — mount the widget above the
  Manage tmux item.
- `openspec/specs/slurm-status/spec.md` (NEW) — capability spec.
- `openspec/specs/web-layout/spec.md` — modified footer requirement.
- `config.yml` (live) — example/comments for the new `slurm:` block;
  on this host, set `total_nodes: 8`.
