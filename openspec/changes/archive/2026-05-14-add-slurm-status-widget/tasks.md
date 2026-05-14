## 1. Core: config schema for `slurm.total_nodes`

- [x] 1.1 In `packages/core/src/schemas.ts`, add
      `SlurmConfigRawSchema = z.object({ total_nodes: z.number().int() }).optional()`
      and wire it into `ConfigRawSchema`.
- [x] 1.2 In `packages/core/src/types.ts`, add
      `interface SlurmConfig { totalNodes: number }`, extend `Config`
      with `slurm: SlurmConfig`, export
      `DEFAULT_SLURM: SlurmConfig = { totalNodes: -1 }`.
- [x] 1.3 In `packages/core/src/config/load.ts`, parse `cfg.slurm` →
      `slurm = { totalNodes: cfg.slurm?.total_nodes ?? -1 }`. After
      parse, validate: `totalNodes` MUST be `>= -1` AND `!= 0`;
      throw `ConfigError` otherwise with a message naming
      `slurm.total_nodes`.
- [x] 1.4 Re-export `SlurmConfig`, `DEFAULT_SLURM` from
      `packages/core/src/index.ts`.
- [x] 1.5 Add unit test in `packages/core/src/config/load.test.ts`:
      block absent → `-1`; positive int → that int; `0` → throws;
      `-2` → throws; non-integer → throws.

## 2. Runtime: capability probe + squeue executor

- [x] 2.1 Create `apps/web/lib/slurm/probe.ts` exporting
      `async function probeSqueue(): Promise<{ supported: boolean; reason?: string }>`.
      Run `execFile('squeue', ['--version'], { timeout: 5000 })`
      then `execFile('squeue', ['--me', '--noheader'], { timeout: 5000 })`.
- [x] 2.2 Create `apps/web/lib/slurm/squeue.ts` exporting
      `interface SlurmJob { jobId; partition; name; state; time; numNodes; nodeList }`
      and `async function runSqueueMe(): Promise<SlurmJob[]>`. Use
      `execFile('squeue', ['--me', '--noheader', '-O', 'JobID:|,Partition:|,Name:|,StateCompact:|,TimeUsed:|,NumNodes:|,NodeList:|'], { timeout: 10000, maxBuffer: 262144 })`.
      The `:|` suffix on every field forces pipe-delimited output (the
      plain `Field,Field,...` form column-pads and overflows when a
      value matches the column width — real-world breakage).
      Parse: trim lines, drop blanks, split on `|`, drop the trailing
      empty token, assert exactly 7 columns, coerce `numNodes` to int,
      throw on malformed lines.
- [x] 2.3 Unit test for parser in
      `apps/web/lib/slurm/squeue.test.ts`: feed the sample stdout
      from this host's `squeue --me`; assert 4 entries with correct
      jobIds, states, times, NumNodes, NodeList. Add cases: empty
      stdout → `[]`; line with 3 columns → throws.
- [x] 2.4 In `apps/web/lib/runtime.ts`:
      - Add `Runtime.slurm: { enabled: boolean; totalNodes: number; supported: boolean }` field.
      - In `init()`, AFTER `ensureAuthInitialised` and BEFORE warmup:
        if `config.slurm.totalNodes !== -1`, call `probeSqueue()`;
        on failure throw with message naming `squeue` and instructing
        the user to set `slurm.total_nodes: -1` in `config.yml` to
        disable. On success, set `runtime.slurm = { enabled: true,
        totalNodes: config.slurm.totalNodes, supported: true }`.
        Otherwise set `runtime.slurm = { enabled: false,
        totalNodes: -1, supported: false }`.
- [x] 2.5 Verify the existing `Runtime` constructor / class shape
      accepts the new field — adjust the constructor and the
      `experiments` / `anomaliesByProject` initializations accordingly.

## 3. API: `GET /api/slurm/status`

- [x] 3.1 Create `apps/web/app/api/slurm/status/route.ts` with a `GET`
      handler. Read `runtime = await getRuntime()`. Branch:
      - `!runtime.slurm.enabled` → return
        `NextResponse.json({ enabled: false })` (200).
      - enabled → `try { const jobs = await runSqueueMe(); const
        usedNodes = jobs.filter(j => j.state === 'R')
        .reduce((s, j) => s + j.numNodes, 0);
        return NextResponse.json({ enabled: true, totalNodes:
        runtime.slurm.totalNodes, usedNodes, jobs }) } catch (err) {
        return NextResponse.json({ enabled: true, error: { code:
        'SLURM_UNAVAILABLE', message: (err as Error).message } },
        { status: 500 }) }`.
      - Add `export const dynamic = 'force-dynamic'`.
- [x] 3.2 In `apps/web/lib/auth/route-classes.ts`, register a rule
      `methodIs(['GET'], exact('/api/slurm/status'))` → `class: 'read'`,
      `projectFor: projectGlobal()`. Place it among the existing
      explicit `read` rules. The viewer-cookie short-circuit on `read`
      with `'global'` already produces owner-only (viewer cookies
      pass `read` only when `projectFor` resolves into their scope).
- [x] 3.3 Confirm `apps/web/lib/auth/route-classes.test.ts` (if it
      exists) still passes; if not, add a small test that
      `/api/slurm/status` is classified `read` + `global` + viewer
      cookie does NOT pass.
- [x] 3.4 In `apps/web/lib/api.ts` add typed client:
      ```ts
      export type SlurmStatus =
        | { enabled: false }
        | { enabled: true; totalNodes: number; usedNodes: number; jobs: SlurmJobJson[] }
        | { enabled: true; error: { code: 'SLURM_UNAVAILABLE'; message: string } }
      export async function fetchSlurmStatus(): Promise<SlurmStatus> { ... }
      ```
      Handle the 500-with-JSON-body case (don't throw on `!response.ok`
      when the body parses to the error shape).

## 4. UI: sidebar widget component

- [x] 4.1 Create `apps/web/components/slurm-status-widget.tsx`
      (client component, `'use client'`).
- [x] 4.2 Implement the data-fetch:
      `useQuery({ queryKey: ['slurm-status'], queryFn:
      fetchSlurmStatus, refetchInterval: 30_000, staleTime: 25_000 })`.
- [x] 4.3 Render branches:
      - `data?.enabled === false` OR no data yet → return `null`.
        (SSR can't know `enabled` yet; rendering a skeleton would
        violate the disabled-state "no row" contract.)
      - Error shape (`'error' in data`) → render the row with an
        `AlertTriangle` icon + `slurm: error` label in
        `text-destructive`. Overlay (tooltip / dialog content) shows
        `data.error.message`.
      - Success shape → render row with `Server` icon (lucide) +
        static "Slurm Usage" text + a shadcn `Badge`
        (variant `secondary`, `ml-auto`, `font-mono`) at the right
        edge reading `${data.usedNodes} / ${data.totalNodes}`.
- [x] 4.4 Hover-vs-dialog branch:
      - `const isMobile = useIsMobile()`. Import from
        `@/hooks/use-mobile`.
      - Desktop: wrap row in
        `<Tooltip delayDuration={200}><TooltipTrigger asChild>{row}
        </TooltipTrigger><TooltipContent className="max-w-[min(90vw,520px)] p-3" side="right" align="end">{table}</TooltipContent></Tooltip>`.
        Make sure `<TooltipProvider>` is in scope (the app already
        wraps tooltips in providers via providers.tsx — confirm).
      - Mobile: render row as a button-style `<SidebarMenuButton>` that
        calls `setDialogOpen(true)`. Render `<Dialog open={dialogOpen}
        onOpenChange={setDialogOpen}><DialogContent>...table...
        </DialogContent></Dialog>` outside the menu hierarchy so the
        dialog doesn't inherit the menu styling.
- [x] 4.5 Build the table sub-component:
      - Columns in order: `Job`, `Name`, `State`, `Time`, `Nodes`,
        `Hosts`. Use a plain `<table>` with `<thead>`/`<tbody>`,
        Tailwind classes `text-xs/relaxed`, small column padding.
      - Empty `jobs[]` → render "No active jobs" instead.
      - Error → render the destructive-colored `error.message`
        instead of the table.
- [x] 4.6 In `apps/web/components/app-sidebar.tsx`, import the
      widget and mount it inside the existing
      `role !== 'viewer'` conditional, ABOVE the existing
      `<SidebarMenuItem>` containing Manage tmux. Wrap each in its
      own `<SidebarMenuItem>` so they stack as separate rows.

## 5. Live config + manual verification

- [x] 5.1 Add `slurm:` block to the project's `config.yml` with
      `total_nodes: 8`, AND update the commented example block at
      the top of `config.yml` (the inline doc near `terminal:`) to
      show the same example.
- [x] 5.2 Rebuild + restart prod server per CLAUDE.md "Dev: prefer
      prod build for the dashboard":
      - kill old pid on port 3737,
      - `pnpm --filter @memon/core build`,
      - `pnpm --filter @memon/web build`,
      - `cd apps/web && pnpm start > /tmp/memon-prod.log 2>&1 &`.
- [x] 5.3 Verify the API end-to-end:
      ```bash
      MEMON_USER=$(grep -E '^\s*username:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
      MEMON_PASS=$(grep -E '^\s*password:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
      curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/api/slurm/status | jq .
      ```
      Assert `enabled: true`, `totalNodes: 8`, `usedNodes` matches
      the count from a fresh terminal `squeue --me`.
- [x] 5.4 UI: per CLAUDE.md F1 "verify markup + tokens":
      ```bash
      curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/p/project-a > /tmp/page.html
      grep -E 'slurm-status-widget|<span>[0-9]+ / 8</span>|3 / 8' /tmp/page.html
      ```
      Confirm the rendered HTML contains the widget row when SSR-ed.
      Note: the row is client-rendered after the initial query — for
      a truer check, also load the page in a browser (or with a tool
      that runs the client).
- [x] 5.5 Disable-path verification: temporarily set
      `slurm.total_nodes: -1`, rebuild + restart, confirm:
      - `GET /api/slurm/status` returns `{ enabled: false }`,
      - the sidebar footer has only the Manage tmux row (no slurm
        row),
      - no `squeue` process is spawned at startup (check
        `/tmp/memon-prod.log` for absence of any `squeue` invocation
        trace OR use `strace -f -e execve` if available).
      Then revert to `total_nodes: 8`.
- [x] 5.6 Probe-failure path: temporarily rename `squeue` (or use
      `PATH= memon serve ...` if simpler) and confirm the server
      refuses to start with a clear error message naming `squeue`
      and `slurm.total_nodes: -1`. Revert.

## 6. Tests + lint

- [x] 6.1 `pnpm --filter @memon/core test` (covers task 1.5)
- [x] 6.2 `pnpm --filter @memon/web test` if/when the parser test
      runs there; otherwise `vitest` directly on the new test files.
- [x] 6.3 `pnpm --filter @memon/web typecheck`
- [x] 6.4 Skim `apps/web/middleware.test.ts` for the route-class
      coverage pattern and add a `/api/slurm/status` case if the
      pattern is "one route per test"; otherwise leave coverage to
      the integration verification in §5.

## 7. Cleanup

- [x] 7.1 Re-read proposal.md + design.md and confirm the
      implementation matches both. If any decision changed during
      apply, update those files BEFORE archive (per CLAUDE.md
      "Keep spec in sync during apply").
- [x] 7.2 Run `openspec validate add-slurm-status-widget --type change`
      (must be clean).
