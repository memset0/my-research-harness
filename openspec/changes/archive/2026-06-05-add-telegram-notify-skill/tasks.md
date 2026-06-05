## 1. Author the skill

- [x] 1.1 Create `packages/skills/memon-notify/SKILL.md` with
  frontmatter: `name: memon-notify`, a `description` carrying the
  trigger language (stuck bug / fatal error / needs-judgment /
  long-task-done), `argument-hint: <severity> "<title>" [--details… |
  --details-file -]`, `license: MIT`, `metadata.author: memset0`,
  `metadata.version: "0.1.0"`. Do NOT add
  `disable-model-invocation` (model-invocable tier).
- [x] 1.2 Body — intro paragraph: thin wrapper for `memon notify`,
  push-only (agent keeps working after notifying, does not block on a
  reply).
- [x] 1.3 Body — **When to use**: the five-severity → situation table
  (error / warn / question / done / info), keyed to the originating
  use-cases.
- [x] 1.4 Body — **When NOT to use**: user is in the conversation now;
  per loop iteration; as a durable log (→ `memon-append-journal`);
  routine exp-doc warnings (→ `memon-append-warning`).
- [x] 1.5 Body — **Workflow**: severity pick → one-line ≤200-char title
  → multi-line markdown via `--details-file -` → ALWAYS `--agent` +
  `--session` → `--context k=v` / `--link` → `--soft` guidance
  (opt-in, not default). Include a runnable heredoc example that pipes
  a fenced-code body and passes `--config <path>` (NOT `--project-root`).
- [x] 1.6 Body — **Anti-patterns**: per-iteration spam; crying-wolf
  `error`; log dumped into `--title`; omitting `--session`; echoing the
  bot token (lives in config.yml, CLI redacts it).
- [x] 1.7 Body — **Errors** table: 0 sent / soft-swallowed, 1
  telegram-4xx-5xx/network/timeout, 2 BAD_REQUEST (unknown severity,
  bad title, reserved --context key, no creds), 4 NOT_FOUND
  (--details-file missing).
- [x] 1.8 Body — a Chinese user-facing line (inside a `>` block quote)
  for the case where credentials are missing, steering the user to add
  the `telegram:` block to `config.yml`.

## 2. Register + index

- [x] 2.1 Add `'memon-notify'` to `SKILL_NAMES` in
  `packages/skills/src/index.ts`.
- [x] 2.2 Add a row to the "Pick the right skill for the job" table in
  `packages/skills/README.md` (e.g. "Ping the user on Telegram when an
  autonomous run needs attention | `memon-notify` | One event = one
  notification; send-only."). Update the intro skill count
  ("Seven" → the new total) if the README states a count.

## 3. Build + verify

- [x] 3.1 `pnpm --filter @memon/skills build` (regenerates `dist/`).
- [x] 3.2 Confirm `memon install-skills --project-root <tmp> --agent
  claude --format json` lists `memon-notify` among the synced skills
  (or inspect that the dist contains the new dir).
- [x] 3.3 Grep-check the spec scenarios hold: frontmatter has no
  `disable-model-invocation`; all five severities appear in When-to-use;
  example invocations pass `--agent`+`--session` and use `--config`
  (not `--project-root`).
- [x] 3.4 `openspec validate add-telegram-notify-skill --type change`
  clean.
