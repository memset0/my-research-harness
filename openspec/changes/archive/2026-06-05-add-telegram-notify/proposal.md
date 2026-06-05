## Why

Long-running experiments on shared clusters mean the user is often away from
the terminal for hours while a local `claude` / `codex` agent works. When
that agent hits an unrecoverable error, gets stuck reproducing a bug, needs
a judgment call from the user, or finally finishes a multi-hour task,
there's no out-of-band signal — the user has to keep coming back to the
terminal to check. A push notification to Telegram closes that loop: the
agent emits a single `memon notify` invocation, the user gets a phone
notification, and round-trip latency drops from hours to seconds.

The integration is implemented in `memon` (not as a separate daemon)
because the agent already calls `memon` for every other side-effect on
the experiment tree (warnings, status sets, README writes). Reusing the
same CLI surface keeps the agent's contract minimal: one stable binary,
one stable invocation format.

## What Changes

- New top-level CLI command **`memon notify <severity> "<title>"`** with
  five severities — `info`, `warn`, `error`, `question`, `done` — that
  sends a formatted message to a Telegram chat via the Bot API.
  - Required positional `<title>` (one-line headline).
  - Optional `--details <text>` for a longer markdown body.
  - Optional `--details-file <path>` to load the body from a file
    or from stdin (`--details-file -`). Mutually exclusive with
    `--details`; mirrors the existing `memon experiment readme
    write` stdin convention. Makes it easy for the agent to pipe a
    multi-line markdown blob (stack traces, tracebacks, formatted
    KV blocks) without shell-escaping every backtick / quote /
    dollar / newline.
  - Optional repeatable `--context <key>=<value>` (e.g. `project=sparse-fsdp`,
    `run=tp4-260520-082300`); rendered as a small KV block in the message.
  - Optional `--link <url>` (rendered as a tap-target in the message).
  - Optional **`--agent <kind>`** where kind is one of
    `claude` / `codex` / `opencode` / `unknown` (any other string is
    accepted as opaque label). When omitted, the CLI auto-detects:
    `CLAUDECODE` env truthy → `claude`, else `unknown`. (Codex /
    opencode skills pass `--agent` explicitly.)
  - Optional **`--session <name>`** — the agent's session / conversation
    name. No auto-detect (Claude Code's `/rename` value, Codex's session
    label, etc. live in per-tool state the CLI can't reliably reach);
    the skill knows where its own session name lives and SHALL pass it.
  - Optional `--soft`: on send failure (network down, Telegram 4xx/5xx,
    config missing) print the structured error to stderr but exit `0`,
    so transient telegram outages never break the calling agent.
  - Optional `--quiet` → sets Telegram `disable_notification: true` so
    the message arrives silently (useful for `info` / `done` digests).
- **Auto-collected context** rendered as a footer on every outgoing
  message, on top of the user's `--context` pairs:
  - `host` — `os.hostname()`, always present.
  - `agent` — resolved from `--agent` / env-detect, always present
    (falls back to `unknown`).
  - `session` — from `--session`, shown only when provided.
  - `cwd` — `process.cwd()` with `$HOME` collapsed to `~`, always
    present.
  - `branch` — current git branch + short HEAD sha (`main@c19e413`),
    best-effort: shown when the cwd is inside a git work-tree,
    silently omitted otherwise. Detection uses a 1-second-timeout
    `git rev-parse` subprocess (no `git rev-parse` in PATH = silent
    skip).
  - `ts` — ISO8601 timestamp with timezone offset at send time,
    always present.
- New self-test subcommand **`memon notify test`** that sends a fixed
  ping message; exits `0` on a successful round-trip, structured error
  otherwise.
- New **optional `telegram:` block in `config.yml`** with `bot_token`,
  `chat_id`, optional `parse_mode` (default `MarkdownV2`), optional
  `disable_notification` (default `false`).
- New env-var overrides **`MEMON_TELEGRAM_BOT_TOKEN`** and
  **`MEMON_TELEGRAM_CHAT_ID`** that, when both set, take priority over
  the `config.yml` block (useful for per-shell overrides and CI tests).
- `memon notify` is the **second non-`serve` CLI subcommand to read
  `config.yml`** (the rest of the CLI surface intentionally does not):
  it accepts an explicit `--config <path>` flag and otherwise falls back
  to cwd `./config.yml`. When neither config.yml nor both env vars are
  available, the command exits `BAD_REQUEST` with a hint.
- `memon-cli` spec is updated to add `notify` to the canonical
  subcommand list and to document the new exception to the "non-`serve`
  commands never read `config.yml`" rule.

Out of scope for this change (deferred to follow-ups):

- Agent skill prompts that teach `claude` / `codex` **when** to call
  `memon notify`. Per [[feedback_split_runtime_then_skills]], the
  runtime lands first, the user verifies, then the agent-side guidance
  ships in a separate change.
- Additional backends (Slack, Discord, generic webhook). YAGNI — when a
  second backend appears we'll abstract; until then `telegram-notify`
  is a single-backend capability.
- Two-way interaction (replying to a Telegram message to drive the
  agent). Out of scope; this change is one-way push only.

## Capabilities

### New Capabilities

- `telegram-notify`: CLI command shape, severity vocabulary, Telegram
  Bot API call, MarkdownV2 escape policy, message length cap, config
  schema (`telegram:` block + env-var override), error envelopes,
  `--soft` and `--quiet` semantics, and the `notify test` self-check.

### Modified Capabilities

- `memon-cli`: add `notify` to the canonical subcommand list in the
  "Single binary `memon` with subcommands" requirement, and add a new
  requirement documenting that `notify` is an exception to the "non-
  `serve` commands do not read `config.yml`" rule.

## Impact

- New code:
  - `packages/cli/src/commands/notify.ts` — command handlers
    (`notify send` / `notify test`), Telegram POST, MarkdownV2 escape,
    message assembly.
  - `packages/cli/src/commands/notify.test.ts` — unit tests with a
    mocked `fetch`.
  - `packages/core/src/notify/telegram.ts` — small pure helper for
    rendering the message body (importable from tests).
- Modified code:
  - `packages/cli/src/index.ts` — register `notify <severity>` and
    `notify test` subcommands.
  - `packages/core/src/types.ts` — add `TelegramConfig` to `Config`.
  - `packages/core/src/config/load.ts` — parse the optional
    `telegram:` block.
- Config template:
  - `config.yml` (committed reference copy) — documented commented-out
    `telegram:` example so users discover the feature.
- No web app / SSE / server-side route changes.
- No new runtime dependencies — Telegram is reached via Node's built-in
  `fetch` (Node 20+).
- No FS-convention bump; no migration needed.
