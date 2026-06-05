## ADDED Requirements

### Requirement: `memon-notify` exists as a model-invocable push-notification skill

A bundled skill at `packages/skills/memon-notify/SKILL.md` SHALL exist.
It is a manual + thin wrapper for the `memon notify` CLI (the
`telegram-notify` capability). It SHALL be model-invocable (no
`disable-model-invocation` field, or `false`) because it performs a
single low-stakes side-effect (one HTTP POST, no disk writes) — the
same tier as `memon-append-journal` / `memon-append-warning`.

The skill body SHALL be in English (per the project language
convention), with any user-facing dialogue in Chinese inside `>` block
quotes.

The skill body SHALL document a **When to use** section that maps each
of the five severities to a concrete situation:

| severity | situation |
|---|---|
| `error` | a fatal / unrecoverable failure — the run crashed and the agent can't recover, or a fix it tried did not work |
| `warn` | stuck-but-running — a bug the agent has been circling without progress |
| `question` | a human judgment call the agent would otherwise raise via AskUserQuestion |
| `done` | a long task the user delegated then walked away from has finished AND been verified |
| `info` | a milestone worth surfacing that needs no action |

The skill body SHALL document a **When NOT to use** section that
includes at minimum: (a) the user is actively in the conversation —
just ask them; (b) per loop iteration / per step (one notification per
*significant* event); (c) as a durable log (that is
`memon-append-journal`); (d) routine exp-doc warnings (that is
`memon-append-warning`).

The skill body SHALL instruct the agent to ALWAYS pass `--agent` and
`--session` so the message footer is attributable, to pipe multi-line
markdown bodies via `--details-file -`, and to explain when `--soft`
is and is not appropriate (use it when a lost notification must not
break the agent's loop; omit it when delivery must be confirmed).

The skill body SHALL state that the bot is **send-only**: the agent
pushes and continues working; it does not block waiting for a reply.

The skill body SHALL list anti-patterns including at minimum:
per-iteration spam, crying-wolf `error` for non-fatal hiccups, dumping
a long log into `--title`, omitting `--session`, and echoing the bot
token (which lives in `config.yml` and is redacted from CLI errors).

#### Scenario: Skill exists with model-invocable frontmatter

- **WHEN** a reader inspects `packages/skills/memon-notify/SKILL.md`
- **THEN** the frontmatter has `name: memon-notify` and contains NO
  `disable-model-invocation: true` line (the field is absent or
  `false`)

#### Scenario: When-to-use covers all five severities

- **WHEN** a reader inspects the skill's "When to use" section
- **THEN** all five severities (`info`, `warn`, `error`, `question`,
  `done`) appear, each paired with a concrete situation

#### Scenario: Skill body language conventions

- **WHEN** a reader samples headings and paragraphs from the SKILL body
- **THEN** all sampled prose is in English
- **AND** any user-facing dialogue appears inside `>` block quotes in
  Chinese

#### Scenario: Examples pass --agent and --session

- **WHEN** a reader inspects the example `memon notify` invocations in
  the workflow body
- **THEN** each send-path example passes `--agent` and `--session`
  explicitly

## MODIFIED Requirements

### Requirement: Skill invocation policy split by risk tier

The bundled skills under `packages/skills/memon-*/` SHALL declare invocation control via the `disable-model-invocation` frontmatter field according to risk tier:

- Skills that perform multi-step disk writes, start long-running processes, or advance shared cursors SHALL set `disable-model-invocation: true` (user-invoked only). At archive time these are: `memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`, `memon-migrate-fs`.
- Skills that perform a single low-stakes append-only / fire-and-forget action MAY omit the field (model-invocable). At archive time these are: `memon-append-journal`, `memon-append-warning`, `memon-notify`.

The intent is: heavy work needs a human in the loop; "I noticed something worth recording" or "the user should be pinged about this" can fire on its own. `memon-migrate-fs` belongs to the heavy tier — it rewrites spec files across multiple version steps and creates git commits, so it MUST be user-invoked. `memon-notify` belongs to the light tier — a single Telegram POST with no disk side-effects.

#### Scenario: Heavy skill is user-invoked
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** it contains the line `disable-model-invocation: true`

#### Scenario: Migrate-fs is user-invoked
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-migrate-fs/SKILL.md`
- **THEN** it contains the line `disable-model-invocation: true`

#### Scenario: Append-journal allows model invocation
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-append-journal/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is `false`)

#### Scenario: Append-warning allows model invocation
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-append-warning/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is `false`)

#### Scenario: Notify allows model invocation
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-notify/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is `false`)

### Requirement: `--project-root` is always passed explicitly

Every `memon ...` invocation issued from a skill body SHALL pass `--project-root <path>` (or `--project-root .`) explicitly. Skills SHALL NOT rely on the CLI's implicit-cwd fallback. This forces every skill to be portable across the project's cwd / `config.yml` configurations and removes the silent-cwd-default class of bugs.

The sole exception is `memon notify`, which has no project context: it does not accept `--project-root` and instead resolves Telegram credentials from `--config <path>` (or the `MEMON_TELEGRAM_BOT_TOKEN` + `MEMON_TELEGRAM_CHAT_ID` env vars). The `memon-notify` skill's examples SHALL therefore pass `--config` (or rely on cwd `config.yml`) rather than `--project-root`; this is the only sanctioned skill-body deviation from the rule above.

#### Scenario: Append-journal example uses --project-root
- **WHEN** reviewing the example invocation in `packages/skills/memon-append-journal/SKILL.md`
- **THEN** the command includes `--project-root .` (or `--project-root <path>`) explicitly

#### Scenario: Notify is the sanctioned exception
- **WHEN** reviewing the example invocations in `packages/skills/memon-notify/SKILL.md`
- **THEN** the `memon notify` commands do NOT pass `--project-root` (the flag is rejected by that subcommand) and instead pass `--config <path>` or rely on a cwd `config.yml`

### Requirement: Doctor checks fold into memon-digest-journal; no standalone memon-doctor skill

There SHALL NOT be a standalone `memon-doctor` skill. Doctor checks (running the `memon doctor` CLI + walking the user through fixes) SHALL be performed inside `memon-digest-journal`'s workflow, before the cursor advance. The `memon doctor` CLI command itself is preserved for ad-hoc checks but no longer has a dedicated skill wrapper.

The rationale: integrity-sweep and cursor-advance share a natural commit point. Splitting them creates a "ran doctor, fixed things, forgot to digest" failure mode.

#### Scenario: digest-journal includes the doctor sweep
- **WHEN** reviewing `packages/skills/memon-digest-journal/SKILL.md` workflow
- **THEN** it includes a step that runs `memon doctor --project-root . --format json` and walks the user through each issue with the 7 doctor codes

#### Scenario: No memon-doctor skill on disk
- **WHEN** listing `packages/skills/memon-*` directories
- **THEN** there is no `memon-doctor/` subdirectory
- **AND** the only `memon-*` subdirectories present are the ten bundled skills (`memon-drive`, `memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`, `memon-migrate-fs`, `memon-append-journal`, `memon-append-warning`, `memon-notify`)
