# memon-skills Specification

## Purpose
TBD - created by archiving change add-skills-cli. Update Purpose after archive.
## Requirements
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

### Requirement: mtime optimistic locking discipline

Any skill that writes `README.md` SHALL: (a) fetch the current mtime via `memon show <id> --format json` (or capture it from a prior write's response) immediately before writing; (b) pass it as `--expected-mtime`; (c) capture the returned mtime from the write response and use it as the input to the next write in the same logical operation; (d) on exit code 9 (CONFLICT), refresh the mtime and either retry once or surface to the user. Skills SHALL NOT use a `--force` style override to bypass mtime conflicts silently.

#### Scenario: Conflict refresh path documented
- **WHEN** reading the conflict-handling section of `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** the protocol explicitly: reads fresh mtime, attempts write, on exit 9 refreshes mtime + re-merges intent, retries once, surfaces to user on second conflict

#### Scenario: Digest-journal helper enforces mtime discipline
- **WHEN** reading `packages/skills/memon-digest-journal/SKILL.md`'s `fix_readme()` shell helper
- **THEN** the helper fetches fresh mtime via `memon show` before calling `memon experiment readme write` and propagates the new mtime on success

### Requirement: README authorship is exclusive to memon-run-experiment

`<runDir>/README.md` (frontmatter and all body sections) SHALL be authored exclusively by `memon-run-experiment`. Launcher scripts produced by `memon-write-script` SHALL only `mkdir -p "$RUN_DIR"` and `tee -a "$RUN_DIR/run.log"`; they SHALL NOT touch `README.md` (no frontmatter, no body, no creation, no modification).

This separation keeps the script callable on a memon-less host and makes README content the responsibility of the agent (which knows experiment intent), not the script (which only knows how to launch).

#### Scenario: write-script templates do not write README
- **WHEN** reviewing every example template in `packages/skills/memon-write-script/SKILL.md` (Style A, Style B, Composability variants)
- **THEN** no template emits any operation against `README.md` (no `cat`, `echo`, `tee`, `cp`, `>`, `>>` targeting `README.md`)

#### Scenario: Anti-pattern explicitly forbids it
- **WHEN** reviewing `packages/skills/memon-write-script/SKILL.md` Anti-patterns section
- **THEN** it contains an explicit prohibition: "Writing `README.md` from the script. That's `memon-run-experiment`'s job"

### Requirement: JOURNAL frontmatter is writable only via digest-mark

Skills SHALL update `docs/journal.md` frontmatter (specifically `last_digest_at`) only via `memon journal digest-mark`. No other skill SHALL touch the frontmatter. Skills MAY only `memon journal append` event lines to the body.

#### Scenario: append-journal does not touch frontmatter
- **WHEN** reviewing `packages/skills/memon-append-journal/SKILL.md`
- **THEN** the document states explicitly that the skill never modifies `docs/journal.md` frontmatter, only appends event lines

#### Scenario: digest-journal is the only cursor-advancer
- **WHEN** reviewing `packages/skills/memon-digest-journal/SKILL.md`
- **THEN** the document is described as "the **only** skill that updates `last_digest_at`" and is the sole skill that calls `memon journal digest-mark`

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

### Requirement: Skill body is English; user-facing dialogue is Chinese

Every `packages/skills/memon-*/SKILL.md` instructional body (headings, paragraphs, list items, code-block comments) SHALL be written in English. Skills MAY embed Chinese strings as templates of what to *say* to the user during the conversation; those quoted Chinese examples MUST be visibly user-facing (e.g., enclosed in block quotes or backquotes) so the role distinction is unambiguous.

This convention reflects the broader project rule (codified in repo `CLAUDE.md`) that skills are agent-targeted artifacts (English) but human conversation is in Chinese.

#### Scenario: SKILL body is English
- **WHEN** sampling 5 random headings and 10 random paragraphs from any `memon-*/SKILL.md` instructional body
- **THEN** all sampled text is in English

#### Scenario: Embedded Chinese for user dialogue is explicit
- **WHEN** reviewing `memon-write-script/SKILL.md` "When you're done" section
- **THEN** Chinese-language example prompts appear inside `>` block quotes, distinguishing them as user-dialogue templates from the English instructional surround

### Requirement: Digests vs reports — date-keyed cursor-advancing vs theme-keyed cursor-independent

Two persistent narrative artifacts SHALL coexist in `<projectRoot>/docs/`:

- **Digests** at `docs/digests/D<NNNN>-<YYYY-MM-DD>.md`, written by `memon-digest-journal`. Date-keyed (one file per calendar date; same date appends, new date increments N). They SHALL advance the `last_digest_at` cursor exactly once per write. Coverage windows SHALL be strictly non-overlapping.
- **Reports** at `docs/reports/R<NNNN>-<slug>.md`, written by `memon-write-report`. Theme-keyed (slug describes the theme). They SHALL NOT advance the cursor. Multiple reports MAY overlap in time. They SHALL carry a re-runnable `selector` shell snippet in frontmatter so future invocations can detect new matching events without rebuilding the filter.

#### Scenario: Digest filename pattern
- **WHEN** `memon-digest-journal` writes the first digest of a project on 2026-05-04
- **THEN** the filename is `<projectRoot>/docs/digests/D0001-2026-05-04.md`

#### Scenario: Same-day re-invocation appends
- **WHEN** a digest has already been written today (`D0001-2026-05-04.md` exists) and `memon-digest-journal` runs again the same day
- **THEN** it appends a `## Update <ISO>` section to `D0001-2026-05-04.md`, does NOT create a new digest file, and advances the cursor to the new `INVOCATION_TIME`

#### Scenario: Report carries a selector
- **WHEN** `memon-write-report` writes a report
- **THEN** the frontmatter `selector:` block contains a multi-line bash snippet that re-runs to emit the matching JOURNAL events; the report does NOT call `memon journal digest-mark`

### Requirement: code.diff allowlist lives in project's CLAUDE.md

`memon-run-experiment`'s `code.diff` capture (§1.b of its workflow) SHALL filter the project's `git diff HEAD` against an **allowlist** of pathspecs. The allowlist SHALL be stored in the project's root `CLAUDE.md` under a heading `## code.diff allowlist`, one pathspec per line.

If the heading is absent on first run, the skill SHALL interactively seed it: inspect the project's actual file extensions via `git ls-files | sed -n 's/.*\.//p' | sort | uniq -c | sort -rn`, propose an allowlist (intersecting with the skill's default seed list), get user confirmation, and append the heading + agreed list to `CLAUDE.md`. Subsequent runs SHALL read the section directly without reprompting.

#### Scenario: Allowlist read from CLAUDE.md
- **WHEN** `memon-run-experiment` runs in a project whose `CLAUDE.md` contains a `## code.diff allowlist` section
- **THEN** the skill reads the section's pathspecs verbatim and uses each as `:(glob)**/<pat>` in `git diff -- ...`

#### Scenario: First-run seeds the allowlist
- **WHEN** `memon-run-experiment` runs in a project whose `CLAUDE.md` lacks a `## code.diff allowlist` heading
- **THEN** the skill: (a) inspects file extensions via `git ls-files`, (b) proposes a candidate allowlist to the user, (c) on confirmation, appends `## code.diff allowlist` plus the agreed pathspecs to `CLAUDE.md`, (d) proceeds with that list

### Requirement: Pre-launch environment + GPU sanity check

`memon-run-experiment` SHALL perform a quick (~2-second) environment + GPU sanity check before invoking the launcher script. The check SHALL include: `which python` + `python -V`, `python -c 'import torch; print(torch.cuda.is_available())'` (when the script is GPU-bound), and `nvidia-smi --query-gpu=index,memory.used,memory.total,utilization.gpu --format=csv,noheader`. The skill SHALL bail out and ask the user (NOT proceed to launch) when any of: `nvidia-smi` itself fails (driver missing); a requested GPU is already at >5% memory in use by another process; `python` is not found and the script does not include in-script `conda activate`.

#### Scenario: GPU contention bails out
- **WHEN** `nvidia-smi` reports another process holds >5% memory on a requested GPU
- **THEN** the skill stops, surfaces the conflict to the user, and does NOT invoke the launcher script

#### Scenario: Healthy environment proceeds
- **WHEN** the check finds Python present, CUDA available (when expected), and all requested GPUs idle
- **THEN** the skill proceeds to capture `code.diff` and launch the script

### Requirement: Numeric IDs are 4-digit zero-padded across all skill outputs

All numeric identifiers emitted by skills (hypothesis `H<NNNN>`, digest `D<NNNN>`, report `R<NNNN>`) SHALL use the canonical 4-digit zero-padded form per the `hypotheses` capability. Skills that compute `next_n + 1` SHALL format the result with `printf '%04d'` (or equivalent) before constructing the filename or id string. Skills SHALL NOT emit unpadded ids (`H1`, `D7`, `R42`).

#### Scenario: Digest filename uses %04d
- **WHEN** `memon-digest-journal` computes the next N as 7 and writes a new digest on 2026-05-04
- **THEN** the filename is `D0007-2026-05-04.md`, NOT `D7-2026-05-04.md`

#### Scenario: Report filename uses %04d
- **WHEN** `memon-write-report` computes the next N as 42 with slug `bf16-investigation`
- **THEN** the filename is `R0042-bf16-investigation.md`, NOT `R42-bf16-investigation.md`

#### Scenario: Frontmatter hypothesis refs are padded
- **WHEN** `memon-run-experiment` writes a new run README and the user mentioned "this run tests hypothesis 3"
- **THEN** the frontmatter `hypotheses:` array contains `H0003`, NOT `H3`

### Requirement: Spec-mutating skills SHALL preflight-check the FS convention version

Every memon skill that reads or writes spec files (the per-experiment `<runDir>/README.md`, the project's `<projectRoot>/docs/hypotheses.md`, `<projectRoot>/docs/journal.md`, or any file under `<projectRoot>/docs/digests/` or `<projectRoot>/docs/reports/`) SHALL invoke `memon fs-version check --project-root <p> --format json` as the first executable step in its workflow body, parse the result, and branch as follows:

- `status === "match"`: proceed with the rest of the skill.
- `status === "behind"`: surface the gap to the user (current version, expected version), recommend invoking `memon-migrate-fs`, and stop. The skill SHALL NOT proceed to read or write any spec file.
- `status === "uninitialised"`: surface that `<projectRoot>/.memon/version.json` is absent and recommend running `memon install-skills` first. The skill SHALL stop.
- `status === "ahead"`: the CLI subcommand has already exited `MEMON_TOO_OLD`; the skill SHALL forward this error to the user and stop.

This preflight section SHALL appear in the skill body using consistent language across skills, so that an agent reading any memon-* skill encounters the same preamble shape. The exact preamble text is canonicalised in the bundled skills' source; skills SHALL NOT diverge from it.

The following skills are subject to this requirement (matching the user-invoked skill set plus the model-invocable append-* skills):
- `memon-write-script` — writes launcher scripts (does not directly mutate spec files, but is part of the run-experiment workflow that does).
- `memon-run-experiment` — writes `<runDir>/README.md`.
- `memon-digest-journal` — reads `docs/journal.md`, writes digests, advances cursor.
- `memon-write-report` — writes report files under `docs/reports/`.
- `memon-propose` — writes proposal artifacts.
- `memon-append-journal` — appends event lines to `docs/journal.md`.
- `memon-append-warning` — appends warning rows to `<runDir>/README.md`.
- `memon-migrate-fs` itself is exempt from preflight (it IS the migration entry; it reads `.memon/version.json` directly as part of its own protocol).

#### Scenario: Skill body contains the preflight preamble
- **WHEN** a reader inspects the workflow body of any of the six listed skills
- **THEN** the very first numbered step (or a section labelled "Preflight") executes `memon fs-version check --project-root <p> --format json`
- **AND** the step explicitly enumerates branches for `match` (proceed), `behind` (stop with migrate-fs recommendation), `uninitialised` (stop with install-skills recommendation), and `ahead` (stop with MEMON_TOO_OLD message)

### Requirement: `memon-migrate-fs` is the seventh bundled skill

A new bundled skill `packages/skills/memon-migrate-fs/SKILL.md` SHALL exist alongside the existing six skills. Like the other heavy skills, it SHALL declare `disable-model-invocation: true` (user-invoked only). Its workflow body, language conventions, and `--project-root` discipline SHALL conform to the project-wide rules already in this spec (English body, embedded Chinese for user-facing dialogue, every `memon ...` invocation passes `--project-root` explicitly).

This skill is the only one that is exempt from the FS-version preflight requirement above (because it IS the migration runtime).

#### Scenario: Skill exists with correct frontmatter
- **WHEN** a reader inspects `packages/skills/memon-migrate-fs/SKILL.md`
- **THEN** the frontmatter contains `disable-model-invocation: true`
- **AND** every `memon ...` example in the body passes `--project-root .` (or `--project-root <p>`) explicitly

#### Scenario: Skill body language conventions
- **WHEN** a reader samples 5 random headings and 10 random paragraphs from the SKILL body
- **THEN** all sampled text is in English
- **AND** any user-facing dialogue (confirmation prompts) appears inside `>` block quotes in Chinese

### Requirement: `memon-append-warning` exists as a model-invocable single-row appender

A bundled skill at `packages/skills/memon-append-warning/SKILL.md` SHALL exist. The skill SHALL: (a) accept a target experiment id, a category from the closed enum, and a message; (b) call `memon experiment warning add <id> --project-root . --category <cat> --message <text>` exactly once; (c) on exit 9 CONFLICT, refresh and retry once; (d) surface to the user on second conflict. The skill body SHALL be in English per the existing language convention. It SHALL NOT call `memon experiment warning resolve|reopen|delete`.

#### Scenario: Skill calls warning add with --project-root
- **WHEN** a reader inspects the workflow body of `packages/skills/memon-append-warning/SKILL.md`
- **THEN** the example invocation is exactly `memon experiment warning add <id> --project-root . --category <cat> --message <text>`, includes `--project-root` explicitly, and contains a one-retry-on-CONFLICT branch

#### Scenario: Skill is forbidden from calling resolve/reopen/delete
- **WHEN** a reader greps `packages/skills/memon-append-warning/SKILL.md` for `warning resolve`, `warning reopen`, or `warning delete`
- **THEN** any occurrence is inside an explicitly-marked Anti-pattern block; the workflow body itself contains zero such occurrences

### Requirement: `memon-run-experiment` post-run anomaly review step

`memon-run-experiment` SHALL include a post-run anomaly review step that runs after the run README has been written. The step SHALL: (a) inspect `run.log`, wandb (if linked), and any explicit metric artifacts the run wrote; (b) for each finding the agent judges to require human adjudication, call `memon experiment warning add <id> --project-root . --category <cat> --message <text>`; (c) capture the new mtime returned by `add` and use it as input to subsequent writes within the same logical operation; (d) on CONFLICT, refresh mtime and retry once.

The skill body SHALL bound what qualifies as a warning: items with reproducibility risk, methodology drift, anomalous metrics, hardware noise, or a delta from a referenced baseline / paper. The skill body SHALL explicitly list anti-patterns: "every minor info note", "things the user already wrote in Caveats", "items that could be answered with a one-line journal append".

The skill SHALL NOT call `warning resolve`, `warning reopen`, or `warning delete` under any circumstance. State changes are human-only acts.

#### Scenario: Post-run review step appears after README write
- **WHEN** a reader inspects `packages/skills/memon-run-experiment/SKILL.md`'s workflow
- **THEN** there is a §7 (or equivalent terminal step) titled "post-run anomaly review" placed AFTER the README write step, and its example invocations call `memon experiment warning add` with `--project-root .` explicitly

#### Scenario: Run-experiment is forbidden from calling resolve/reopen/delete
- **WHEN** a reader greps `packages/skills/memon-run-experiment/SKILL.md` for `warning resolve`, `warning reopen`, or `warning delete`
- **THEN** any occurrence is inside an explicitly-marked Anti-pattern block

#### Scenario: Skill text bounds what qualifies as a warning
- **WHEN** a reader inspects the post-run review section
- **THEN** the text includes both a "what qualifies" paragraph (reproducibility / methodology / anomalous metrics / hardware noise / baseline-drift) and an explicit Anti-patterns list naming low-signal items the agent must NOT flag

### Requirement: `memon-digest-journal` doctor sweep walks per-experiment warning review

`memon-digest-journal`'s doctor sweep step SHALL walk a defined per-experiment warning-review scope: the union of (a) experiments whose `README.md` mtime falls inside the digest window OR whose status changed in the journal events being digested, AND (b) experiments that currently have at least one warning with `Status=OPEN` (regardless of mtime).

For each experiment in the scope, the agent SHALL review the run with full context (latest journal, baselines, comparison runs that landed during the window) and propose, to the user, EITHER (i) new warnings to append, OR (ii) existing OPEN warnings to flag for human attention. The agent SHALL NOT auto-append; it SHALL only append after explicit user confirmation per proposal.

The agent SHALL NOT call `warning resolve`, `warning reopen`, or `warning delete` under any circumstance during the sweep.

The sweep SHALL also surface `memon doctor`'s `WARN_UNRESOLVED` items as part of the same review pass (so the user sees both "new warnings I propose" and "still-open warnings from prior runs" in one walk).

#### Scenario: Sweep walks the (a)+(b) scope
- **WHEN** a reader inspects `packages/skills/memon-digest-journal/SKILL.md`'s doctor-sweep step
- **THEN** the text explicitly defines the scope as "(a) experiments touched in the digest window OR with a STATUS event in the digested events ∪ (b) experiments with at least one OPEN warning currently"

#### Scenario: Sweep proposes, never auto-applies
- **WHEN** a reader inspects the doctor-sweep step
- **THEN** the workflow surfaces proposed warnings to the user before any `memon experiment warning add` call, and the example dialogue shows the agent waiting for user confirmation per proposal

#### Scenario: Digest-journal is forbidden from resolve/reopen/delete
- **WHEN** a reader greps `packages/skills/memon-digest-journal/SKILL.md` for `warning resolve`, `warning reopen`, or `warning delete`
- **THEN** any occurrence is inside an explicitly-marked Anti-pattern block

### Requirement: AI authority on warnings is strictly append-only

Skills SHALL NOT invoke `memon experiment warning resolve`, `memon experiment warning reopen`, or `memon experiment warning delete`. State transitions and deletion of warning rows are human-only acts; the CLI exposes them so the human can perform them via the terminal or the web UI, but skills' workflow bodies SHALL NOT contain those invocations outside an explicit Anti-pattern block.

#### Scenario: Static check across all bundled skills
- **WHEN** a reader greps every `packages/skills/memon-*/SKILL.md` file for `warning resolve|warning reopen|warning delete`
- **THEN** every occurrence is inside an explicitly-marked Anti-pattern block; no occurrence appears in a workflow / example / instruction body

#### Scenario: Anti-pattern block names the rule
- **WHEN** a reader inspects the Anti-pattern section of `memon-run-experiment`, `memon-digest-journal`, or `memon-append-warning`
- **THEN** at least one bullet explicitly states "do NOT call `warning resolve`/`reopen`/`delete` — those are human acts"

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

### Requirement: `memon-write-code-review` exists as a model-invocable code-review authoring skill

A bundled skill at `packages/skills/memon-write-code-review/SKILL.md` SHALL
exist. It authors a single code-review doc per invocation at
`<projectRoot>/docs/code-review/<YYYY-MM-DD>-<slug>.md` (project-wide) or
`<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md`
(experiment-scoped). It SHALL be model-invocable (no `disable-model-invocation`
field, or `false`) — one low-stakes markdown write, the same tier as
`memon-write-report`. The skill body SHALL be English with any user-facing
dialogue in Chinese inside `>` block quotes.

The skill body SHALL document the frontmatter contract the runtime parses:
`title`, `description`, `experiment` (`E<NNNN>-<slug>` or null),
`created_at` / `updated_at` (ISO8601 with timezone offset), `commits[]` (each
`repo`, `sha`, `url`, optional `subject`, and `reviewed`), and
`review_todolist[]` (each `item` and `done`). It SHALL state that completion is
derived (the human checks the boxes in the dashboard) and that the agent writes
every `reviewed` / `done` flag as `false`.

The skill body SHALL give a submodule-aware recipe for the per-commit `url` and
for in-body line-level permalinks: each link uses the owner/repo and `sha` of
the repo the file lives in (the main repo or the specific submodule), with the
`<path>` relative to that repo's root; the commit URL is `…/commit/<sha>` and
the line permalink is `…/blob/<sha>/<path>#L<a>-L<b>`.

The skill body SHALL document the body template: `## Requirement`, `## Changes`,
`## Verification`, `## Notes`, with each change in `## Changes` titled in
Conventional Commits style and carrying the H4 subsections Deliverables, Design
Decisions, Analysis, Verification, and Details (write "None" when empty). It
SHALL instruct: `Analysis` is a complete, end-to-end walk-through of the change
(substantial, not one or two lines) that weaves together essential code
excerpts, line-level permalinks, pseudocode, and math (`$…$` / `$$…$$`); keep
raw code minimal (link full code via permalink, never paste whole files) without
shortening the walk-through; go deep on the "why" in `Design Decisions`
(underlying root cause + relevant math); label pseudocode with a sentence before
the fenced block. It SHALL instruct the agent
to consult the user via AskUserQuestion (or a plain question where that tool is
unavailable) when the change-split granularity is ambiguous, and SHALL frame the
sections as angles to consider rather than a rigid template (omit what does not
apply; extra content is allowed).

The skill SHALL preflight-check the FS convention version per `../PREFLIGHT.md`,
and SHALL appear in `packages/skills/README.md` (the skill-selection matrix and
the files-written table).

On a successful write the skill SHALL push a one-shot notification via the
`memon notify` CLI (the `memon-notify` skill) to tell the user a code-review is
ready: severity `done`, a title beginning with `[code-review]`, passing
`--agent` and `--session`. It is best-effort and runs after the doc is written —
if Telegram is not configured (`memon notify` exits 2) the skill SHALL surface
that once and proceed, never undoing or failing the already-written doc.

#### Scenario: Skill exists with model-invocable frontmatter

- **WHEN** a reader inspects `packages/skills/memon-write-code-review/SKILL.md`
- **THEN** the frontmatter has `name: memon-write-code-review` and contains no
  `disable-model-invocation: true` line (the field is absent or `false`)

#### Scenario: Documents both scope locations

- **WHEN** a reader inspects the file-naming section
- **THEN** both the project-wide `docs/code-review/` and the experiment-scoped
  `docs/experiments/E<NNNN>-<slug>/code-review/` locations appear, with the
  `<YYYY-MM-DD>-<slug>` filename shape

#### Scenario: Submodule-aware permalink recipe

- **WHEN** a reader inspects the GitHub-link guidance
- **THEN** it specifies per-repo owner/sha and a `<path>` relative to the owning
  repo's root for both the `/commit/<sha>` and `blob/<sha>/<path>#L<a>-L<b>` forms

#### Scenario: Body template with conventional-commit change titles and five subsections

- **WHEN** a reader inspects the body template
- **THEN** the sections Requirement / Changes / Verification / Notes appear, and
  each change carries the five H4 subsections (Deliverables, Design Decisions,
  Analysis, Verification, Details)

#### Scenario: Listed in the skills index

- **WHEN** a reader inspects `packages/skills/README.md`
- **THEN** `memon-write-code-review` appears in the skill-selection matrix and in
  the files-written table

#### Scenario: Skill body language conventions

- **WHEN** a reader samples headings and paragraphs from the skill body
- **THEN** all sampled prose is in English, and any user-facing dialogue appears
  in Chinese inside `>` block quotes

#### Scenario: Code-review completion notification

- **WHEN** `memon-write-code-review` finishes writing a doc
- **THEN** it issues a `memon notify` with severity `done` and a title beginning
  with `[code-review]`, passing `--agent` and `--session`, and a missing Telegram
  config is surfaced once rather than failing the write

### Requirement: `memon-drive` offers a code-review when a reviewable change lands

The `memon-drive` orchestrator skill SHALL, after a Plan item completes whose
work was a non-trivial code change (a feature, fix, or refactor that landed as
one or more commits) and that has not already been written up, proactively ask
the user whether to capture it as a code-review doc and, on assent, hand off to
`memon-write-code-review` scoped to the current experiment. It SHALL ask once per
reviewable unit (not per commit) and SHALL skip runs / sweeps that produced
results but no code change. `memon-write-code-review` SHALL be listed among
`memon-drive`'s sub-tools.

#### Scenario: Offer fires after a code change, not after a results-only run

- **WHEN** a `memon-drive` Plan item that landed code commits completes
- **THEN** the orchestrator asks the user whether to generate a code-review and,
  on yes, invokes `memon-write-code-review`
- **AND** a Plan item that produced only run results (no code change) gets no offer

#### Scenario: Code-review is a listed sub-tool

- **WHEN** a reader inspects the `memon-drive` skill body
- **THEN** `memon-write-code-review` appears among its sub-tools

