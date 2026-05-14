## Context

The dashboard is meant to be the "single pane of glass" for the user's
research workflow. Today, "am I running anything on Slurm right now and
how many nodes am I burning" is the one piece of context the user still
needs a terminal for. The host this dashboard runs on (`fs-mbz-gpu-*`)
exposes `squeue --me`, and the cluster has 8 nodes; other deployments
may not have Slurm at all, so the feature has to be opt-in.

The sidebar already has a footer with the "Manage tmux" link
(see `web-layout` spec, "Sidebar footer with link to tmux management
page"). The slurm widget fits there: a compact "in-use / total" pill,
expanded on hover/tap. No new route, no persistence.

## Goals / Non-Goals

**Goals**
- Show current `usedNodes / totalNodes` always-visible in the sidebar
  footer when enabled.
- Show per-job details (`squeue --me` rows) on demand: hover on
  desktop, dialog on mobile.
- Opt-in via `config.yml`. Refusal to start when the user opts in but
  `squeue --me` doesn't work (fail loud, not silent).
- Reuse the existing auth middleware, polling pattern (TanStack
  `useQuery` + `refetchInterval`), and sidebar primitives. No new
  shadcn primitives if Tooltip + Dialog already exist.

**Non-Goals**
- Cross-user views ("what's everyone running"). Only `--me`.
- Persisting Slurm history. Live data only; no DB.
- Submitting / canceling jobs from the dashboard. Read-only.
- Per-project filtering. The widget is host-level, not project-scoped.
- A standalone `/manage/slurm` page. Hover + dialog only.

## Decisions

### D1. Opt-in via `slurm.total_nodes` (single field)

- Add `slurm:` block to `config.yml` with one field, `total_nodes`.
- `total_nodes: -1` (default when block absent) → disabled.
- `total_nodes >= 1` → enabled, with that integer as the displayed
  denominator.
- Validation: integer; `>= -1`; `!= 0` (zero would render "X / 0",
  which is meaningless — reject at config-load with a clear error).

**Alternatives considered:**
- Boolean `enabled: true/false` plus a separate `total_nodes` field —
  two settings the user has to keep consistent. Rejected: a single
  field with a sentinel value matches how the user phrased the
  requirement ("如果配置的是-1则说明不开启").
- Auto-detect cluster size via `sinfo`. Rejected for v1: more
  squeue-family commands to probe, more failure modes, and the user
  knows their cluster size already.

### D2. Capability probe at startup, not at first request

- In `runtime.ts` `init()`, after `loadConfig` + auth init, run the
  probe. If `total_nodes != -1` AND the probe fails, throw — the
  server refuses to start.
- If `total_nodes == -1`, skip the probe entirely (no `squeue`
  process spawned on machines without Slurm).
- Cache the probe result on `Runtime`: `runtime.slurm = { enabled,
  totalNodes, supported }`. The API handler reads this; no per-request
  probe.

**Probe procedure:**
1. `execFile('squeue', ['--version'], { timeout: 5_000 })` — binary
   exists and is callable.
2. `execFile('squeue', ['--me', '--noheader'], { timeout: 5_000 })`
   — the `--me` flag is supported (added in Slurm 20.02; older
   distros may lack it). Empty stdout is success; non-zero exit is
   failure.

**Alternatives considered:**
- Lazy probe on first API call. Rejected: the user said "如果不支持
  并且配置不是-1还会报错" — they want the error at startup, not
  silently buried in a 500 nobody looks at.
- Periodic re-probe. Rejected: if `squeue` was working at boot and
  breaks at runtime, the per-request `runSqueueMe()` will surface the
  failure as a 500 anyway, and the widget already renders an error
  state for that.

### D3. `usedNodes` definition: sum of `NumNodes` for `R`-state jobs

`squeue --me` includes pending (`PD`), running (`R`), and various
transient states. For the headline number we want "what am I
actually consuming right now":
- Include only `R` (running). `PD` jobs haven't reserved nodes.
- Sum `NumNodes` column across those rows. (Not "count distinct
  hostnames in `NodeList`" — a multi-node job with `NodeList=fs-mbz-gpu-[111,469]`
  should count as 2, not 1; summing `NumNodes` is the
  Slurm-canonical answer.)

The full `jobs[]` payload returned by the API still includes pending
/ other states so the hover/dialog table is informative.

### D4. Output format: `-O` with stable field list

Use `squeue --me --noheader -O 'JobID:|,Partition:|,Name:|,StateCompact:|,TimeUsed:|,NumNodes:|,NodeList:|'`
— each field carries a `:|` suffix so the output is **pipe-delimited**.

We initially tried plain `-O 'JobID,Partition,...,NodeList'` (no
suffix) and split on `\s+`, but a job name that exactly filled
slurm's default 20-char `Name` column (real example:
`lk-lambda-eta10-cold`) fused with the next column's value
(`lk-lambda-eta10-coldR`), silently dropping a column and triggering a
parse error in production. Pipe-delimited output preserves field
boundaries regardless of value width.

Note: `State` returns the long word (`RUNNING`); `StateCompact`
returns the short code (`R`). The headline-count filter
(`state === 'R'`) requires the short codes, so we explicitly request
`StateCompact`.

**Why:** the default `squeue` output is column-aligned with variable
widths depending on terminal width; parsing it robustly requires
re-implementing slurm's pad logic. `-O <field>[:size][,<field>...]`
with no per-field size emits fields separated by single spaces — far
easier to split. Names with embedded spaces are escaped to underscores
by slurm in this mode, so a split on the `|` separator is safe.

We deliberately ALSO carry `JOBID` and `NAME` even though they don't
contribute to the headline count, so the hover table is useful.

**Alternatives considered:**
- `--json`. Rejected: not universally available across Slurm versions
  (added in 20.11; some clusters still on 19.x). The `-O` flag is
  much older.
- Default output + custom regex parser. Rejected: brittle across
  Slurm versions; format changes broke other tools downstream of
  `squeue` in the past.

### D5. Auth class: owner-only `read`

Register `/api/slurm/status` as `read`-class but pin `projectFor` to
`'global'` so viewer cookies don't pass. Reasons:
- The output is host-level, not project-scoped — `usedNodes` reflects
  the OS user `memon serve` runs as, not the viewer's identity.
- Surfacing it to a project-share viewer would leak host metadata
  (job names, partitions, hostnames) outside the share's scope.

This mirrors how `/manage/tmux` is gated `shell` even though it's
read-y — the action of running host-level commands is owner-only.

Using `read` (not `shell`) is correct because the route doesn't spawn
a terminal session or hold state; it just queries `squeue` per
request. Following the existing taxonomy: `shell` = persistent tmux/
ttyd; `read` + `'global'` + owner-required = one-shot host queries.

### D6. UX: Tooltip on desktop, Dialog on mobile

- shadcn `Tooltip` is already installed (`apps/web/components/ui/tooltip.tsx`).
  It fires on hover/focus on desktop, and on mobile most browsers
  trigger it on touch-and-hold — which is bad UX (long delay + has
  to dismiss).
- shadcn `Dialog` is already installed and used throughout
  (e.g. `ReadmeEditor`).
- Branch on `useIsMobile()` from `@/hooks/use-mobile`:
  - Desktop: wrap the row in `<Tooltip><TooltipTrigger asChild>
    <row/></TooltipTrigger><TooltipContent>table</TooltipContent></Tooltip>`.
  - Mobile: render the row as a `<button>` that opens a controlled
    `<Dialog>` carrying the same table.

The TooltipContent's default `max-w-xs` is too narrow for a 7-column
job table; the implementation will override with a wider variant
(e.g. `className="max-w-[min(90vw,520px)] p-3"`). The table itself
uses a compact `<table>` with `text-xs/relaxed`, consistent with the
existing dashboard dense style.

**Alternatives considered:**
- shadcn `HoverCard` for desktop + `Sheet` for mobile. Rejected:
  HoverCard isn't installed and adds another component. Tooltip is
  sufficient for the desktop case (small, dismissive, no
  click-to-pin needed); Dialog is the standard mobile pattern in
  this app.
- Single component (Popover) for both. Rejected: Popover requires a
  click on desktop too, breaking the "just hover" expectation.

### D7. Polling cadence: 30s default, no config knob

Slurm job state changes on the order of minutes (job dispatch, queue
draining). 30s is responsive enough that the widget feels live
without burning a `squeue` invocation every few seconds.

We DON'T add a config knob for the cadence: more surface area for
less value. If 30s turns out wrong, a follow-up change adds the knob.

**Alternatives considered:**
- 10s. Rejected: too chatty; each poll spawns a subprocess.
- 60s. Rejected: enough lag that "I just submitted a job, where is
  it?" would be a long wait.

### D8. Process safety for `squeue`

- `execFile`, never `exec` (no shell interpolation; no arg injection
  vector even though no user input flows in).
- 10s timeout on the request. The probe uses 5s.
- 256 KB stdout cap (`maxBuffer`). A user with hundreds of running
  jobs would blow past the default; cap protects the Node process
  from OOM.
- On timeout / cap / non-zero exit: handler returns 500 with
  `{ error: { code: 'SLURM_UNAVAILABLE', message } }` and the widget
  renders an error state.

### D9. Sidebar mount: same gate as "Manage tmux"

In `app-sidebar.tsx` the SidebarFooter renders Manage tmux only when
`role !== 'viewer'`. The slurm widget mounts inside the same
conditional block, above the Manage tmux item. When the feature
is disabled (config = `-1`) the widget renders `null` so there's no
visual artifact.

The widget itself fetches `/api/slurm/status` and inspects the
`enabled` field at runtime — it does NOT need a server-side
"is slurm enabled" prop, because the sidebar is a client component
and re-fetching the runtime flag from the API is cheap.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| `squeue --me` hangs (Slurm controller unreachable) → API hangs → widget spins forever | 10s `execFile` timeout; on timeout, return 500; widget renders error state and continues polling |
| Slurm version mismatch — `-O` field names rename in a future release | Probe runs `squeue --me` at startup with the SAME `-O` field list as production; mismatch fails at startup rather than at runtime |
| Hard-fail-at-startup is too aggressive when the user is offline temporarily | Documented in proposal: this is intentional. The user can comment out the `slurm:` block (or set `total_nodes: -1`) to bypass |
| Hover Tooltip flicker on long tables | Use shadcn `Tooltip` with a small `delayDuration` (e.g. `200`) and a wider `max-w` content variant; the table is plain HTML, no virtualization |
| Mobile tap on the widget row when the dialog is closed should ALSO trigger Manage tmux navigation accidentally | The widget is a separate `SidebarMenuItem` BELOW Manage tmux; its onClick opens the dialog and doesn't propagate. The two rows have distinct click targets. |
| Viewer sees stale "Manage tmux" but should NOT see slurm | The widget is rendered inside the same `role !== 'viewer'` block, with an additional API-side `read` + `'global'` + owner-required guard so a viewer hitting the API directly gets 401. Defense in depth. |
| `usedNodes` count when the user has many short jobs racing through `PD → R → CG → completed` looks jittery | Acceptable — that's what's actually happening. The widget is meant to reflect the live state, not smooth it. |

## Migration Plan

This is additive; no migration. Behavior summary:

- **Pre-existing installs** (no `slurm:` block in `config.yml`): nothing
  changes. `slurm.total_nodes` defaults to `-1`, probe skipped, widget
  hidden.
- **This host** (`fs-mbz-gpu-*`): the user will add
  ```yaml
  slurm:
    total_nodes: 8
  ```
  to `config.yml` and restart `memon serve`. Probe passes (we just
  verified `squeue --me` works), widget mounts, polling begins.
- **Rollback**: comment out the `slurm:` block or set `total_nodes: -1`,
  restart.

No DB schema, no on-disk file format, no FS_CONVENTION_VERSION bump.

## Open Questions

None at proposal time. The unknowns the user might raise later:

1. Should `usedNodes` include `PD` jobs (showing "claimed + pending")?
   → Default to "only R". Easy to widen later.
2. Should there be a "click to copy `squeue --me` command" affordance
   in the dialog? → Not in v1.
3. Should multi-cluster (federated Slurm) be supported via `slurm:`
   being a list? → No — this user is single-cluster, YAGNI.
