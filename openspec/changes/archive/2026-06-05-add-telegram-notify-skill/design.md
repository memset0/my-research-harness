## Context

The `add-telegram-notify` change shipped the `memon notify` CLI: a
one-shot Telegram push with five severities, an auto-context footer
(host / agent / session / cwd / branch / ts), markdown-rendered
`--details`, and `--soft` / `--quiet` modes. A real bot
(`@memon_notify_bot`) is wired into the user's `config.yml` and
verified end-to-end.

What's missing is the agent-facing contract. The CLI is a dumb pipe;
the skill is where the *policy* lives — when to fire, which severity,
how to attribute, how not to spam. This mirrors how
`memon-append-warning` wraps `memon experiment warning add`: the CLI
enforces structure, the skill enforces judgment.

## Goals / Non-Goals

**Goals**:

- A single bundled skill, `memon-notify`, that an autonomous agent can
  invoke on its own (model-invocable tier) to ping the user at the
  right moments.
- A crisp severity → situation mapping the agent can pattern-match
  against its own state.
- Discipline baked in: one notification per significant event,
  send-only (no blocking wait), always attributable (`--agent` +
  `--session`).
- Conform to every existing memon-skills rule (English body, Chinese
  user dialogue in block quotes, registered in `SKILL_NAMES` + README).

**Non-Goals**:

- No CLI / runtime change — that already shipped.
- No two-way interaction skill (replying to the bot to drive the
  agent). The bot is push-only.
- No per-project routing or multiple chat targets.
- No change to the other eight skills' bodies (only the spec's shared
  requirements that enumerate the skill set / invocation tiers).

## Decisions

### D1. Model-invocable (no `disable-model-invocation`)

**Decision**: `memon-notify` omits the `disable-model-invocation`
field, joining `memon-append-journal` / `memon-append-warning` in the
light tier.

**Rationale**: the whole point is autonomous pinging — an agent that's
stuck at 3am must be able to fire the notification without a human in
the loop (the human is exactly who's being summoned). The action is a
single HTTP POST with no disk writes, no cursor advance, no
long-running process — the lightest possible side-effect. Gating it
behind user-invocation would defeat the feature.

The safety mechanism is the skill body's discipline (one event = one
notification, severity gating), not a frontmatter flag — consistent
with how the spec already justifies the light tier.

### D2. `--config`, not `--project-root`

**Decision**: the skill's examples pass `--config <path>` (or rely on
cwd `config.yml`), and the spec's "always pass `--project-root`" rule
gains an explicit `memon notify` carve-out.

**Rationale**: `memon notify` is the one subcommand with no project
context — it reads only the `telegram:` block, and the runtime rejects
`--project-root` on it outright. Forcing `--project-root` into the
skill examples would produce commands that error. The carve-out is
documented in the spec so a future reader doesn't "fix" the skill by
adding the flag back.

### D3. Severity mapping keyed to the user's original ask

**Decision**: the five severities map to the exact situations the user
described when requesting the feature:

| user's words | severity |
|---|---|
| 出现重大问题需要修复 / 不知道为什么挂掉 | `error` |
| 卡壳的 bug | `warn` |
| 需要 AskUserQuestion 让用户判断 | `question` |
| 长程任务终于完成 | `done` |
| (milestone, no action) | `info` |

**Rationale**: the agent should be able to read its own situation and
pick the severity deterministically. Anchoring the table to the
originating use-cases keeps the mapping honest and gives the user a
mental model that matches what they asked for.

### D4. `--soft` is opt-in, not default

**Decision**: the skill instructs the agent to use `--soft` only when
a lost notification must not break its loop, and to omit it when
delivery must be confirmed (e.g. a `done` at the very end of a task).

**Rationale**: `--soft` trades delivery-confirmation for
loop-robustness. For a mid-run `warn` fired from inside a retry loop,
swallowing a transient Telegram outage is correct. For the terminal
`done`, the agent wants to know the ping actually landed. Making the
agent choose per-call (rather than defaulting one way) matches the
runtime's design (D7 in the runtime change).

### D5. Send-only framing

**Decision**: the skill states up front that the bot is push-only —
after notifying, the agent keeps working; it does not block waiting
for a reply.

**Rationale**: the runtime has no inbound channel. An agent that
treated `memon notify question` as a blocking AskUserQuestion would
hang forever. The skill must make clear: notify is a *nudge to the
human*, and for an actual blocking decision inside an interactive
session the agent still uses AskUserQuestion. `question` severity is
for "I've parked this and pinged you", not "I am now blocked on the
bot".

## Risks / Trade-offs

- **[Risk]** Agents over-notify (every minor event → a ping), training
  the user to ignore the bot.
  → **Mitigation**: the "When NOT to use" + anti-patterns sections lead
    with per-iteration spam and crying-wolf `error`. Severity gating
    keeps `error` rare.

- **[Risk]** An agent uses `question` and then blocks waiting for a
  reply that can't arrive.
  → **Mitigation**: D5 — the send-only framing is stated explicitly,
    and `question` is defined as "parked + pinged", not "blocked on
    bot".

- **[Trade-off]** The `--config` carve-out is a special case in an
  otherwise uniform "always `--project-root`" rule.
  → **Acknowledged**: it's documented in the spec as the sole sanctioned
    deviation, with the reason (notify has no project context).

## Migration Plan

Additive. New skill file + three small edits (index.ts, README,
rebuilt dist). No on-disk user data changes. Existing installs pick up
`memon-notify` on their next `memon install-skills` run.

Ordering: depends on `add-telegram-notify` (the CLI) being present.
Land/keep that change first, or archive both together.

## Open Questions

- **Should the skill recommend a default `--session` source per agent
  kind** (e.g. for Claude Code, the `/rename` value)? The runtime can't
  auto-detect it (D11 of the runtime change). For now the skill says
  "pass your session/conversation name"; a per-agent recipe can be
  added once we see how each agent exposes its own session label.
