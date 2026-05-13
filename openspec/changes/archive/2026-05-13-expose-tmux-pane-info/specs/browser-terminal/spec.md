## MODIFIED Requirements

### Requirement: terminal config block in config.yml

`packages/core/src/schemas.ts` SHALL add an optional `terminal:` config section accepting fields:
- `ttyd_max_concurrent` (positive integer; default `16` when absent or block absent).
- `ttyd_idle_ttl_minutes` (non-negative integer; default `30`; `0` disables the idle-TTL killer).
- `pane_info_active_poll_ms` (positive integer; default `5000`). The recommended client-side polling interval for tmux pane info when the named session has a live ttyd entry (`liveEntry !== null`). Consumed by `/manage/tmux` and the future per-target `OpenWithButton` indicator.
- `pane_info_idle_poll_ms` (positive integer; default `60000`). The recommended client-side polling interval when the named session has NO live ttyd entry (no ttyd bound, or the tmux session itself does not yet exist on the host). Must be `>= pane_info_active_poll_ms`.

`packages/core/src/config/load.ts` SHALL apply the defaults when the field or block is absent. The resolved config SHALL surface these to the runtime as `runtime.config.terminal: { ttydMaxConcurrent: number, ttydIdleTtlMinutes: number, paneInfoActivePollMs: number, paneInfoIdlePollMs: number }`.

`load.ts` SHALL also validate `paneInfoIdlePollMs >= paneInfoActivePollMs` and throw `ConfigError` otherwise — the tier ordering is load-bearing for the future per-button surface.

The committed `config.example.yml` SHALL include a commented-out example of the `terminal:` block listing every field with its default value, so users can copy-uncomment-edit without consulting the source.

#### Scenario: Block absent uses defaults

- **GIVEN** `config.yml` has no `terminal:` block
- **THEN** `runtime.config.terminal` is `{ ttydMaxConcurrent: 16, ttydIdleTtlMinutes: 30, paneInfoActivePollMs: 5000, paneInfoIdlePollMs: 60000 }`

#### Scenario: Partial config fills in defaults

- **GIVEN** `config.yml` has `terminal: { ttyd_max_concurrent: 8 }` only
- **THEN** `runtime.config.terminal` is `{ ttydMaxConcurrent: 8, ttydIdleTtlMinutes: 30, paneInfoActivePollMs: 5000, paneInfoIdlePollMs: 60000 }`

#### Scenario: Pane-info polling values override defaults

- **GIVEN** `config.yml` has `terminal: { pane_info_active_poll_ms: 3000, pane_info_idle_poll_ms: 120000 }`
- **THEN** `runtime.config.terminal.paneInfoActivePollMs` is `3000` and `runtime.config.terminal.paneInfoIdlePollMs` is `120000`

#### Scenario: Negative max_concurrent rejected

- **GIVEN** `config.yml` has `terminal: { ttyd_max_concurrent: -1 }`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError`

#### Scenario: Zero or negative pane_info_active_poll_ms rejected

- **GIVEN** `config.yml` has `terminal: { pane_info_active_poll_ms: 0 }`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError`

#### Scenario: pane_info_idle_poll_ms below active rejected

- **GIVEN** `config.yml` has `terminal: { pane_info_active_poll_ms: 5000, pane_info_idle_poll_ms: 2000 }`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError` with a message indicating that idle must be >= active
