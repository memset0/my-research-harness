## ADDED Requirements

### Requirement: Legacy Telegram configuration is ignored with a warning

The configuration loader SHALL continue accepting a top-level `telegram:` key
so an otherwise valid legacy `config.yml` remains usable after notification
support is removed. Whenever that key is present, regardless of the shape or
completeness of its value, the loader SHALL ignore it, SHALL omit it from the
loaded configuration model, and SHALL emit a warning to stderr asking the
operator to remove the block and its stored credentials.

The warning MUST NOT print the legacy `bot_token`, `chat_id`, or any other value
from the block. Presence of the legacy key MUST NOT cause a non-zero exit or
prevent `serve` and other configuration consumers from starting.

#### Scenario: Complete legacy block warns and loads

- **GIVEN** an otherwise valid `config.yml` contains a complete `telegram:`
  block with a bot token and chat id
- **WHEN** the configuration is loaded
- **THEN** loading succeeds and stderr warns that Telegram support was removed
  and the credentials should be deleted
- **AND** the returned configuration has no Telegram field
- **AND** stderr contains neither the bot token nor chat id

#### Scenario: Malformed legacy block remains non-blocking

- **GIVEN** an otherwise valid `config.yml` contains `telegram:` with a value
  that did not satisfy the former Telegram schema
- **WHEN** the configuration is loaded
- **THEN** loading succeeds with the same removal warning
- **AND** the legacy value is ignored rather than validated

#### Scenario: Configuration without legacy key is quiet

- **GIVEN** a valid `config.yml` has no top-level `telegram:` key
- **WHEN** the configuration is loaded
- **THEN** no Telegram-removal warning is emitted

### Requirement: Config resolution order

For all **non-`serve`** subcommands, the system SHALL resolve the project context
in this order:

1. **`--project-root <path>`** (when present, treats the path as a single
   anonymous project)
2. **Implicit cwd** — when `--project-root` is absent, `process.cwd()` is treated
   as a single anonymous project's root

There SHALL be no `<cwd>/config.yml` lookup and no `--config <path>` flag for
these subcommands. `loadCliContext` in `@memon/core` SHALL accept only
`projectRoot` and `cwd` in its input; its `source` field SHALL be one of
`'project-root' | 'implicit-cwd'`.

For `memon serve`, configuration resolution is handled within the `serve`
subcommand itself (see "memon serve" requirement above) and SHALL look at the
explicit `--config <path>`, then `<cwd>/config.yml`, then
`<repo-root>/config.yml`.

`--project-root` is mutually exclusive with `--project NAME`; combining them
SHALL exit 2 with a `BAD_REQUEST` error. `--config` is not a global flag and is
valid only on `serve`.

#### Scenario: --project-root takes precedence

- **WHEN** the user runs `memon list --project-root /a` from a directory that
  also contains a `config.yml`
- **THEN** `/a` is used as the project root and the cwd `config.yml` is NOT read

#### Scenario: Implicit cwd-as-project for `list`

- **WHEN** the user runs `memon list` with no `--project-root` from inside
  `/some/project-dir`
- **THEN** the command treats `/some/project-dir` as the single anonymous
  project's root and proceeds; no `config.yml` lookup happens

#### Scenario: `serve` without any config

- **WHEN** the user runs `memon serve` without `--config` and no `config.yml` in
  cwd or repo root
- **THEN** the command exits with a structured error explaining how to create
  `config.yml`

## REMOVED Requirements

### Requirement: Legacy config resolution order

**Reason**: The previous requirement included a notification-specific config
lookup exception and three credential-resolution scenarios for the removed
`memon notify` command. Replacing the requirement is necessary to delete those
obsolete scenarios without weakening the remaining CLI resolution contract.

**Migration**: Non-`serve` commands use `--project-root` or implicit cwd and do
not read `config.yml`; `--config` remains a `serve`-only option. Legacy
`telegram:` blocks are handled only by the separate non-blocking compatibility
warning requirement.

### Requirement: `memon notify` subcommand family

**Reason**: Telegram is no longer a supported notification channel, and no
replacement transport is introduced by this change.

**Migration**: Remove `memon notify` invocations and use the active agent
conversation for completion/error/question handoffs. After upgrade, `notify` is
an unknown top-level command.

## RENAMED Requirements

- FROM: `### Requirement: Config resolution order`
- TO: `### Requirement: Legacy config resolution order`
