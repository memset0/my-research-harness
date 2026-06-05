## ADDED Requirements

### Requirement: `memon notify` subcommand family

The CLI SHALL gain a new top-level subcommand `memon notify` with two
children:

- `memon notify <severity> "<title>" [--details D | --details-file P]
  [--context K=V]... [--link URL] [--agent KIND] [--session NAME]
  [--soft] [--quiet] [--format human|json] [--config <path>]`
- `memon notify test [--format human|json] [--config <path>]`

`--details-file <path>` accepts `-` to mean stdin (consistent with the
existing `memon experiment readme write` stdin convention). `--details`
and `--details-file` are mutually exclusive.

Severity SHALL be one of the five lowercase tokens `info`, `warn`,
`error`, `question`, `done`. Full behavior is specified in the
`telegram-notify` capability spec. This requirement establishes the
CLI surface shape:

- The subcommands SHALL be registered in
  `packages/cli/src/commands/notify.ts` and exposed from the main
  `memon` binary via the standard subcommand dispatch in
  `packages/cli/src/index.ts`.
- Default output format SHALL be `json`; `--format human` switches to
  a one-line status (`sent → @<chat-id> (#<message_id>)` on success).
- Exit codes follow the existing dictionary: `0` success, `1` runtime
  error (network / Telegram 4xx-5xx), `2` usage error (unknown
  severity, missing title, missing config).
- The subcommands SHALL resolve Telegram credentials independently of
  the standard `--project-root` / cwd-as-project resolver — `memon
  notify` does NOT take `--project-root`. Credential resolution is
  fully specified by the `telegram-notify` capability.
- The `--soft` flag suppresses non-zero exit on send failure (the
  structured error is still printed to stderr, but exit is `0`). This
  is the agent-friendly mode: a transient Telegram outage MUST NOT
  block the calling agent. `notify test` does NOT honor `--soft`.
- The bot token SHALL NEVER appear on stdout or stderr (including on
  401 from Telegram, where the error envelope SHALL read `401
  Unauthorized: token rejected`).

#### Scenario: `memon notify error` JSON output on success

- **GIVEN** valid Telegram credentials are available via `config.yml`
- **WHEN** the user runs `memon notify error "training crashed"
  --details "step 1500 timeout" --context project=sparse-fsdp
  --agent claude --session telegram-notify`
- **THEN** stdout is JSON `{"sent": true, "severity": "error", "title":
  "training crashed", "agent": "claude", "session":
  "telegram-notify", "telegram_chat_id": "<id>",
  "telegram_message_id": <int>}`; exit code `0`

#### Scenario: Unknown severity is a usage error

- **WHEN** the user runs `memon notify oops "msg"`
- **THEN** the CLI exits with code `2` and stderr names the five
  valid severities; no network request is made

#### Scenario: `memon notify --soft` exits zero on telegram failure

- **GIVEN** the Telegram API returns `500 Internal Server Error`
- **WHEN** the user runs `memon notify error "x" --soft`
- **THEN** stderr contains the structured error envelope but exit is
  `0`

#### Scenario: `memon notify test` self-check

- **WHEN** the user runs `memon notify test` with valid credentials
- **THEN** a canary message arrives in the configured chat, stdout
  is JSON `{"sent": true, ...}`, exit `0`

#### Scenario: `memon notify` does NOT take `--project-root`

- **WHEN** the user runs `memon notify info "x" --project-root /tmp`
- **THEN** the command parser rejects the unknown option with a
  non-zero exit (commander's standard "unknown option" error); the
  same happens for `--project <name>`

## MODIFIED Requirements

### Requirement: Config resolution order

For all **non-`serve`, non-`notify`** subcommands, the system SHALL
resolve the project context in this order:
1. **`--project-root <path>`** (when present, treats the path as a
   single anonymous project)
2. **Implicit cwd** — when `--project-root` is absent,
   `process.cwd()` is treated as a single anonymous project's root

There SHALL be no `<cwd>/config.yml` lookup and no `--config <path>`
flag for these subcommands. `loadCliContext` in `@memon/core` SHALL
accept only `projectRoot` and `cwd` in its input; its `source` field
SHALL be one of `'project-root' | 'implicit-cwd'`.

For `memon serve`, configuration resolution is handled within the
`serve` subcommand itself (see "memon serve" requirement above) and
SHALL look at the explicit `--config <path>`, then `<cwd>/config.yml`,
then `<repo-root>/config.yml`.

For `memon notify <severity>` and `memon notify test`, credentials
SHALL resolve in this precedence (highest → lowest):
1. **Env vars** — both `MEMON_TELEGRAM_BOT_TOKEN` and
   `MEMON_TELEGRAM_CHAT_ID` set and non-empty.
2. **`config.yml` `telegram:` block** — at the path specified by
   `--config <path>` (when given), else at `<cwd>/config.yml`.
3. **Neither** — exit `BAD_REQUEST` (code 2) with a hint naming both
   sources.

`notify` is the only non-`serve` subcommand that reads `config.yml`,
and it does so only to read the `telegram:` block (it does NOT read
`projects`, `auth`, `poll`, `terminal`, `slurm`, or `gitStatus`).

`--project-root` is mutually exclusive with `--project NAME`;
combining them SHALL exit 2 with a `BAD_REQUEST` error. (`--config` is
not a global flag — it is a per-subcommand option valid only on
`serve` and `notify`.) `memon notify` SHALL reject `--project-root` /
`--project` outright (it has no notion of a project context).

#### Scenario: --project-root takes precedence

- **WHEN** the user runs `memon list --project-root /a` from a
  directory that also contains a `config.yml`
- **THEN** `/a` is used as the project root and the cwd `config.yml`
  is NOT read (the CLI does not look at it)

#### Scenario: Implicit cwd-as-project for `list`

- **WHEN** the user runs `memon list` with no `--project-root` from
  inside `/some/project-dir`
- **THEN** the command treats `/some/project-dir` as the single
  anonymous project's root and proceeds; no `config.yml` lookup
  happens

#### Scenario: `serve` without any config

- **WHEN** the user runs `memon serve` without `--config` and no
  `config.yml` in cwd or repo root
- **THEN** the command exits with a structured error explaining how
  to create `config.yml`. (Note: `memon serve` does NOT support
  `--project-root` since the web stack requires the full config
  schema for multi-project setups.)

#### Scenario: `notify` env vars win over config.yml

- **GIVEN** `<cwd>/config.yml` declares
  `telegram.chat_id: "-100A"` and the env vars are set with
  `MEMON_TELEGRAM_CHAT_ID="-100B"`
- **WHEN** the user runs `memon notify info "..."` from `<cwd>`
- **THEN** the outgoing request targets chat `-100B`

#### Scenario: `notify` falls back to config.yml when env vars absent

- **GIVEN** no env vars are set and `<cwd>/config.yml` declares a
  full `telegram:` block
- **WHEN** the user runs `memon notify info "..."` from `<cwd>`
- **THEN** the credentials are read from `<cwd>/config.yml` and the
  request succeeds

#### Scenario: `notify` exits `BAD_REQUEST` when no credentials anywhere

- **GIVEN** no env vars AND no `telegram:` block in any reachable
  `config.yml`
- **WHEN** the user runs `memon notify info "..."`
- **THEN** stderr `BAD_REQUEST` envelope names both
  `MEMON_TELEGRAM_BOT_TOKEN`+`MEMON_TELEGRAM_CHAT_ID` and the
  `telegram:` block; exit `2`
