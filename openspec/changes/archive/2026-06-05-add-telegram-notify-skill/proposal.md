## Why

The `memon notify` CLI runtime shipped and is verified working (a real
bot, `@memon_notify_bot`, pushes to the user's Telegram DM). But the
runtime is just a pipe — nothing yet teaches the local `claude` /
`codex` / `opencode` agent **when** to reach for it. Per the
runtime-first-then-skills convention ([[feedback_split_runtime_then_skills]]),
the agent-facing guidance ships as this separate change now that the
runtime is proven.

Without a skill, an agent has no contract for: which of the five
severities maps to which situation, that one event = one notification
(not one per loop iteration), that `--agent` / `--session` must be
passed so the footer is attributable, or that the bot is send-only
(push, never a blocking wait for a reply).

## What Changes

- New bundled skill **`packages/skills/memon-notify/SKILL.md`** — a
  manual + thin wrapper for `memon notify`. Model-invocable (single
  low-stakes side-effect, no disk writes), so it sits in the same risk
  tier as `memon-append-journal` / `memon-append-warning` and may fire
  autonomously.
- The skill body documents:
  - **When to use** — the five situations that map to the five
    severities: `error` (fatal/unrecoverable, crashed and don't know
    why), `warn` (stuck-but-running bug), `question` (a human judgment
    call the agent would otherwise raise via AskUserQuestion), `done`
    (a delegated long task finished + verified), `info` (milestone, no
    action needed).
  - **When NOT to use** — user is actively in the conversation; per
    loop iteration; as a durable log (that's `memon-append-journal`);
    routine exp-doc warnings (that's `memon-append-warning`).
  - **Workflow** — severity choice, one-line title, multi-line markdown
    body via `--details-file -`, mandatory `--agent` + `--session`,
    `--context`/`--link`, and when to use `--soft`.
  - **Anti-patterns** — per-iteration spam, crying-wolf `error`,
    dumping logs into `--title`, omitting `--session`, echoing the bot
    token.
  - **Errors** — the exit-code table (0/1/2/4).
- Register `memon-notify` in `packages/skills/src/index.ts`
  `SKILL_NAMES` so `memon install-skills` syncs it into
  `.claude/skills/` (+ `.codex/` / `.opencode/`).
- Add a row to `packages/skills/README.md`'s "Pick the right skill"
  index table.
- Rebuild `packages/skills/dist`.

## Capabilities

### New Capabilities

(none — this extends the existing `memon-skills` capability)

### Modified Capabilities

- `memon-skills`:
  - ADD a requirement that `memon-notify` exists as a model-invocable
    bundled skill with the documented when-to-use severity mapping and
    send-only / one-event-one-notification discipline.
  - MODIFY the "Skill invocation policy split by risk tier" requirement
    to list `memon-notify` in the model-invocable tier.
  - MODIFY the "`--project-root` is always passed explicitly"
    requirement to carve out `memon notify` — it has no project context
    and instead reads credentials via `--config <path>` (or env vars),
    so its skill examples pass `--config`, not `--project-root`.
  - MODIFY the "no memon-doctor skill" requirement's directory-list
    scenario: the bundled set grows from eight to nine `memon-*`
    subdirectories.

## Impact

- New file: `packages/skills/memon-notify/SKILL.md`.
- Modified: `packages/skills/src/index.ts` (SKILL_NAMES + 1),
  `packages/skills/README.md` (index table + intro count),
  `packages/skills/dist/**` (rebuilt).
- No runtime / CLI / web code changes — the CLI surface already exists
  from the `add-telegram-notify` change.
- No FS-convention bump.
- Depends on `add-telegram-notify` being archived (the CLI the skill
  documents must exist). If that change is still in `openspec/changes/`,
  archive it first or land them together.
