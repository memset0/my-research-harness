## 1. Config plumbing

- [x] 1.1 Add `TelegramConfig` interface to `packages/core/src/types.ts`
  with fields `botToken: string`, `chatId: string`,
  `parseMode: 'MarkdownV2' | 'HTML'` (default `'MarkdownV2'`),
  `disableNotification: boolean` (default `false`).
- [x] 1.2 Add `telegram?: TelegramConfig` to the `Config` interface in
  the same file; do NOT make it required (existing configs must
  continue loading).
- [x] 1.3 Extend `packages/core/src/config/load.ts` (whatever currently
  parses `auth:`, `slurm:`, `terminal:`) to parse the optional
  `telegram:` block. When the block is present but `bot_token` or
  `chat_id` is missing/empty, throw a structured error naming the
  missing field — match the existing config-load error shape.
- [x] 1.4 Export `TelegramConfig` from `packages/core/src/index.ts` so
  the CLI can import the type.
- [x] 1.5 Add a unit test in `packages/core/src/config/load.test.ts`
  (or the closest existing test file) that asserts:
  - A config WITHOUT `telegram:` block loads and `.telegram` is
    `undefined`.
  - A complete `telegram:` block loads into the expected shape with
    defaults filled in.
  - A `telegram:` block missing `bot_token` throws.
  - A `telegram:` block missing `chat_id` throws.
  - `parse_mode: "Markdown"` (without the V2) is REJECTED (only
    `MarkdownV2` and `HTML` are valid).

## 2. Pure helpers in core

- [x] 2.1 Create `packages/core/src/notify/telegram.ts` exporting:
  - `escapeMarkdownV2(s: string): string` — backslash-escapes every
    char in the documented reserved set `_*[]()~\`>#+-=|{}.!`.
  - `escapeHtml(s: string): string` — escapes `&`, `<`, `>` only.
  - `AssembleMessageInput` interface with fields `severity`, `title`,
    `details?`, `contextKv: Array<[string, string]>`, `link?`,
    `parseMode`, `auto: { host, agent, session?, cwd, branch?, ts }`.
  - `assembleMessage(opts: AssembleMessageInput): string` — produces
    the final message body, applies escapes for the chosen parse
    mode, truncates `details` if needed to keep total ≤ 4096 UTF-16
    code units, returns the final string ready to put in the API
    payload. The footer renders as a key-per-line block in the fixed
    order `host → agent → session? → cwd → branch? → ts`.
  - `SEVERITY_META` — a `const` map from severity → `{emoji, tag}`,
    keyed by the five literal tokens.
  - `RESERVED_CONTEXT_KEYS` — a `const` set of `{host, agent,
    session, cwd, branch, ts}`. Importable by the CLI for the
    reject-clashing-context check.
  - `AGENT_KIND_RE` — `^[a-z][a-z0-9-]{0,31}$` regex constant for
    validating `--agent`.
  - `redactToken(s: string, token: string): string` — used by the
    CLI before printing any error string; replaces every occurrence
    of `token` with `***`.
- [x] 2.2 Add `packages/core/src/notify/telegram.test.ts` covering:
  - Escape: every reserved char produces its backslash form.
  - Escape: non-reserved chars pass through.
  - Escape: HTML mode escapes only `& < >`.
  - Severity → emoji + tag for all 5 severities.
  - Assembly: minimal invocation produces a body with header,
    bold-escaped title, and the 4-or-5-line auto footer (host,
    agent, cwd, [branch], ts).
  - Assembly: `session` line appears when `auto.session` is set;
    absent when `undefined`.
  - Assembly: `branch` line appears when `auto.branch` is set;
    absent when `undefined`.
  - Assembly: with details + 2 context kv pairs + link, all sections
    render in documented order (header → title → details → user
    KV → link → footer).
  - Assembly: details longer than the cap is truncated with
    `…(truncated)`; title and footer survive intact.
  - Assembly: title containing `Hello. World!` renders as
    `*Hello\. World\!*` in MarkdownV2 mode.
  - Redact: a bot token substring in an arbitrary error message is
    replaced; absent token = identity.
  - `RESERVED_CONTEXT_KEYS` matches the documented six-element set.
  - `AGENT_KIND_RE` accepts `claude`, `codex`, `opencode`, `unknown`,
    `my-experimental-shell`; rejects `MyShell!`, empty string, and
    a 33-char identifier (1 over cap).
- [x] 2.3 Export the new helpers + types + constants from
  `packages/core/src/index.ts` (named exports only — no default
  export).
- [x] 2.4 Create `packages/core/src/notify/auto-context.ts` exporting:
  - `detectAgent(env: NodeJS.ProcessEnv, explicit?: string): string`
    — `explicit ?? (env.CLAUDECODE ? 'claude' : 'unknown')`. Validates
    explicit against `AGENT_KIND_RE` and throws a structured error on
    mismatch (CLI converts to BAD_REQUEST).
  - `collapseHome(cwd: string, home: string | undefined): string` —
    `$HOME → ~` collapse, no-op when `home` is undefined or `cwd`
    doesn't start with `home`.
  - `probeGitBranch(cwd: string, timeoutMs?: number): Promise<{
    branch: string; shortSha: string } | undefined>` — spawns `git
    rev-parse --abbrev-ref HEAD` and `git rev-parse --short HEAD`
    with an AbortController timeout (default 1000 ms); returns
    `undefined` on any failure (non-zero exit, ENOENT for git, timeout,
    cwd not in a worktree). MUST NOT throw.
  - `nowIsoLocal(): string` — `new Date()` rendered as ISO8601 with
    the local timezone offset (e.g. `2026-05-20T08:55:00+08:00`).
    Stable across DST boundaries.
- [x] 2.5 Add `packages/core/src/notify/auto-context.test.ts`:
  - `detectAgent`: explicit `claude` wins over `CLAUDECODE=1`+`codex`.
  - `detectAgent`: empty env + no flag → `unknown` literal.
  - `detectAgent`: `CLAUDECODE=1` no flag → `claude`.
  - `detectAgent`: `CLAUDECODE=""` (empty) treated as unset → `unknown`.
  - `detectAgent`: malformed explicit throws.
  - `collapseHome`: `/home/alice/work` + `HOME=/home/alice` →
    `~/work`.
  - `collapseHome`: cwd not under home → unchanged.
  - `collapseHome`: HOME undefined → unchanged.
  - `probeGitBranch`: inside a tmp git repo with one commit → returns
    `{branch: 'main', shortSha: <7-char>}`. (Use `child_process.execSync
    git init`-style setup in the test.)
  - `probeGitBranch`: cwd outside any git repo → returns `undefined`.
  - `probeGitBranch`: `PATH=""` (git unfindable) → returns `undefined`
    without throwing.
  - `nowIsoLocal`: result matches `/T.*[+-]\d{2}:\d{2}$/` (has TZ
    suffix, not `Z`).

## 3. CLI command surface

- [x] 3.1 Create `packages/cli/src/commands/notify.ts` with two
  exported handlers:
  - `runNotifySend(opts: NotifySendOptions): Promise<void>`
  - `runNotifyTest(opts: NotifyTestOptions): Promise<void>`
  Internal helper `resolveTelegramCredentials(opts)` implementing the
  precedence env > config.yml > BAD_REQUEST. The config.yml path is
  `opts.configPath ?? join(opts.cwd, 'config.yml')`.
- [x] 3.2 Register the subcommands in `packages/cli/src/index.ts`
  under a `notify` parent command:
  - `memon notify <severity> <title>` with options
    `--details <text>`, `--details-file <path>` (mutually exclusive
    with `--details`; `-` means stdin), `--context <key=value>`
    (repeatable), `--link <url>`, `--agent <kind>`,
    `--session <name>`, `--soft`, `--quiet`, `--format`, `--config`.
  - `memon notify test` with options `--agent <kind>`,
    `--session <name>`, `--format`, `--config` (test also surfaces
    agent/session in its self-test message).
  Reject `--project-root` / `--project` on both subcommands (use
  Commander's `unknownOption: 'error'` behavior or a hand-rolled
  check — verify either works).
- [x] 3.2a Implement `--details-file <path>` reader:
  - `path === '-'` → `readStdin()` (reuse the existing helper if
    present in `commands/experiment.ts`, otherwise inline a
    `Readable → string` accumulator).
  - else → `fs.readFile(path, 'utf8')`; ENOENT → `NOT_FOUND` exit.
  - Reject when both `--details` and `--details-file` are passed.
  - When `--details-file -` is passed but stdin is empty (zero bytes),
    treat `details` as absent (NOT empty string).
- [x] 3.2b Implement context-key collision check: any `--context key=...`
  whose `key` is in `RESERVED_CONTEXT_KEYS` exits `BAD_REQUEST` listing
  the reserved set.
- [x] 3.2c Wire `--agent` → `detectAgent(process.env, opts.agent)`,
  surface result to assembleMessage's `auto.agent`; on
  AGENT_KIND_RE mismatch, exit `BAD_REQUEST` with the regex in the
  message.
- [x] 3.2d Wire `--session`: length-cap check (>80 chars → BAD_REQUEST);
  pass through to `auto.session` (undefined when absent).
- [x] 3.2e Wire `auto.branch`: call `probeGitBranch(process.cwd())`
  with the 1-second default timeout; on resolve, format
  `{branch}@{shortSha}`; on `undefined`, leave `auto.branch`
  undefined. Wrap in `Promise.race` against a hard 1.5-second outer
  ceiling as a defense-in-depth against probe library bugs.
- [x] 3.2f Wire `auto.ts`: call `nowIsoLocal()` immediately before
  POSTing (not at CLI start; the gap could be seconds if stdin is
  drained).
- [x] 3.3 Implement the HTTPS POST to
  `https://api.telegram.org/bot<TOKEN>/sendMessage` using built-in
  `fetch` with an `AbortController` timeout
  (`MEMON_TELEGRAM_TIMEOUT_MS`, default 10000).
- [x] 3.4 Wire `--soft` to suppress non-zero exit on EVERY failure
  path (network, 4xx, 5xx, timeout, config-missing). The structured
  error still prints to stderr.
- [x] 3.5 Wire `--quiet` to set `disable_notification: true` in the
  outgoing JSON payload, layered on top of the config default.
- [x] 3.6 Ensure every error message that mentions HTTP status is
  passed through `redactToken(msg, botToken)` before emission.
- [x] 3.7 On success, stdout JSON shape is `{sent: true, severity,
  title, agent, session, telegram_chat_id, telegram_message_id}`.
  `session` SHALL be `null` (not omitted) when absent, so consumers
  can branch on the presence of the key uniformly. The
  `telegram_message_id` comes from the Telegram API's response body
  (`result.message_id`).
- [x] 3.8 `memon notify test` sends a canary message with severity
  `info`, title `memon notify self-test`, no details, no context,
  no link. It does NOT honor `--soft`.

## 4. CLI command tests

- [x] 4.1 Create `packages/cli/src/commands/notify.test.ts` with
  `vi.fn`-mocked global `fetch` (use vitest's `vi.stubGlobal('fetch',
  ...)` pattern):
  - Happy path: success response → stdout JSON matches shape, exit 0.
  - Unknown severity → BAD_REQUEST, no fetch call, exit 2.
  - Title > 200 chars → BAD_REQUEST, no fetch call, exit 2.
  - Title empty → BAD_REQUEST, exit 2.
  - >10 `--context` entries → BAD_REQUEST, exit 2.
  - `--link` without `https://` → BAD_REQUEST, exit 2.
  - Telegram 401 → stderr envelope says `401 Unauthorized: token
    rejected`, exit 1, AND assert the bot token substring is absent
    from stdout+stderr.
  - Telegram 500 → exit 1, no `--soft` → token absent.
  - `--soft` on 500 → exit 0, stderr still contains envelope.
  - `--quiet` → outgoing payload contains
    `disable_notification: true`.
  - `--config /abs/path/to/config.yml` overrides cwd lookup.
  - Env vars `MEMON_TELEGRAM_BOT_TOKEN`+`MEMON_TELEGRAM_CHAT_ID`
    win over `config.yml`.
  - Only one env var set + valid config → warning on stderr +
    config.yml is used.
  - Neither env nor config.yml → BAD_REQUEST naming both sources,
    exit 2.
  - `notify test` with valid creds → success-shape stdout.
  - `notify test` with no creds → exit 2 (not soft-swallowed).
  - `notify test` with `--soft` → still exits 2 (test ignores
    --soft).
- [x] 4.1a Add CLI tests for the new flags + stdin path:
  - `--details-file -` with piped stdin → outgoing payload contains
    the multi-line markdown body verbatim (modulo escape).
  - `--details-file /nonexistent.md` → `NOT_FOUND` (exit 4); no
    network call.
  - `--details "x" --details-file -` → `BAD_REQUEST` (exit 2);
    stdin NOT read.
  - `--details-file -` with empty stdin → details treated as absent
    (no `details` line in payload).
  - `--context host=foo` → `BAD_REQUEST` naming the reserved-keys
    set; no network call.
  - `--agent MyShell!` → `BAD_REQUEST` naming the regex; no network.
  - `--agent unknown` literally passes through and renders as
    `agent: unknown` in the payload footer.
  - `CLAUDECODE=1` env + no `--agent` → footer `agent: claude`.
  - `--session telegram-notify` → footer contains `session:
    telegram-notify` AND JSON output's `session` field is the same
    string.
  - `--session <81 chars>` → `BAD_REQUEST` (exit 2).
  - Outside a git work-tree (test in `/tmp` or a `tmpdir`): footer
    omits the `branch:` line; everything else renders.
- [x] 4.2 Add one integration-style test that actually constructs the
  outgoing JSON body and asserts:
  - `chat_id` matches the configured value.
  - `parse_mode` matches the resolved value.
  - `text` begins with the right emoji + UPPERCASE tag for each
    severity.
  - `text`'s footer contains in order: `host:`, `agent:`, [`session:`],
    `cwd:`, [`branch:`], `ts:` — each on its own line, each escaped
    per parse mode.

## 5. config.yml template + docs

- [x] 5.1 Add a commented-out `telegram:` block to the committed
  reference `config.yml` (the one with the leading `# memon
  configuration.` header comment), placed after the `auth:` block.
  Document `bot_token`, `chat_id`, `parse_mode`, `disable_notification`
  and link to BotFather (`@BotFather` on Telegram) in the comment.
- [x] 5.2 Confirm `apps/web` does NOT regress on the new
  `telegram:` block — load `config.yml` via the web server start path
  and ensure it's a no-op when the block is present.

## 6. Verification

- [x] 6.1 `pnpm --filter @memon/core typecheck` clean.
- [x] 6.2 `pnpm --filter @memon/cli typecheck` clean.
- [x] 6.3 `pnpm --filter @memon/web typecheck` clean (the web server
  reads the same config — must keep passing).
- [x] 6.4 `pnpm --filter @memon/core test` passes including the new
  notify-helper tests.
- [x] 6.5 `pnpm --filter @memon/cli test` passes including the new
  notify-command tests.
- [x] 6.6 `openspec validate add-telegram-notify --type change` clean.
- [x] 6.7 Smoke: from inside the repo with a valid `telegram:` block
  in `config.yml`, run `memon notify test` and confirm the canary
  arrives in the Telegram chat. (Manual; the user runs this.)
- [x] 6.8 Smoke: run `memon notify error "smoke test" --details "from
  apply-phase verification"` and confirm formatting renders correctly
  on mobile + desktop Telegram clients. (Manual; the user runs this.)
