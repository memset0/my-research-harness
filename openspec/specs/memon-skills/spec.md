# memon-skills Specification

## Purpose
TBD - created by archiving change add-skills-cli. Update Purpose after archive.
## Requirements
### Requirement: Skill invocation policy split by risk tier

The bundled skills under `packages/skills/memon-*/` SHALL declare invocation
control via the `disable-model-invocation` frontmatter field according to their
confirmation boundary. `memon-migrate-fs` SHALL set
`disable-model-invocation: true` because it rewrites the full project convention
and can create migration commits. Every other bundled skill MAY omit the field
and be selected when its description matches, while still obeying the
confirmation rules documented in its body.

At archive time the model-invocable set is `memon-drive`,
`memon-write-experiment-doc`, `memon-write-script`, `memon-run-experiment`,
`memon-append-journal`, `memon-digest-journal`, `memon-write-report`,
`memon-write-code-review`, and `memon-propose`.

#### Scenario: Run-experiment allows model invocation

- **WHEN** a reader inspects the frontmatter of
  `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is
  `false`)

#### Scenario: Migrate-fs is user-invoked

- **WHEN** a reader inspects the frontmatter of
  `packages/skills/memon-migrate-fs/SKILL.md`
- **THEN** it contains the line `disable-model-invocation: true`

#### Scenario: Append-journal allows model invocation

- **WHEN** a reader inspects the frontmatter of
  `packages/skills/memon-append-journal/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is
  `false`)

### Requirement: `--project-root` is always passed explicitly

Every `memon ...` invocation issued from a skill body SHALL pass
`--project-root <path>` (or `--project-root .`) explicitly. Skills SHALL NOT rely
on the CLI's implicit-cwd fallback. This forces every skill to be portable
across project cwd and configuration layouts and removes the
silent-cwd-default class of bugs.

#### Scenario: Append-journal example uses --project-root

- **WHEN** reviewing the example invocation in
  `packages/skills/memon-append-journal/SKILL.md`
- **THEN** the command includes `--project-root .` (or
  `--project-root <path>`) explicitly

### Requirement: mtime optimistic locking discipline

Any skill that writes `README.md` SHALL: (a) fetch the current mtime via `memon show <id> --format json` (or capture it from a prior write's response) immediately before writing; (b) pass it as `--expected-mtime`; (c) capture the returned mtime from the write response and use it as the input to the next write in the same logical operation; (d) on exit code 9 (CONFLICT), refresh the mtime and either retry once or surface to the user. Skills SHALL NOT use a `--force` style override to bypass mtime conflicts silently.

#### Scenario: Conflict refresh path documented
- **WHEN** reading the conflict-handling section of `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** the protocol explicitly: reads fresh mtime, attempts write, on exit 9 refreshes mtime + re-merges intent, retries once, surfaces to user on second conflict

#### Scenario: Digest-journal helper enforces mtime discipline
- **WHEN** reading `packages/skills/memon-digest-journal/SKILL.md`'s `fix_readme()` shell helper
- **THEN** the helper fetches fresh mtime via `memon show` before calling `memon experiment readme write` and propagates the new mtime on success

### Requirement: JOURNAL frontmatter is writable only via digest-mark

Skills SHALL update `docs/journal.md` frontmatter (specifically `last_digest_at`) only via `memon journal digest-mark`. No other skill SHALL touch the frontmatter. Skills MAY only `memon journal append` event lines to the body.

#### Scenario: append-journal does not touch frontmatter
- **WHEN** reviewing `packages/skills/memon-append-journal/SKILL.md`
- **THEN** the document states explicitly that the skill never modifies `docs/journal.md` frontmatter, only appends event lines

#### Scenario: digest-journal is the only cursor-advancer
- **WHEN** reviewing `packages/skills/memon-digest-journal/SKILL.md`
- **THEN** the document is described as "the **only** skill that updates `last_digest_at`" and is the sole skill that calls `memon journal digest-mark`

### Requirement: Doctor checks fold into memon-digest-journal; no standalone memon-doctor skill

There SHALL NOT be a standalone `memon-doctor` skill. Doctor checks (running the
`memon doctor` CLI and walking the user through fixes) SHALL be performed inside
`memon-digest-journal`'s workflow before the cursor advance. The `memon doctor`
CLI command itself is preserved for ad-hoc checks but no longer has a dedicated
skill wrapper.

The rationale is that integrity-sweep and cursor-advance share a natural commit
point. Splitting them creates a "ran doctor, fixed things, forgot to digest"
failure mode.

#### Scenario: digest-journal includes the doctor sweep

- **WHEN** reviewing `packages/skills/memon-digest-journal/SKILL.md` workflow
- **THEN** it includes a step that runs
  `memon doctor --project-root . --format json` and walks the user through each
  issue with the documented doctor codes

#### Scenario: Bundled skill inventory excludes removed wrappers

- **WHEN** listing `packages/skills/memon-*` directories
- **THEN** there is no `memon-doctor/`, `memon-append-warning/`, or
  `memon-notify/` subdirectory
- **AND** the only bundled directories are `memon-drive`,
  `memon-write-experiment-doc`, `memon-write-script`,
  `memon-run-experiment`, `memon-append-journal`, `memon-digest-journal`,
  `memon-write-report`, `memon-write-code-review`, `memon-propose`, and
  `memon-migrate-fs`

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

### Requirement: `memon-write-code-review` exists as a model-invocable code-review authoring skill

A bundled skill at `packages/skills/memon-write-code-review/SKILL.md` SHALL
exist. It authors a single code-review doc per invocation at
`<projectRoot>/docs/code-review/<YYYY-MM-DD>-<slug>.md` (project-wide) or
`<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md`
(experiment-scoped). It SHALL be model-invocable (no
`disable-model-invocation: true` field, or `false`) — one low-stakes markdown
write, the same tier as `memon-write-report`. The skill body SHALL be English
with any user-facing dialogue in Chinese inside `>` block quotes.

The skill body SHALL document the frontmatter contract the runtime parses:
`title`, `description`, `experiment` (`E<NNNN>-<slug>` or null), `created_at` /
`updated_at` (ISO8601 with timezone offset), `commits[]` (each `repo`, `sha`,
`url`, optional `subject`, and `reviewed`), and `review_todolist[]` (each `item`
and `done`). It SHALL state that completion is derived (the human checks the
boxes in the dashboard) and that the agent writes every `reviewed` / `done` flag
as `false`.

The skill body SHALL give a submodule-aware recipe for the per-commit `url` and
for in-body line-level permalinks: each link uses the owner/repo and `sha` of the
repo the file lives in (the main repo or the specific submodule), with the
`<path>` relative to that repo's root; the commit URL is `…/commit/<sha>` and the
line permalink is `…/blob/<sha>/<path>#L<a>-L<b>`.

The skill body SHALL document the body template: `## Requirement`,
`## Changes`, `## Verification`, `## Notes`, with each change in `## Changes`
titled in Conventional Commits style and carrying the H4 subsections
Deliverables, Design Decisions, Analysis, Verification, and Details (write
"None" when empty). It SHALL instruct: `Analysis` is a complete, end-to-end
walk-through of the change (substantial, not one or two lines) that weaves
together essential code excerpts, line-level permalinks, pseudocode, and math
(`$…$` / `$$…$$`); keep raw code minimal (link full code via permalink, never
paste whole files) without shortening the walk-through; go deep on the "why" in
`Design Decisions` (underlying root cause and relevant math); label pseudocode
with a sentence before the fenced block. It SHALL instruct the agent to consult
the user via AskUserQuestion (or a plain question where that tool is
unavailable) when the change-split granularity is ambiguous, and SHALL frame the
sections as angles to consider rather than a rigid template (omit what does not
apply; extra content is allowed).

The skill SHALL preflight-check the FS convention version per
`../PREFLIGHT.md`, and SHALL appear in `packages/skills/README.md` (the
skill-selection matrix and the files-written table).

After successfully writing the document, the skill SHALL tell the user in the
active conversation that the code-review is ready and include the created or
updated path. Completion SHALL NOT depend on an out-of-band notification
command or transport.

#### Scenario: Skill exists with model-invocable frontmatter

- **WHEN** a reader inspects
  `packages/skills/memon-write-code-review/SKILL.md`
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
  repo's root for both the `/commit/<sha>` and
  `blob/<sha>/<path>#L<a>-L<b>` forms

#### Scenario: Body template with conventional-commit change titles and five subsections

- **WHEN** a reader inspects the body template
- **THEN** the sections Requirement / Changes / Verification / Notes appear,
  and each change carries the five H4 subsections (Deliverables, Design
  Decisions, Analysis, Verification, Details)

#### Scenario: Listed in the skills index

- **WHEN** a reader inspects `packages/skills/README.md`
- **THEN** `memon-write-code-review` appears in the skill-selection matrix and
  in the files-written table

#### Scenario: Skill body language conventions

- **WHEN** a reader samples headings and paragraphs from the skill body
- **THEN** all sampled prose is in English, and any user-facing dialogue appears
  in Chinese inside `>` block quotes

#### Scenario: Code-review completion is conversational

- **WHEN** `memon-write-code-review` finishes writing a doc
- **THEN** the agent tells the user in the active conversation that the review
  is ready and provides its path
- **AND** no notification command is invoked

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

### Requirement: Drive coordinates all Experiment work through a dedicated writer skill

`memon-drive` SHALL read the v6 bundle, distinguish engineering work from empirical investigation, define Variants before launching Runs, and invoke `memon-write-experiment-doc` for every Experiment semantic write. The writer SHALL directly edit README/YAML and validate afterward; it SHALL NOT require item-level mutation CLI commands.

Before a run, drive SHALL decide from the user's intent whether Variant-table approval is required. Explicit autonomous delegation permits immediate creation/execution; collaborative design prompts require a proposed Markdown table and confirmation. In all cases, the Variant exists before launch.

#### Scenario: Autonomous experiment still records Variant first
- **GIVEN** the user explicitly delegates autonomous experimental choices
- **WHEN** drive launches a run
- **THEN** the corresponding Variant is already present in `results.yaml`

### Requirement: Warning skill is removed while CLI compatibility remains

The bundled skill inventory SHALL NOT contain `memon-append-warning`. Official skills SHALL route Warning updates through `memon-write-experiment-doc`. Existing warning CLI commands remain functional indefinitely and print a deprecation notice on every invocation.

#### Scenario: Installed skill set removes warning skill
- **WHEN** `memon install-skills` synchronizes v6 skills
- **THEN** no `memon-append-warning` directory remains in the target

### Requirement: `memon-write-report` coordinates optional external visualization skills within one view namespace

After the user explicitly requests an HTML/interactive Report,
`memon-write-report` MAY invoke a suitable visualization skill already installed
for the project. Delegation is optional and SHALL NOT install or require one
particular external skill or frontend framework. `memon-write-report` remains
the coordinator and owner of the Report ID, frontmatter, evidence claims,
`README.md` narrative/composition, and final user handoff.

Before invoking the delegate, the writer SHALL allocate one unused lowercase
kebab-case `views/<slug>/` namespace and provide the exact write path,
visualization objective, selected inputs, source-attribution requirements,
static-output/relative-URL/JSON rules, and mobile/desktop acceptance criteria.
The writer SHALL extract normalized evidence into root `data/*.json` and expose
those paths to the delegate as read-only inputs. View-local JSON MAY describe UI
configuration but SHALL NOT duplicate or redefine the normalized evidence.
The external skill SHALL write only inside that allocated namespace. It SHALL
NOT modify the Report README/frontmatter, writer-owned root `data/`, other
bundle-root files, another view, or any other project path. It SHALL return its
produced paths and validation evidence to the writer.

After delegation, `memon-write-report` SHALL verify the write scope and output,
author the README embed itself, and either accept the view or request correction.
External-skill completion alone SHALL NOT constitute Report completion.

#### Scenario: Installed visualization skill contributes one view

- **GIVEN** the user explicitly requested an interactive Report and the current
  project Agent has a suitable visualization skill installed
- **WHEN** `memon-write-report` delegates a loss-curve view
- **THEN** it assigns an unused path such as `views/loss-curves/` and supplies
  the view contract plus writer-owned root JSON as read-only evidence
- **AND** the delegate returns static output only below that path
- **AND** `memon-write-report`, not the delegate, edits README.md to embed
  `./views/loss-curves/index.html`

#### Scenario: Delegate may not manage Report identity or narrative

- **GIVEN** a visualization delegate is writing `views/latency-comparison/`
- **WHEN** it completes its work
- **THEN** it has not modified README.md, frontmatter, the Report ID/slug, or any
  sibling view
- **AND** the writer checks this boundary before accepting the output

#### Scenario: No external skill is available

- **GIVEN** the user requested an HTML Report but no suitable external
  visualization skill is installed
- **WHEN** `memon-write-report` plans the work
- **THEN** the Report may still be authored directly under the same static
  output and acceptance rules
- **AND** the absence of a delegate does not change the explicit-user-only HTML
  representation rule

### Requirement: `memon-write-report` performs final static, mobile, and desktop acceptance

Before reporting an HTML bundle complete, `memon-write-report` SHALL open each
new or changed view through the same Report asset route used by the dashboard.
It SHALL verify local fetch/import/image/font URLs and MIME types, writer-owned
root JSON data separation and read-only consumption, source attribution,
understandable loading/empty/error fallback text, and the absence of absolute
local paths or read-time server/build dependencies.

The writer SHALL test the rendered Report at exactly 390 CSS pixels wide and at
a representative desktop width of at least 1280 CSS pixels. At 390px, content
and primary controls SHALL not be page-clipped or overlap, text SHALL remain
readable, and every data dimension SHALL remain reachable through responsive
layout or intentional internal scroll/pan. At desktop width, content and
controls SHALL remain unclipped and use the available space legibly. At both
widths, the writer SHALL verify the host wrapper's Retry, Open in new tab, and
fullscreen actions are reachable.

Any unresolved failure or desktop-only limitation SHALL be reported rather than
silently accepted. These checks do not introduce a manifest or iframe
auto-height protocol.

#### Scenario: 390px acceptance catches a desktop-only view

- **GIVEN** a delegated visualization whose legend covers its controls at a
  390px viewport
- **WHEN** `memon-write-report` performs final acceptance
- **THEN** the writer does not report the Report complete
- **AND** it requests a responsive correction or reports the remaining
  limitation to the user

#### Scenario: Static portable view passes final acceptance

- **GIVEN** a view whose local assets and writer-owned root JSON resolve through
  the Report route and whose layout is usable at 390px and at least 1280px
- **WHEN** Retry, Open in new tab, fullscreen, attribution, and fallback checks
  also pass
- **THEN** `memon-write-report` may compose it into README.md and deliver the
  final Report handoff

