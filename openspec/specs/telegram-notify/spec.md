# telegram-notify Specification

## Purpose
TBD - created by archiving change add-telegram-notify. Update Purpose after archive.
## Requirements
### Requirement: `memon notify <severity>` sends a push to Telegram

The system SHALL expose a CLI subcommand `memon notify <severity>
"<title>"` that POSTs a formatted message to the Telegram Bot API
endpoint `https://api.telegram.org/bot<token>/sendMessage`.

The `<severity>` positional argument SHALL be one of exactly five
literal lowercase tokens: `info`, `warn`, `error`, `question`, `done`.
Any other value SHALL exit with `BAD_REQUEST` and a message naming the
five valid tokens. Each severity SHALL render as a single emoji
prefix directly in front of the bolded title (e.g. `🔥 *crashed*`,
`❓ *which lr should I use*`, `✅ *finetune done*`) so the user can
scan severity at a glance on the Telegram notification preview.

The `<title>` positional argument SHALL be required, non-empty, and
length-capped at 200 characters (input beyond 200 chars exits
`BAD_REQUEST`).

The command SHALL accept the following optional flags:

- `--details <text>`: a longer markdown body rendered under the title.
- `--details-file <path>`: read the body from a file. The literal value
  `-` means "read from stdin until EOF". Mutually exclusive with
  `--details`; passing both SHALL exit `BAD_REQUEST`. Reading a file
  that does not exist SHALL exit `NOT_FOUND`. When stdin is empty
  (zero bytes), the field SHALL be treated as absent (not as the
  empty string).
- `--context <key>=<value>`: repeatable; rendered as a small KV block.
  At most 10 entries — beyond that, exit `BAD_REQUEST`. Reserved
  context keys that collide with auto-context — `host`, `agent`,
  `session`, `cwd`, `branch`, `ts` — SHALL be rejected with
  `BAD_REQUEST` (the user must rename their key to avoid confusion
  with the auto-footer).
- `--link <url>`: rendered as a tap-target line; MUST be `https://`.
- `--agent <kind>`: the calling agent's kind. Accepts `claude`,
  `codex`, `opencode`, `unknown`, OR any other ASCII identifier
  matching `^[a-z][a-z0-9-]{0,31}$` (free-form, but bounded so it
  doesn't dominate the footer).
- `--session <name>`: the agent's session / conversation name (e.g.
  the value passed to Claude Code's `/rename`). Free-form, escaped
  for the target parse mode, length-capped at 80 chars.
- `--soft`: on any send-side failure (network error, Telegram 4xx /
  5xx, config missing), print the structured error to stderr but exit
  `0` so the calling agent is not blocked.
- `--quiet`: include `disable_notification: true` in the Telegram API
  payload so the message arrives without a sound / vibration.

On success, stdout SHALL contain JSON of shape
`{"sent": true, "severity": <s>, "title": <t>, "agent": <a>,
"session": <s>|null, "telegram_chat_id": <id>, "telegram_message_id":
<n>}` (default format) or a one-line human summary (`--format human`).
The `session` field SHALL be `null` when not provided / detected.
Exit code `0`.

On failure without `--soft`, stderr SHALL contain a structured error
envelope (`{"error": {"code": <c>, "message": <m>}}`) and the process
SHALL exit with the code from the existing CLI exit-code dictionary
(`BAD_REQUEST` → 2, `GENERIC` → 1).

#### Scenario: Happy-path send

- **GIVEN** `config.yml` contains a valid `telegram:` block with
  `bot_token` and `chat_id`
- **WHEN** the user runs `memon notify error "Training crashed at step
  1500" --details "FSDP all-reduce timeout in rank 3" --context
  project=sparse-fsdp --context run=tp4-260520-082300 --agent claude
  --session telegram-notify`
- **THEN** the CLI POSTs a single `sendMessage` request to the
  configured chat, exits `0`, and stdout contains JSON with
  `sent: true`, `agent: "claude"`, `session: "telegram-notify"`, and
  the Telegram-returned `message_id`

#### Scenario: Details from stdin

- **GIVEN** `cat traceback.md | memon notify error "crashed"
  --details-file -` is invoked
- **WHEN** stdin contains a multi-line markdown body (e.g. a Python
  traceback with backticks and `*` characters)
- **THEN** the body is read into `details`, escaped for the
  configured `parse_mode`, and renders under the title; exit `0`

#### Scenario: Details from a file path

- **WHEN** the user runs `memon notify info "ping" --details-file
  /tmp/note.md`
- **THEN** the file is read as UTF-8 and used as `details`; if the
  file does not exist the command exits `NOT_FOUND` (4) without a
  network call

#### Scenario: --details and --details-file are mutually exclusive

- **WHEN** the user runs `memon notify info "ping" --details "x"
  --details-file -`
- **THEN** the command exits `BAD_REQUEST` (2) before reading stdin;
  no network call is made

#### Scenario: Reserved context keys are rejected

- **WHEN** the user runs `memon notify info "ping" --context host=foo`
- **THEN** the command exits `BAD_REQUEST` naming the reserved key
  set `{host, agent, session, cwd, branch, ts}`; no network call

#### Scenario: Unknown severity is rejected

- **WHEN** the user runs `memon notify oops "something"`
- **THEN** stderr contains a `BAD_REQUEST` envelope naming the five
  valid severities, and the process exits `2`; no network request is
  issued

#### Scenario: Title length cap

- **WHEN** the user passes a title longer than 200 characters
- **THEN** stderr contains a `BAD_REQUEST` envelope, exit `2`; no
  network request

#### Scenario: --soft swallows network failure

- **GIVEN** the Telegram API is unreachable (e.g. DNS failure)
- **WHEN** the user runs `memon notify error "X" --soft`
- **THEN** stderr contains the structured error envelope, but the
  process exits `0`

#### Scenario: --quiet sets disable_notification

- **WHEN** the user runs `memon notify done "100k step finetune done"
  --quiet`
- **THEN** the outgoing Telegram payload contains
  `disable_notification: true`

### Requirement: `memon notify test` is a self-test

The system SHALL expose a `memon notify test` subcommand that sends a
fixed canary message — header `ℹ️ *memon notify self\-test*` followed
by the standard auto-context footer block (host / agent / cwd / branch
/ ts, plus session when `--session` is supplied) — to the configured
chat using the same config-resolution path as `memon notify
<severity>`. On success it SHALL exit `0` with `{"sent": true, ...}`
on stdout. On failure it SHALL exit with the same structured-error
envelope as the main command (it does NOT honor `--soft`; `notify
test` is the verification command, so a failure must surface).

#### Scenario: Self-test on a working config

- **GIVEN** valid Telegram credentials are available
- **WHEN** the user runs `memon notify test`
- **THEN** a canary message reaches the configured chat and the
  process exits `0`

#### Scenario: Self-test surfaces config-missing

- **GIVEN** neither `config.yml` `telegram:` block nor the two env
  vars are set
- **WHEN** the user runs `memon notify test`
- **THEN** stderr contains a `BAD_REQUEST` envelope naming both
  config-source options, exit `2`

### Requirement: Telegram credentials resolution order

The system SHALL resolve Telegram credentials in this precedence
(highest → lowest):

1. **Both env vars present**: `MEMON_TELEGRAM_BOT_TOKEN` AND
   `MEMON_TELEGRAM_CHAT_ID` must BOTH be set and non-empty; otherwise
   this layer is treated as absent.
2. **`config.yml` `telegram:` block** at the path specified by
   `--config <path>` (when given), else at `<cwd>/config.yml`.
3. **Neither available**: exit `BAD_REQUEST` with a hint message that
   names both env-var names AND the `config.yml` block.

If layer 1 partially matches (only one of the two env vars set) the
resolver SHALL emit a single warning line on stderr (`memon: only one
of MEMON_TELEGRAM_BOT_TOKEN / MEMON_TELEGRAM_CHAT_ID is set; falling
back to config.yml`) and proceed to layer 2.

The `telegram:` block in `config.yml` SHALL have shape:

```yaml
telegram:
  bot_token: "<string>"          # required when block is present
  chat_id: "<string>"            # required when block is present; numeric chat IDs may be quoted or unquoted
  parse_mode: "MarkdownV2"       # optional; default "MarkdownV2"; valid: MarkdownV2 | HTML | Markdown
  disable_notification: false    # optional; default false
```

When the block is present but `bot_token` or `chat_id` is missing or
empty, config-load SHALL fail with a structured error naming the
missing field (consistent with existing config-load failures).

The credentials, once resolved, SHALL never be logged to stdout or
stderr. Error envelopes SHALL never echo the bot token (even on 401
from Telegram — log only `401 Unauthorized: token rejected`).

#### Scenario: Env vars take precedence over config.yml

- **GIVEN** `config.yml` has `telegram.chat_id = "-100A"` and the env
  vars are set with `MEMON_TELEGRAM_CHAT_ID="-100B"`
- **WHEN** the user runs `memon notify info "..."`
- **THEN** the request goes to chat `-100B`

#### Scenario: Partial env vars warn and fall back

- **GIVEN** only `MEMON_TELEGRAM_BOT_TOKEN` is set and `config.yml`
  has a complete `telegram:` block
- **WHEN** the user runs `memon notify info "..."`
- **THEN** stderr contains the one-line "only one of ..." warning, and
  the request uses `config.yml`'s `bot_token` and `chat_id`

#### Scenario: Missing both surfaces a hint

- **GIVEN** no env vars and no `telegram:` block in `config.yml`
- **WHEN** the user runs `memon notify info "..."`
- **THEN** stderr `BAD_REQUEST` envelope names BOTH
  `MEMON_TELEGRAM_BOT_TOKEN`+`MEMON_TELEGRAM_CHAT_ID` and the
  `config.yml` block; exit `2`

#### Scenario: Bot token is never logged

- **GIVEN** Telegram returns `401 Unauthorized`
- **WHEN** the user runs `memon notify info "..."`
- **THEN** stderr's error envelope says `401 Unauthorized: token
  rejected` and does NOT contain the bot token substring anywhere

### Requirement: Message assembly + MarkdownV2 escape

The system SHALL render the outgoing Telegram message body as:

```
<emoji> *<escaped-title>*

<escaped-details, optional>

<user-KV-block, optional>

[<escaped-link-label or url>](<link>)   ← optional

- <host-emoji> <escaped-host>
- <agent-emoji> <escaped-agent>
- <session-emoji> <escaped-session>   ← only when --session provided
- <cwd-emoji> <escaped-cwd>
- <branch-emoji> <escaped-branch>     ← only when in a git work-tree
- <ts-emoji> <escaped-ts>
```

The header line is the severity emoji followed by a space and the
**bolded** escaped title. There SHALL NOT be a separate uppercase tag
line (e.g. `ERROR`, `INFO`) — the emoji alone fronts the title. The
severity `tag` field stays in `SEVERITY_META` (so skills can branch on
it programmatically) but is NOT rendered.

User-supplied text in `title`, `context` keys/values, and `link` label
SHALL be passed through a MarkdownV2 escape function that
backslash-escapes EVERY character in the Telegram-documented
reserved set: `_ * [ ] ( ) ~ \` > # + - = | { } . !`.

`details` is markdown content (it may contain ` ``` `-fenced code
blocks or `` ` ``-inline code) and SHALL be escaped with a
**code-aware** variant of MarkdownV2 escape:
- Outside code regions: full reserved-set escape (same as title).
- Inside ` ``` `-delimited pre-blocks and `` ` ``-delimited inline
  code: ONLY `\` and `` ` `` are escaped, per Telegram's
  pre-block / code-block entity rules.

This is critical: applying the full-reserved-set escape inside a code
block backslash-escapes the opening / closing backticks, which breaks
Telegram's code-block parser and the snippet renders as literal
backslashed-backticks instead of monospace code.

The auto-appended footer fields SHALL also be escaped (the hostname
or path could contain `.` or `-`). Each footer line begins with the
escaped literal `-` (i.e. `\-` in MarkdownV2 output, `- ` after
Telegram renders), then the field's documented emoji, then the
field's escaped value.

When `parse_mode` is `HTML`, escape rules SHALL switch to the HTML set
(`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`) instead of MarkdownV2. The
footer bullets in HTML mode render with a literal `-` (no backslash
escape) since `-` is not reserved in HTML.

If the rendered body exceeds 4096 UTF-16 code units (Telegram's
documented limit), the system SHALL truncate the `details` field
(NOT the title) and append `…(truncated)` (a single ellipsis +
parenthesized note) to the truncated detail, keeping the rest of the
structure intact. If even an empty-details message would exceed the
limit (extreme title or context spam), the system SHALL emit the
over-cap body and let Telegram surface the 400 (with `--soft` the
error envelope is the only side effect).

#### Scenario: Header is emoji + bold title, no tag line

- **GIVEN** the user passes `--title "Hello. World!"` with severity `info`
- **THEN** the outgoing payload's `text` field starts with
  `ℹ️ *Hello\. World\!*` on a single line (no separate `INFO` line
  follows); `parse_mode` is `MarkdownV2`

#### Scenario: Code-aware details escape preserves fences

- **GIVEN** `--details-file -` receives the literal three-line body
  `` ```python\nfoo.bar()\n``` ``
- **THEN** the outgoing payload's `text` contains
  `` ```python\nfoo.bar()\n``` `` verbatim (no backslash before the
  opening or closing fences, no escape of `.` or `(` inside the
  code body). Telegram renders this as a Python code block.

#### Scenario: Reserved characters in title are escaped

- **GIVEN** the user passes `--title "Hello. World!"`
- **THEN** the outgoing payload's `text` field contains
  `*Hello\. World\!*` (the literal dot and bang are backslash-escaped)
  and the `parse_mode` is `MarkdownV2`

#### Scenario: Long body is truncated, not rejected

- **GIVEN** `--details` is 5000 characters long
- **WHEN** the user runs `memon notify info "Title" --details <long>`
- **THEN** the outgoing payload's `text` field is ≤4096 UTF-16 code
  units and ends with `…(truncated)`; the title, KV block, and footer
  bullets are preserved

#### Scenario: parse_mode HTML switches escape set

- **GIVEN** `config.yml` has `telegram.parse_mode: "HTML"`
- **AND** the user passes `--title "1 < 2 & true"`
- **THEN** the outgoing payload's `text` field contains
  `<b>1 &lt; 2 &amp; true</b>` and `parse_mode` is `HTML`

### Requirement: Severity → emoji + tag mapping (stable)

The severity-to-emoji mapping SHALL be:

| Severity   | Emoji | Tag (not rendered) |
|------------|-------|--------------------|
| `info`     | ℹ️    | `INFO`             |
| `warn`     | ⚠️    | `WARN`             |
| `error`    | 🔥    | `ERROR`            |
| `question` | ❓    | `QUESTION`         |
| `done`     | ✅    | `DONE`             |

The mapping SHALL be a single `const` (`SEVERITY_META`) in the source
so it cannot drift between the validator (severity check) and the
renderer (header prefix). Only the emoji is rendered in the message
header; the uppercase tag is preserved on the API surface (importable
by skills / logs) but does NOT appear in the outgoing Telegram body.
The mapping is part of the CLI's stable contract — agent skills key
off these emojis to construct messages, so adding, removing, or
renaming an entry is a breaking change that requires a new openspec
proposal.

#### Scenario: All five severities round-trip

- **WHEN** the user runs `memon notify <s> "ping"` for each of the
  five severities
- **THEN** each outgoing payload's first line is `<emoji> *ping*`
  (emoji + bold escaped title); no uppercase tag substring appears;
  the CLI exits `0`

### Requirement: Auto-appended context footer

Every outgoing notification SHALL end with a structured footer block,
rendered as a dash-bullet list. Each field is on its own line in
`- <emoji> <value>` form, escaped for the configured `parse_mode`
(the `-` becomes `\-` in MarkdownV2). The fields, their emoji, and
their inclusion rules:

| Field    | Emoji | Always present | Source                                                                                              |
|----------|-------|----------------|-----------------------------------------------------------------------------------------------------|
| `host`   | 🖥    | yes            | `os.hostname()`                                                                                     |
| `agent`  | 🤖    | yes            | `--agent <kind>`; if absent, env-detect (`CLAUDECODE` → `claude`, else `unknown`)                   |
| `session`| 💬    | only if known  | `--session <name>`; never auto-detected by the runtime                                              |
| `cwd`    | 📁    | yes            | `process.cwd()`, with `$HOME` replaced by `~`                                                       |
| `branch` | 🌿    | best-effort    | `git rev-parse --abbrev-ref HEAD` + `git rev-parse --short HEAD`, formatted `<branch>@<short-sha>`  |
| `ts`     | 🕐    | yes            | ISO8601 with timezone offset captured at send time (`new Date().toISOString()` adjusted to local TZ)|

The emoji-to-field mapping SHALL be a single `const` (`FOOTER_EMOJI`)
in the source. Agent skills MAY scan outgoing messages for these
emojis to extract structured context; renaming or replacing an entry
is a breaking change.

The `branch` field is best-effort: detection runs with a 1-second
subprocess timeout and silently omits the line when (a) the cwd is
not inside a git work-tree, (b) `git` is not on `PATH`, or (c) the
subprocess times out. Detection MUST NOT raise; failures are
swallowed.

The `agent` field, when env-detect falls through to `unknown`, SHALL
be rendered exactly as the literal string `unknown` — never as the
empty string, never as `null`. This guarantees the field is always a
parseable identifier.

This footer SHALL be present even when no `--context` flags are
supplied, so the user can identify which machine, which agent kind,
which session, which dir, which commit, and which moment fired the
notification when multiple agents are running concurrently across
multiple panes / hosts.

#### Scenario: Minimal invocation footer

- **WHEN** the user runs `memon notify info "ping"` from
  `/home/alice/work/proj` inside a git repo on branch `main` at
  `c19e413`, with `CLAUDECODE=1` set in the env
- **THEN** the outgoing payload's `text` ends with a multi-line
  footer block containing the lines `\- 🖥 <hostname>`,
  `\- 🤖 claude`, `\- 📁 \~/work/proj`,
  `\- 🌿 main@c19e413`, `\- 🕐 <iso8601-with-tz>` (each escaped
  for the parse mode); no 💬 line is present

#### Scenario: Session line appears when provided

- **WHEN** the user runs `memon notify info "ping" --session
  telegram-notify`
- **THEN** the footer contains a `\- 💬 telegram\-notify` line
  between the 🤖 line and the 📁 line

#### Scenario: Branch line silently omitted outside a git repo

- **WHEN** the user runs `memon notify info "ping"` from `/tmp/scratch`
  which is not inside a git work-tree
- **THEN** the footer omits the 🌿 line; the rest of the footer is
  unchanged; no error is raised

#### Scenario: Branch detection timeout is swallowed

- **GIVEN** a synthetic shim that makes `git rev-parse` hang
- **WHEN** the CLI runs with the shim in PATH
- **THEN** detection terminates at the 1-second timeout, the 🌿
  line is omitted, and the message still sends

#### Scenario: Agent falls back to `unknown` literal

- **GIVEN** `--agent` is not passed AND `CLAUDECODE` is unset
- **WHEN** the user runs `memon notify info "ping"`
- **THEN** the footer's 🤖 line reads exactly `\- 🤖 unknown`

### Requirement: Agent kind and session resolution

The system SHALL resolve `agent` and `session` independently:

- **agent**: precedence is `--agent <kind>` > env detect (`CLAUDECODE`
  set and non-empty → `claude`) > `unknown`. Other tool-specific env
  vars (`CODEX_HOME`, hypothetical `OPENCODE_*`) SHALL NOT be probed,
  because they are commonly set in shell profiles and would yield
  false positives when those profiles are sourced under a different
  agent. The skill prompts for codex / opencode SHALL pass `--agent`
  explicitly.
- **session**: precedence is `--session <name>` > absent. The runtime
  SHALL NOT attempt to read Claude Code's `/rename` value from
  `~/.claude/...` state files, Codex's session label, or any other
  per-tool internal state. Each agent's skill knows where its own
  session label lives and SHALL pass it via `--session`. Session
  name length SHALL be capped at 80 characters; longer values exit
  `BAD_REQUEST`.

When `--agent` is given an unrecognized literal that still matches
the documented identifier regex (`^[a-z][a-z0-9-]{0,31}$`), the
runtime SHALL accept it verbatim and forward it to the footer.
Rejecting unknown values would require updating the CLI whenever a
new agent appears, which violates the open-world assumption.

#### Scenario: --agent overrides env detect

- **GIVEN** `CLAUDECODE=1` is set
- **WHEN** the user runs `memon notify info "ping" --agent codex`
- **THEN** the footer reads `agent: codex` (the explicit flag wins)

#### Scenario: Unknown but well-formed agent passes through

- **WHEN** the user runs `memon notify info "ping" --agent
  my-experimental-shell`
- **THEN** the footer reads `agent: my-experimental-shell`; exit `0`

#### Scenario: Malformed --agent rejected

- **WHEN** the user runs `memon notify info "ping" --agent
  "MyShell!"`
- **THEN** exit `BAD_REQUEST` naming the identifier regex; no
  network call

#### Scenario: Session length cap

- **WHEN** the user runs `memon notify info "ping" --session <81-char
  string>`
- **THEN** exit `BAD_REQUEST`; no network call

### Requirement: HTTP timeout and retry policy

The Telegram POST SHALL use an AbortController-based timeout of
**10 seconds** (configurable via env var
`MEMON_TELEGRAM_TIMEOUT_MS`, integer milliseconds, default 10000).
On timeout the system SHALL exit `GENERIC` (or 0 if `--soft`) with a
structured error of code `GENERIC` and message `telegram POST timed
out after <N>ms`.

The system SHALL NOT auto-retry. A failed notification is an
agent-visible outcome — retries belong to the agent's prompt logic
(e.g. retry with `--soft` after a sleep), not the CLI.

#### Scenario: Timeout exits non-zero

- **GIVEN** `MEMON_TELEGRAM_TIMEOUT_MS=100` and Telegram is reachable
  but slow (>100ms)
- **WHEN** the user runs `memon notify info "ping"`
- **THEN** the process exits `1` with the `telegram POST timed out`
  envelope on stderr; no retry occurs

#### Scenario: Network unreachable surfaces error

- **GIVEN** DNS lookup for `api.telegram.org` fails
- **WHEN** the user runs `memon notify info "ping"` (no `--soft`)
- **THEN** the process exits `1` with a structured error envelope
  whose `code` is `GENERIC` and `message` mentions the underlying
  error (e.g. `ENOTFOUND` or `EAI_AGAIN`); no retry occurs

