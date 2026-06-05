## Context

The user runs `claude` and `codex` agents on shared GPU clusters where
the agent's wall-clock turnaround is hours, not minutes. There's no
ambient signal to the user when the agent stalls, crashes, finishes a
long task, or genuinely needs human input via `AskUserQuestion`. The
existing surfaces (`memon` CLI, web dashboard at `localhost:3737`,
JOURNAL.md) are all **pull-based** — the user has to actively look.
A push-based notification channel closes the loop.

Telegram was chosen as the first (and only) backend because:

- The user already runs a Telegram bot for unrelated automation, so
  bot infrastructure exists.
- The Telegram Bot API is a stateless HTTPS endpoint with one method
  (`sendMessage`), no SDK or auth token negotiation needed beyond a
  static `bot_token`.
- Push notifications are first-class on mobile.

The integration lives in `memon` (rather than a separate daemon or a
hook in `claude` / `codex` directly) because:

- The agent already calls `memon` for every other write to the
  experiment tree (warnings, status sets, README edits). One CLI =
  one contract for the agent prompt to memorize.
- A daemon would have to be cluster-aware, restart-safe, and
  authenticated — all complexity the user doesn't need yet.
- Putting it in `claude` / `codex` directly would require maintaining
  separate forks of each agent. A neutral CLI is the lowest
  common denominator.

This change ships **runtime only**. The agent skill prompts that
teach `claude` / `codex` *when* to call `memon notify` are a separate
change ([[feedback_split_runtime_then_skills]]) because:

- Runtime needs human verification with a real bot and chat.
- Skills are agent-targeted markdown; once we know the runtime works,
  the skill text can be iterated independently without re-running the
  runtime tests.

## Goals / Non-Goals

**Goals**:

- One-shot, fire-and-forget push from any local agent to the user's
  Telegram chat.
- Zero new runtime dependencies — use Node's built-in `fetch`.
- Configuration is opt-in. Existing users who don't set `telegram:`
  see no behavioral change.
- Bot token never appears in logs, error envelopes, journal events,
  or stack traces.
- `--soft` mode so a transient telegram outage never breaks an agent
  loop.
- Self-test (`memon notify test`) so the user can verify setup
  without an experiment context.

**Non-Goals**:

- Two-way interaction (replying to a Telegram message to drive the
  agent). Out of scope.
- Multiple backends (Slack, Discord, generic webhooks). YAGNI; when
  a second backend appears we'll abstract.
- Per-project / per-experiment chat routing. The bot has exactly one
  chat target.
- Rate limiting, deduplication, batching. The agent is responsible
  for not spamming; the CLI is a thin transport.
- Persisting / queuing failed sends. A failure is the agent's signal
  to escalate via other means.
- Web UI surface. The web dashboard does NOT gain a notification
  panel; this is CLI-only.
- Agent skill prompts (separate change per
  [[feedback_split_runtime_then_skills]]).

## Decisions

### D1. Top-level subcommand `memon notify`, not nested

**Decision**: `memon notify <severity> "<title>"` is a top-level
subcommand, peer to `memon serve`, `memon share`, `memon experiment`.

**Alternative considered**: `memon journal notify`, since notifications
arguably belong to the same lifecycle as JOURNAL events.

**Rationale**: `journal` events are an append-only on-disk artifact;
they survive forever and are queryable. Notifications are ephemeral
side-effects. Conflating them would invite the agent to expect
`notify` to be queryable later, which it never will be. Top-level
also matches `memon share` (a recent precedent for "this is a CLI
side-effect, not a data-model operation").

### D2. Five fixed severities

**Decision**: severity vocabulary is closed: `info`, `warn`, `error`,
`question`, `done`.

**Alternative considered**: free-form string severity, or syslog
levels (`debug` / `info` / `notice` / `warning` / `error` / `crit`).

**Rationale**: the agent skill prompts (next change) will key
behavior off severity. A closed vocabulary lets the spec require a
stable emoji + header per severity, and lets the validator reject
typos at the CLI boundary instead of letting them silently land in
the Telegram channel. Five buckets cover all the user-described
cases:

- 卡壳的 bug → `warn`
- 重大问题需要修复 → `error`
- 不知道为什么挂掉 → `error`
- 需要 AskUserQuestion → `question`
- 长程任务完成 → `done`
- generic status pings → `info`

### D3. Config in `config.yml` AND env vars, env wins

**Decision**: credentials resolve as `env > config.yml > BAD_REQUEST`.

**Alternative considered**: env-only (no config.yml exception);
config.yml only (no env override).

**Rationale**:

- The user already pastes long-lived secrets into `config.yml`
  (the `auth.password` and `session_secret` precedent). It's the
  natural home for `bot_token` + `chat_id`.
- Env-var override is a one-line shell snippet, useful for ad-hoc
  testing against a different chat, and for CI where you don't
  want to mount a `config.yml`.
- `notify` is the only non-`serve` subcommand to read `config.yml`.
  This is documented as an explicit exception in the `memon-cli`
  spec delta. Adding a config-yml reader to one command is a
  smaller architectural fingerprint than adding "and env vars" to
  every command.

### D4. No new runtime dependencies

**Decision**: hand-roll the Telegram POST with `fetch` (Node 20+
built-in). No `node-telegram-bot-api`, no `axios`, no Telegram SDK.

**Rationale**: the Bot API's `sendMessage` is a 4-line request: URL,
JSON body, parse the response, done. An SDK is dead weight for a
one-method use case, and SDK upgrades would become a recurring
chore for a feature that may stay frozen for years.

### D5. MarkdownV2 by default, with escape

**Decision**: default `parse_mode` is `MarkdownV2`. All user-supplied
text is passed through a backslash-escape function for the full
reserved set documented at
<https://core.telegram.org/bots/api#markdownv2-style>.

**Alternative considered**: plain text (no parse_mode), or
HTML mode.

**Rationale**:

- The user wants the title bolded and links clickable. Plain text
  can't do either.
- MarkdownV2 is more compact than HTML for this use case (no
  closing tags) and feels natural for the structured message
  format (severity header, bold title, KV block, optional link).
- HTML is supported as an opt-in via `parse_mode: HTML` in the
  config block, for users whose content tends to contain a lot of
  `.` `(` `)` (the MarkdownV2 escape produces noisy backslashes).

**Critical**: the escape must run on EVERY user-supplied string,
including the auto-appended `host=` and `cwd=` footer (the cwd path
will contain `.` and `-`). Forgetting to escape one field will cause
Telegram to reject the entire message with `400 Bad Request: can't
parse entities`.

### D6. 10s timeout, no auto-retry

**Decision**: AbortController timeout of 10000 ms (env override
`MEMON_TELEGRAM_TIMEOUT_MS`). On timeout or network error, exit
non-zero. No automatic retry.

**Rationale**: agents call `memon notify` as a side-effect, not a
critical path. If it fails, the agent should either retry with
`--soft` (its own decision) or give up. Putting retry logic in the
CLI hides failures from the agent and makes timing nondeterministic.

### D7. `--soft` semantics

**Decision**: `--soft` swallows ALL failures (network, 4xx, 5xx,
timeout, even config-missing) and exits `0`. The structured error
is still printed to stderr so the user can grep logs.

**Alternative considered**: `--soft` only swallows transient
failures (network/5xx), but propagates "real" errors like config-
missing or 4xx.

**Rationale**: the agent calling `memon notify` should treat the
call as best-effort. Distinguishing "transient" from "real" requires
the agent to inspect the error envelope, which defeats the purpose
of `--soft`. If the agent wants to surface failures, it should call
without `--soft`.

The exception is `memon notify test`, which is the user's verification
command — there, a silent failure is the worst possible UX. `test`
ignores `--soft` even if passed.

### D8. Footer is mandatory, not opt-out

**Decision**: every notification ends with
`— host=<hostname> cwd=<cwd>`. No flag to suppress.

**Rationale**: when multiple agents fire notifications concurrently
(common on a shared cluster, multiple ttyd panes), the user needs
to know which host / project the notification came from. Stripping
the footer would force the user to embed that info in every
`--context`, which is brittle. Hard-coded footer = always correct.

### D9. Bot token never leaks

**Decision**: the bot token is read once, stored in a local variable,
sent in the request URL, and never written to any output stream.
Error envelopes that mention HTTP status MUST construct their
message from the status code + Telegram's response body, NOT from
the URL.

**Rationale**: although the threat model treats `config.yml` as
"plaintext on disk by design" (same as the `auth.password`
precedent), the same does NOT apply to stderr — stderr often gets
piped to log files, journals, CI artifacts, screen-share videos.
A token leak on stderr is much higher-impact than a token sitting
in `config.yml`.

Hard rule in the implementation: there SHALL be a unit test that
runs `memon notify info "x"` with a known bot token (e.g. `TEST-
TOKEN-deadbeef`) and asserts that the substring `TEST-TOKEN-
deadbeef` does NOT appear in stdout OR stderr for ANY of {success
case, 401, 500, timeout, network error}.

### D10. Truncate, don't reject, when message > 4096

**Decision**: if the assembled message exceeds Telegram's 4096-UTF-16-
unit cap, truncate `details` and append `…(truncated)`. Title and
footer are preserved.

**Alternative considered**: reject with `BAD_REQUEST`.

**Rationale**: the agent's call is at the END of the work; rejecting
it means the user gets no notification, which is the failure mode
we're trying to prevent. Truncation gives partial information,
which is strictly better.

### D11. Auto-context: flag-first, env-probe sparingly

**Decision**: the footer carries six fields — `host`, `agent`,
`session`, `cwd`, `branch`, `ts` — with this resolution policy:

| Field    | Resolver                                                                                |
|----------|-----------------------------------------------------------------------------------------|
| `host`   | `os.hostname()` (no override)                                                           |
| `agent`  | `--agent <kind>` > `CLAUDECODE` env → `claude` > literal `unknown`                      |
| `session`| `--session <name>` > omitted                                                            |
| `cwd`    | `process.cwd()` with `$HOME → ~` (no override)                                          |
| `branch` | best-effort `git rev-parse` subprocess with 1-second AbortController timeout, else omit |
| `ts`     | `new Date().toISOString()` (no override)                                                |

**Alternatives considered for `agent`**:
- Probe a tool-specific env var per agent (`CODEX_HOME`, hypothetical
  `OPENCODE_HOME`). **Rejected**: `CODEX_HOME` is commonly set
  permanently in shell profiles (the user's `config.yml` literally
  sources `yulun_profile.sh` which sets it). A claude run on that
  profile would be mis-labelled as codex.
- Inspect `/proc/<ppid>/cmdline` to find the parent agent process.
  **Rejected**: Linux-specific, fragile across tmux/bash wrappers
  (most invocations have `bash` as the immediate parent of
  `memon`, not the agent CLI). Not worth the cross-platform code.
- Use `process.title` or `process.argv0`. **Rejected**: that's the
  memon process's own title, not the parent's.

`CLAUDECODE=1` is the only env probe because Claude Code unsets it
on exit and sets it only when actively running; cross-checking
against the user's actual shell rc'd env confirms it doesn't leak.

**Alternatives considered for `session`**:
- Read `~/.claude/projects/<sanitized-cwd>/current-session.json` (or
  whatever Claude Code's internal state file is called).
  **Rejected**: undocumented internal API of a third-party tool. The
  runtime would break on every Claude Code update that renames the
  file. The skill knows where to find it and can pass `--session`.
- Read a `MEMON_SESSION_NAME` env var. **Rejected**: redundant
  with the flag, and would invite skills to set the env var globally
  (cross-contamination across panes).

**Alternatives considered for `branch`**:
- Read `.git/HEAD` directly without spawning `git`. **Rejected**:
  the file contains either a literal sha (detached) or
  `ref: refs/heads/<name>`; getting the short sha then requires
  reading another file or the packed-refs file. Re-implementing
  git's resolution is fragile. Subprocess is simpler and fast
  enough (~10ms when the repo is warm).
- Skip the field entirely. **Rejected**: when the user gets pinged
  at 3am about a crashed training run, knowing which commit the
  agent was working off saves 5 minutes of context-rebuilding.

### D12. `--details` from stdin / file path

**Decision**: support three input modes for `details`:

1. `--details "<inline-text>"` — literal argv value, for short
   one-liners (most notifications).
2. `--details-file <path>` — read from a file on disk.
3. `--details-file -` — read from stdin until EOF.

Modes 1 and 2 are mutually exclusive; passing both → `BAD_REQUEST`.

**Rationale**: multi-line markdown (stack traces, formatted KV
blocks, code fences) is awful to pass via argv — every backtick,
quote, dollar, and newline needs shell escaping, and the agent has
to know which shell the user runs (bash / zsh / fish differ on quote
semantics). Stdin sidesteps all of it; the agent writes the raw
markdown to a pipe and lets Node read it.

**Prior art in this repo**: `memon experiment readme write` already
reads its body from stdin. Reusing the pattern keeps the agent
prompts consistent (`pipe-stdin-for-multi-line` is one mental model,
not two).

**Why also support file path**: when the agent generates a long
detail body, sometimes it's easier to write it to a temp file (e.g.
already piping the output of another command to that file) and
reference it than to plumb a pipe. File mode is one extra line in
the handler.

**Why NOT auto-detect "stdin is not a tty" and read from it
implicitly**: would conflate "no details" with "details from stdin",
and break interactive runs (`memon notify info "test"` from a
shell prompt would block on stdin). Explicit `--details-file -` is
unambiguous.

## Risks / Trade-offs

- **[Risk]** Bot token in `config.yml` is plaintext.
  → **Mitigation**: documented in the `telegram-notify` spec; matches
    the existing `auth.password` precedent. Users wanting stronger
    isolation can leave `config.yml` empty and set env vars in a
    `direnv` / shell-init file outside the repo.

- **[Risk]** Telegram rate limits (~1 msg/sec per chat) could bite if
  an agent loops.
  → **Mitigation**: the spec explicitly says no client-side rate
    limiting. The agent skill prompts (next change) will say "send
    one notification per significant event, not per loop iteration".

- **[Risk]** MarkdownV2 escape bugs will cause Telegram to 400 the
  whole message.
  → **Mitigation**: dedicated unit tests with the documented
    reserved-set characters. The escape function is a pure helper
    in `packages/core/src/notify/telegram.ts` so it can be unit-
    tested without mocking `fetch`.

- **[Risk]** Env-var override means a stale `MEMON_TELEGRAM_CHAT_ID`
  in the user's shell rc could silently send to the wrong chat.
  → **Mitigation**: the success-path stdout JSON includes
    `telegram_chat_id` so the user can verify; `memon notify test`
    prints the resolved chat id in its human output.

- **[Trade-off]** No daemon = no offline queueing. If the user's
  network is down when `memon notify` fires, the notification is
  lost.
  → **Acknowledged**: this is the YAGNI baseline. If lost
    notifications become a real problem, add a `~/.cache/memon/
    notify-queue.json` later.

- **[Trade-off]** Single chat target. Multiple users sharing the same
  bot would all receive each other's notifications.
  → **Acknowledged**: single-user threat model, same as the rest of
    the dashboard.

## Migration Plan

This is a strictly additive change:

- New optional `telegram:` block in `config.yml`. Existing configs
  without it continue to work; `memon notify` exits BAD_REQUEST until
  the user opts in.
- New CLI subcommands `notify <severity>` and `notify test`. No
  existing commands change behavior.
- No FS-convention bump. No `MEMON_TOO_OLD` gate.
- The `memon-cli` spec gains a new "Requirement: `memon notify`
  subcommand family" and modifies "Requirement: Config resolution
  order" to carve out the `notify` exception.

Rollback: revert the change. Users with a `telegram:` block in
`config.yml` will see an unused-key warning (or none, depending on
the config loader strictness) but nothing breaks.

## Open Questions

- **Should `memon notify test` accept `--severity` so the user can
  preview each emoji/header in their Telegram client?** Probably yes
  for ergonomics, but it bloats the spec. Punting to "if user asks
  during apply".
- **Should the auto-footer include the run id when invoked inside a
  run dir?** Auto-detecting run-dir vs random-cwd is more complex than
  it sounds (the run dir basename matches `RUN_DIR_REGEX` but only
  when the cwd is the run dir itself, not a subfolder). Punting:
  the agent can pass `--context run=<id>` explicitly.
- **Should `parse_mode: HTML` ship in v1?** The spec mentions it as
  an option; the implementation must support both for the spec to
  validate. Decision: yes, ship both — the escape table is tiny
  (`<` `>` `&`) and the cost is one extra branch.
