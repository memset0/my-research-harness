## MODIFIED Requirements

### Requirement: Skill invocation policy split by risk tier

The bundled skills under `packages/skills/memon-*/` SHALL declare invocation control via the `disable-model-invocation` frontmatter field according to risk tier:

- Skills that perform multi-step disk writes, start long-running processes, or advance shared cursors SHALL set `disable-model-invocation: true` (user-invoked only). At archive time these are: `memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`.
- Skills that perform a single low-stakes append-only action MAY omit the field (model-invocable). At archive time these are: `memon-append-journal`, `memon-append-warning`.

The intent is: heavy work needs a human in the loop; "I noticed something worth recording" can fire on its own.

#### Scenario: Heavy skill is user-invoked
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** it contains the line `disable-model-invocation: true`

#### Scenario: Append-journal allows model invocation
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-append-journal/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is `false`)

#### Scenario: Append-warning allows model invocation
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-append-warning/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is `false`)

## ADDED Requirements

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
