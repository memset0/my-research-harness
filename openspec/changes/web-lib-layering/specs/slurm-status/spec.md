## MODIFIED Requirements

### Requirement: Startup capability probe for `squeue --me`

The web server runtime (`apps/web/lib/server/runtime.ts` `init()`) SHALL probe `squeue` capability once during initialization when `Config.slurm.totalNodes !== -1`, AFTER config + auth init and BEFORE warmup.

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


### Requirement: `squeue --me` parser handles `-O` formatted output

The runtime SHALL provide a function `runSqueueMe()` (in
`apps/web/lib/server/slurm/squeue.ts`) that executes
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

