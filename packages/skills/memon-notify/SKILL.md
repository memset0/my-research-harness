---
name: memon-notify
description: "Manual + thin wrapper for `memon notify` — push a one-shot Telegram alert to the user when an autonomous run needs their attention. Use when the agent is stuck on a bug it cannot resolve, hit a fatal error, does not know why something died, needs a human judgment call it would otherwise raise via AskUserQuestion, or finished a long-running task the user delegated then walked away from. One notification per significant event — NEVER per loop iteration. Send-only: push and keep working, do not block waiting for a reply."
---

# memon-notify

This skill is a manual for the `memon notify` CLI subcommand — how to
push a single Telegram message to the user when an autonomous run needs
their attention. The user has stepped away while a long task runs; a
push notification lets them come back and handle whatever came up,
dropping round-trip latency from hours to seconds.

**Send-only.** The bot pushes; it does not read replies. After
notifying, keep working if you can — the notification is a signal to
the human, not a blocking wait. For a decision you genuinely cannot
proceed without *inside an interactive session*, still use
AskUserQuestion; `memon notify question` is for "I parked this and
pinged you", not "I am now blocked on the bot".

There is no FS-convention preflight here: `memon notify` never touches
the experiment tree (no run dirs, no exp docs, no journal). It only
reads the `telegram:` block of `config.yml` and POSTs to Telegram.

## When to use

Pick the severity that matches your situation:

| severity | when |
|---|---|
| 🔥 `error` | a fatal / unrecoverable failure — the run crashed and you can't recover, you don't know why it died, or a fix you tried did not work |
| ⚠️ `warn` | stuck-but-running — a bug you've been circling without progress, or a degraded-but-alive state worth a look |
| ❓ `question` | a human judgment call you would otherwise raise via AskUserQuestion (which baseline, which direction) — you've parked the work and want the user to weigh in |
| ✅ `done` | a long task the user delegated then walked away from has finished AND been verified |
| ℹ️ `info` | a milestone worth surfacing that needs no action |

## When NOT to use

- ❌ The user is actively in the conversation right now — just ask /
  tell them directly. A notification to someone who's already here is
  noise.
- ❌ Per loop iteration / per step. One notification per **significant**
  event. A 50-step sweep is ONE `done`, not 50 `info`s.
- ❌ As a durable log — that's `memon-append-journal` (a `[NOTE]` /
  `[ERROR]` event survives; a notification is an ephemeral nudge).
- ❌ For durable Experiment warnings or limitations — maintain those through
  `memon-write-experiment-doc`; a notification is only an ephemeral nudge.
- ❌ As a blocking wait. If you cannot proceed without an answer in an
  interactive session, use AskUserQuestion, not a notification.

## Credentials

`memon notify` reads the `telegram:` block from `config.yml` (or the
`MEMON_TELEGRAM_BOT_TOKEN` + `MEMON_TELEGRAM_CHAT_ID` env vars). It does
**not** take `--project-root` — pass `--config <path>` when your cwd is
not the directory holding `config.yml`, otherwise rely on the cwd
`config.yml`.

If the command exits `2` (BAD_REQUEST) naming missing credentials,
surface this to the user (in Chinese):

> Telegram 通知还没配置好。请在 `config.yml` 里加一个 `telegram:` 块
> （`bot_token` + `chat_id`，从 @BotFather 拿 token），或者设置
> `MEMON_TELEGRAM_BOT_TOKEN` 和 `MEMON_TELEGRAM_CHAT_ID` 两个环境变量，
> 然后我再发一次。

Do NOT echo the bot token anywhere — it is a credential. The CLI
redacts it from its own error output; don't undo that by printing it.

## Workflow

1. **Pick the severity** from the When-to-use table.
2. **Title**: one line, ≤ 200 characters, names the specific situation.
   The title is what the user sees in the phone notification preview —
   make it scannable.
3. **Body** (optional): for anything multi-line — a stack trace, a
   repro, a short list of options — pipe markdown via
   `--details-file -` so you don't shell-escape every backtick / quote
   / dollar / newline. Markdown renders: `**bold**`, `*italic*`,
   ` ```fenced code``` `, and `[links](url)`.
4. **ALWAYS pass `--agent` and `--session`** so the footer says which
   agent and which conversation fired the ping. With several agents
   running on a cluster, this is how the user tells them apart.
5. Add `--context key=value` for project / run ids and `--link <url>`
   for a deep link into the dashboard.
6. **`--soft`** is opt-in, not default:
   - Use it when a lost notification must NOT break your loop (a
     transient Telegram outage → error to stderr, exit 0). Good for a
     mid-run `warn` fired from inside a retry loop.
   - Omit it when delivery must be confirmed — e.g. the terminal
     `done` at the very end of a task, where you want a non-zero exit
     if the ping didn't land.

Example — a fatal error with a code-fenced body (outer fence is 4
backticks so the heredoc's own ``` fence doesn't close it):

````sh
cat <<'EOF' | memon notify error "training crashed: NCCL timeout" \
  --details-file - \
  --agent claude --session "$SESSION" \
  --context project=sparse-fsdp --context run=tp4-260604 \
  --link "https://memon.example/p/sparse-fsdp" \
  --config ./config.yml
**Stack trace** (rank 3):

```
torch.distributed.DistBackendError:
  NCCL all-reduce timed out @ step 1500
```

Tried: rerun, lower TP degree. Still hangs.
EOF
````

Output (JSON to stdout) on success:

```json
{ "sent": true, "severity": "error", "title": "training crashed: NCCL timeout",
  "agent": "claude", "session": "...", "telegram_chat_id": "...",
  "telegram_message_id": 7 }
```

A terminal `done` where you want delivery confirmed (no `--soft`):

```sh
memon notify done "100k-step finetune finished, eval acc 0.873" \
  --agent claude --session "$SESSION" \
  --context run=ft-260605 --config ./config.yml
```

## Anti-patterns

- ❌ Notifying on every iteration of a polling / retry loop. Fire once,
  on the significant transition.
- ❌ Crying wolf with `error` for a non-fatal hiccup. Reserve 🔥 for
  "blocked / crashed", or the user learns to ignore it.
- ❌ Pasting a 500-line log into `--title`. The title is one line; bulk
  goes in `--details` / `--details-file` (auto-truncated at 4096
  UTF-16 units).
- ❌ Omitting `--session` (or `--agent`). Without them the user can't
  tell which conversation pinged them.
- ❌ Passing `--project-root` — `memon notify` rejects it. Use
  `--config <path>` or a cwd `config.yml`.
- ❌ Echoing the bot token. It lives in `config.yml`; the CLI redacts
  it from errors — don't print it yourself.
- ❌ Treating `memon notify question` as a blocking call and waiting
  for a reply. It's send-only; keep working or use AskUserQuestion.

## Errors

| exit | meaning |
|---|---|
| 0 | sent (or `--soft` swallowed a send failure; the error is still on stderr) |
| 1 | telegram 4xx / 5xx, network error, or timeout (no `--soft`) |
| 2 | `BAD_REQUEST` — unknown severity, empty / too-long title, a reserved `--context` key (`host`/`agent`/`session`/`cwd`/`branch`/`ts`), or no credentials anywhere |
| 4 | `NOT_FOUND` — `--details-file <path>` does not exist |
