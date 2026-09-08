# slurm-status Specification

## Purpose
Config-gated polling widget that surfaces `squeue --me` output in the sidebar footer of the memon dashboard. Covers the `slurm:` config block, the startup capability probe, the `/api/slurm/status` endpoint, the widget's hover-on-desktop / dialog-on-mobile UX, and the disabled / error states.

## Requirements

### Requirement: `slurm:` config block with single `total_nodes` field

`config.yml` SHALL accept an optional top-level `slurm:` block with one field:

```yaml
slurm:
  total_nodes: <integer>     # cluster total; -1 disables the feature
```

The config loader (`packages/core/src/config/load.ts` + `schemas.ts`)
SHALL parse this block and apply these defaults / validation:

- When the `slurm:` block is absent: `total_nodes` defaults to `-1`.
- `total_nodes` MUST be an integer.
- `total_nodes` MUST be `>= -1` and `!= 0`. The value `0` SHALL be
  rejected with a `ConfigError` ("slurm.total_nodes must be -1
  (disabled) or a positive integer").
- The resolved `Config` SHALL carry a `slurm: SlurmConfig` field with
  shape `{ totalNodes: number }` after camelCase conversion.

#### Scenario: Block absent defaults to disabled
- **GIVEN** `config.yml` has no `slurm:` block
- **WHEN** `loadConfig(...)` runs
- **THEN** the returned `Config.slurm.totalNodes === -1`

#### Scenario: Positive integer enables the feature
- **GIVEN** `config.yml` contains `slurm: { total_nodes: 8 }`
- **WHEN** `loadConfig(...)` runs
- **THEN** the returned `Config.slurm.totalNodes === 8`

#### Scenario: Zero rejected
- **GIVEN** `config.yml` contains `slurm: { total_nodes: 0 }`
- **WHEN** `loadConfig(...)` runs
- **THEN** it throws `ConfigError` with a message mentioning
  `slurm.total_nodes`

#### Scenario: Non-integer rejected
- **GIVEN** `config.yml` contains `slurm: { total_nodes: 7.5 }`
- **WHEN** `loadConfig(...)` runs
- **THEN** it throws `ConfigError`

### Requirement: Startup capability probe for `squeue --me`

The web server runtime (`apps/web/lib/runtime.ts` `init()`) SHALL probe `squeue` capability once during initialization when `Config.slurm.totalNodes !== -1`, AFTER config + auth init and BEFORE warmup.

The probe SHALL:

1. Run `execFile('squeue', ['--version'], { timeout: 5000 })`.
2. Run `execFile('squeue', ['--me', '--noheader'], { timeout: 5000 })`.

Both invocations MUST exit 0 within the timeout for the probe to pass.
A non-zero exit, ENOENT, or timeout from EITHER call counts as failure.

On failure:
- If `Config.slurm.totalNodes === -1`: the probe is NOT run at all,
  and the runtime continues normally (no Slurm code paths active).
- If `Config.slurm.totalNodes >= 1` AND the probe FAILS: `init()`
  SHALL throw, with an error message that names `squeue` and tells
  the user how to disable the feature (set `slurm.total_nodes: -1`
  in `config.yml`). `memon serve` SHALL refuse to start.

On success: the runtime SHALL expose
`runtime.slurm = { enabled: true, totalNodes: <N>, supported: true }`.
When the probe was skipped: `runtime.slurm = { enabled: false,
totalNodes: -1, supported: false }`.

#### Scenario: Disabled config skips the probe
- **GIVEN** `Config.slurm.totalNodes === -1`
- **WHEN** the runtime initializes
- **THEN** no `squeue` process is spawned during init
- **AND** `runtime.slurm.enabled === false`

#### Scenario: Enabled config + working squeue
- **GIVEN** `Config.slurm.totalNodes === 8` and `squeue --me` exits 0
- **WHEN** the runtime initializes
- **THEN** init resolves with `runtime.slurm = { enabled: true, totalNodes: 8, supported: true }`

#### Scenario: Enabled config + missing squeue refuses to start
- **GIVEN** `Config.slurm.totalNodes === 8` and `squeue` is not on `PATH`
- **WHEN** the runtime initializes
- **THEN** init throws with an error mentioning `squeue`
- **AND** the message instructs the user to set `slurm.total_nodes: -1` to disable

#### Scenario: Enabled config + squeue exists but --me unsupported
- **GIVEN** `Config.slurm.totalNodes === 8`, `squeue --version` exits 0, but `squeue --me --noheader` exits non-zero
- **WHEN** the runtime initializes
- **THEN** init throws

### Requirement: `GET /api/slurm/status` endpoint contract

The web backend SHALL expose `GET /api/slurm/status` returning JSON.

The endpoint SHALL be classified `read` with `projectFor: 'global'`
and SHALL be owner-only — viewer share cookies SHALL NOT pass.

**Disabled response** (when `runtime.slurm.enabled === false`):
```ts
{ enabled: false }
```
HTTP 200.

**Enabled response** (when `runtime.slurm.enabled === true` and the
runtime call to `squeue --me` succeeds):
```ts
{
  enabled: true,
  totalNodes: number,    // == runtime.slurm.totalNodes
  usedNodes: number,     // sum of NumNodes across R-state rows
  jobs: Array<{
    jobId: string,
    partition: string,
    name: string,
    state: string,       // short Slurm state code: R, PD, CG, etc. (from `StateCompact`)
    time: string,        // TIME column, e.g. "3:39:55" or "4-21:58:30"
    numNodes: number,
    nodeList: string,    // e.g. "fs-mbz-gpu-111" or "fs-mbz-gpu-[111,469]"
  }>,
}
```
HTTP 200.

**Failure response** (enabled but live `squeue` call fails — timeout,
non-zero exit, parse error):
```ts
{ enabled: true, error: { code: 'SLURM_UNAVAILABLE', message: <string> } }
```
HTTP 500.

The endpoint's live invocation SHALL use
`execFile('squeue', ['--me', '--noheader', '-O', 'JobID:|,Partition:|,Name:|,StateCompact:|,TimeUsed:|,NumNodes:|,NodeList:|'], { timeout: 10000, maxBuffer: 262144 })`.
The `:|` suffix on each field produces pipe-delimited output to avoid
the "value fuses with next column when it exactly fills the default
width" failure mode that plain comma-listed fields suffer from.

#### Scenario: Disabled returns minimal payload
- **GIVEN** `runtime.slurm.enabled === false`
- **WHEN** an authenticated owner GETs `/api/slurm/status`
- **THEN** the response is 200 with body `{ enabled: false }`

#### Scenario: Enabled with running jobs
- **GIVEN** `runtime.slurm.enabled === true`, `totalNodes === 8`, and `squeue --me` returns 3 R-state rows each with `NumNodes=1`
- **WHEN** an authenticated owner GETs `/api/slurm/status`
- **THEN** the response is 200 with `{ enabled: true, totalNodes: 8, usedNodes: 3, jobs: [...3 entries...] }`

#### Scenario: Enabled with mixed states
- **GIVEN** `squeue --me` returns rows: one `R/NumNodes=2`, one `R/NumNodes=1`, one `PD/NumNodes=4`
- **WHEN** an authenticated owner GETs `/api/slurm/status`
- **THEN** `usedNodes === 3` (only R rows summed)
- **AND** `jobs.length === 3` (all rows, regardless of state)

#### Scenario: Live squeue failure surfaces as 500
- **GIVEN** `runtime.slurm.enabled === true` but `squeue --me` exits non-zero at request time
- **WHEN** the endpoint executes
- **THEN** the response is 500 with `{ enabled: true, error: { code: 'SLURM_UNAVAILABLE', message: ... } }`

#### Scenario: Viewer rejected
- **GIVEN** a viewer session with a valid `memon-shares` cookie
- **WHEN** the viewer GETs `/api/slurm/status`
- **THEN** the response is 401 (viewer cookies are not decoded on this owner-only `global` route)

#### Scenario: Anonymous rejected
- **WHEN** an anonymous client GETs `/api/slurm/status`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`

### Requirement: Sidebar widget mounted in `<SidebarFooter>`

`apps/web/components/slurm-status-widget.tsx` SHALL be a client component
mounted inside the existing `<SidebarFooter>` in
`apps/web/components/app-sidebar.tsx` for owner sessions.

The widget SHALL fetch `/api/slurm/status` via TanStack `useQuery`
with `queryKey: ['slurm-status']` and `refetchInterval: 30000`.

Rendering branches:

- **`enabled: false`** (config = `-1`): the widget SHALL render
  `null`. No row, no skeleton, no placeholder.
- **Loading (initial fetch in flight)**: the widget SHALL ALSO render
  `null`. Reason: SSR can't know yet whether the feature is enabled
  (the fetch hasn't resolved), and rendering a skeleton would briefly
  surface a row on the disabled path, violating the
  `enabled: false → null` contract. The brief absence of a row on
  the enabled path is acceptable.
- **`enabled: true`**: render a single `<SidebarMenuItem>` containing
  a `<SidebarMenuButton size="sm">` with:
  - A lucide `Server` (or equivalent cluster) icon (`size-4`)
  - The static label text `Slurm Usage` (left-aligned, no trailing colon)
  - A shadcn `Badge` (variant `secondary`, `ml-auto`, `font-mono`) at
    the right edge of the row carrying `${usedNodes} / ${totalNodes}`
    (e.g. the badge text reads `3 / 8`)
- **Error**: render the same row but with the `Server` icon replaced
  by `AlertTriangle`, the row text in `text-destructive`, and the
  right-edge badge switched to `variant="destructive"` carrying the
  literal text `error`. The detail (`error.message`) SHALL be available
  via the same hover/tap mechanism as the normal table.

#### Scenario: Disabled feature renders nothing
- **GIVEN** the API returns `{ enabled: false }`
- **WHEN** the widget renders
- **THEN** the DOM contains no Slurm widget row

#### Scenario: Enabled feature renders X/N
- **GIVEN** the API returns `{ enabled: true, totalNodes: 8, usedNodes: 3, jobs: [...3 entries...] }`
- **WHEN** the widget renders
- **THEN** the sidebar footer contains a row showing the `Server` icon, the static text "Slurm Usage", and a right-aligned `Badge` reading "3 / 8"

#### Scenario: Polling cadence
- **GIVEN** the widget is mounted
- **WHEN** 30 seconds elapse
- **THEN** the widget re-fetches `/api/slurm/status` automatically

#### Scenario: Error state
- **GIVEN** the API returns 500 with `{ error: { code: 'SLURM_UNAVAILABLE', message: 'squeue: timeout' } }`
- **WHEN** the widget renders
- **THEN** it shows an `AlertTriangle` icon, the "Slurm Usage" text in destructive color, and a right-aligned `Badge` (variant `destructive`) reading "error"
- **AND** subsequent successful polls revert to the normal X/N display

### Requirement: Hover on desktop, Dialog on mobile — same content

The widget SHALL use `useIsMobile()` from `@/hooks/use-mobile` to
branch between two interaction patterns:

- **Desktop (`!useIsMobile()`)**: wrap the row in shadcn `<Tooltip>`
  with `delayDuration={200}`. The `<TooltipContent>` SHALL render
  the per-job table (described below) and SHALL override the default
  `max-w-xs` with `className="max-w-[min(90vw,520px)] p-3"` so the
  table fits.
- **Mobile (`useIsMobile()`)**: the row SHALL be a clickable
  `<SidebarMenuButton>` (button, not link) that toggles open a
  controlled shadcn `<Dialog>`. The `<DialogContent>` SHALL render
  the same per-job table. The dialog SHALL be dismissable by the
  `X` button, escape, or outside-click.

Per-job table content (identical for desktop and mobile):
- Columns in order: `Job`, `Name`, `State`, `Time`, `Nodes`, `Hosts`
  (text only; no icons in the body).
- One row per entry in `jobs[]`, regardless of state. Use
  `text-xs/relaxed` typography.
- Empty state (`jobs.length === 0`): a single-line "No active jobs"
  message in the same overlay.
- Error state: instead of the table, show the `error.message` text
  in destructive color.

The hover/dialog overlay SHALL NOT include any control that mutates
state (no kill-job buttons, no submission affordances). It is read-only.

#### Scenario: Desktop hover shows the table
- **GIVEN** the user is on a desktop viewport and the widget shows `3 / 8`
- **WHEN** the user hovers (or keyboard-focuses) the widget row
- **THEN** within ~200ms a tooltip appears with 6 columns and 3 rows of job data

#### Scenario: Mobile tap opens the dialog
- **GIVEN** the user is on a narrow viewport (`useIsMobile() === true`) and the widget shows `3 / 8`
- **WHEN** the user taps the widget row
- **THEN** a modal dialog opens containing the same 6-column 3-row table

#### Scenario: Empty jobs list shows fallback message
- **GIVEN** the API returns `{ enabled: true, totalNodes: 8, usedNodes: 0, jobs: [] }`
- **WHEN** the user hovers (desktop) or taps (mobile) the widget row
- **THEN** the overlay shows the text "No active jobs" instead of an empty table

#### Scenario: Mobile tap does NOT navigate
- **GIVEN** the user is on mobile
- **WHEN** the user taps the widget row
- **THEN** the URL pathname does not change (the click does not propagate to a `<Link>`)

#### Scenario: No write affordances
- **WHEN** the overlay is open (desktop tooltip OR mobile dialog)
- **THEN** the overlay contains no button or interactive control that mutates Slurm state

### Requirement: `squeue --me` parser handles `-O` formatted output

The runtime SHALL provide a function `runSqueueMe()` (in
`apps/web/lib/slurm/squeue.ts`) that executes
`execFile('squeue', ['--me', '--noheader', '-O', 'JobID:|,Partition:|,Name:|,StateCompact:|,TimeUsed:|,NumNodes:|,NodeList:|'], { timeout: 10000, maxBuffer: 262144 })`
and parses the stdout into an array of structured rows.

The `:|` suffix on each field tells slurm to append a literal `|`
after that field's value, producing pipe-delimited rather than
column-aligned output. This MUST be used instead of a plain
`<field>,<field>,...` format because the default per-field widths
are finite (e.g. 20 chars for `Name`): a value that exactly fills
its column fuses with the next column with no whitespace separator,
which a whitespace-split parser silently misreads as one fewer
columns. Pipe-delimited output preserves the boundary regardless of
content length.

The parser SHALL:

- Trim each line; drop blank lines.
- Split each non-empty line by `|`. Because the last field also has
  a `|` suffix, the result is 8 tokens with the last being empty;
  the parser SHALL drop that trailing empty token.
- Assert 7 columns per row. A row with fewer/more columns SHALL be
  treated as a parse failure for that row (the function returns a
  500-equivalent error to the caller).
- Map columns by index: `[0]=jobId, [1]=partition, [2]=name,
  [3]=state, [4]=time, [5]=numNodes (string → int), [6]=nodeList`.

`runSqueueMe()` SHALL return `Promise<Job[]>` on success and throw
on subprocess failure (timeout, non-zero exit, ENOENT, parse error)
so the calling route handler can translate to the 500 +
`SLURM_UNAVAILABLE` shape.

#### Scenario: Successful parse
- **GIVEN** `squeue --me ...` stdout is the three-line block
  ```
  1617918|main|shao_dll|R|3:39:55|1|fs-mbz-gpu-111|
  1608163|main|video|R|4-21:58:30|1|fs-mbz-gpu-469|
  1608151|main|sparse-r|R|4-22:35:34|1|fs-mbz-gpu-753|
  ```
- **WHEN** `runSqueueMe()` resolves
- **THEN** the result is a 3-element array with each entry's
  `numNodes === 1` and `state === 'R'`

#### Scenario: Name exactly fills slurm's default column width
- **GIVEN** the user has a job named `lk-lambda-eta10-cold` (exactly
  20 characters — the default `Name` column width), and stdout is the
  one-line block `1618473|main|lk-lambda-eta10-cold|R|6:44|1|fs-mbz-gpu-185|`
- **WHEN** `runSqueueMe()` resolves
- **THEN** the result has 1 entry with `name === 'lk-lambda-eta10-cold'`
  and `state === 'R'` (no fusion with the next column)

#### Scenario: Empty stdout returns empty array
- **GIVEN** `squeue --me ...` exits 0 with no output (user has no jobs)
- **WHEN** `runSqueueMe()` resolves
- **THEN** the result is `[]`

#### Scenario: Subprocess timeout throws
- **GIVEN** `squeue --me ...` does not exit within 10s
- **WHEN** `runSqueueMe()` is awaited
- **THEN** the promise rejects with an error whose message contains "timeout"

#### Scenario: Malformed line throws
- **GIVEN** stdout contains a line with only 3 fields
- **WHEN** `runSqueueMe()` is awaited
- **THEN** the promise rejects with a parse error

### Requirement: Central Slurm status is Host-scoped
In central mode, Slurm capability and status SHALL come from the selected Host's Backend and SHALL never execute `squeue` on the central Web Host for a remote Project. Every Slurm request/cache/widget state SHALL include Host.

#### Scenario: Selected Host executes probe
- **WHEN** the user views a Project on a Host that advertises Slurm
- **THEN** only that Host's Backend executes the existing Slurm probe and returns its status

### Requirement: Slurm widget follows Host capability and availability
The widget SHALL be disabled or show an explicit unavailable state when the selected Host is unusable or does not advertise Slurm, without affecting another Host's widget.

#### Scenario: Non-Slurm Host performs no shell-out
- **WHEN** a Backend advertises Slurm disabled
- **THEN** central offers no enabled Slurm widget and the Backend does not invoke `squeue`
