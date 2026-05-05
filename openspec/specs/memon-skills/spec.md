# memon-skills Specification

## Purpose
TBD - created by archiving change add-skills-cli. Update Purpose after archive.
## Requirements
### Requirement: Skill invocation policy split by risk tier

The bundled skills under `packages/skills/memon-*/` SHALL declare invocation control via the `disable-model-invocation` frontmatter field according to risk tier:

- Skills that perform multi-step disk writes, start long-running processes, or advance shared cursors SHALL set `disable-model-invocation: true` (user-invoked only). At archive time these are: `memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`, `memon-migrate-fs`.
- Skills that perform a single low-stakes append-only action MAY omit the field (model-invocable). At archive time only `memon-append-journal` qualifies.

The intent is: heavy work needs a human in the loop; "I noticed something worth recording" can fire on its own. `memon-migrate-fs` belongs to the heavy tier — it rewrites spec files across multiple version steps and creates git commits, so it MUST be user-invoked.

#### Scenario: Heavy skill is user-invoked
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** it contains the line `disable-model-invocation: true`

#### Scenario: Migrate-fs is user-invoked
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-migrate-fs/SKILL.md`
- **THEN** it contains the line `disable-model-invocation: true`

#### Scenario: Append-journal allows model invocation
- **WHEN** a reader inspects the frontmatter of `packages/skills/memon-append-journal/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is `false`)

### Requirement: `--project-root` is always passed explicitly

Every `memon ...` invocation issued from a skill body SHALL pass `--project-root <path>` (or `--project-root .`) explicitly. Skills SHALL NOT rely on the CLI's implicit-cwd fallback. This forces every skill to be portable across the project's cwd / `config.yml` configurations and removes the silent-cwd-default class of bugs.

#### Scenario: Append-journal example uses --project-root
- **WHEN** reading the workflow example in `packages/skills/memon-append-journal/SKILL.md`
- **THEN** every `memon journal append` invocation in the example includes `--project-root .`

#### Scenario: Run-experiment captures fresh mtime with --project-root
- **WHEN** reading `packages/skills/memon-run-experiment/SKILL.md` §6 (write README)
- **THEN** the `memon show <id> --format json` and `memon experiment readme write <id>` examples both include `--project-root .`

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

Skills SHALL update `JOURNAL.md` frontmatter (specifically `last_digest_at`) only via `memon journal digest-mark`. No other skill SHALL touch the frontmatter. Skills MAY only `memon journal append` event lines to the body.

#### Scenario: append-journal does not touch frontmatter
- **WHEN** reviewing `packages/skills/memon-append-journal/SKILL.md`
- **THEN** the document states explicitly that the skill never modifies JOURNAL frontmatter, only appends event lines

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
- **AND** the only `memon-*` subdirectories present are the seven listed in the invocation-policy requirement above (`memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`, `memon-migrate-fs`, `memon-append-journal`)

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

Every memon skill that reads or writes spec files (the project root's `README.md`, `HYPOTHESES.md`, `JOURNAL.md`, or any file under `<projectRoot>/docs/digests/` or `<projectRoot>/docs/reports/`) SHALL invoke `memon fs-version check --project-root <p> --format json` as the first executable step in its workflow body, parse the result, and branch as follows:

- `status === "match"`: proceed with the rest of the skill.
- `status === "behind"`: surface the gap to the user (current version, expected version), recommend invoking `memon-migrate-fs`, and stop. The skill SHALL NOT proceed to read or write any spec file.
- `status === "uninitialised"`: surface that `<projectRoot>/.memon/version.json` is absent and recommend running `memon install-skills` first. The skill SHALL stop.
- `status === "ahead"`: the CLI subcommand has already exited `MEMON_TOO_OLD`; the skill SHALL forward this error to the user and stop.

This preflight section SHALL appear in the skill body using consistent language across skills, so that an agent reading any memon-* skill encounters the same preamble shape. The exact preamble text is canonicalised in the bundled skills' source; skills SHALL NOT diverge from it.

The following skills are subject to this requirement (matching the user-invoked skill set plus the model-invocable journal-append):
- `memon-write-script` — writes launcher scripts (does not directly mutate spec files, but is part of the run-experiment workflow that does).
- `memon-run-experiment` — writes `<runDir>/README.md`.
- `memon-digest-journal` — reads JOURNAL, writes digests, advances cursor.
- `memon-write-report` — writes report files under `docs/reports/`.
- `memon-propose` — writes proposal artifacts.
- `memon-append-journal` — appends event lines to `JOURNAL.md`.
- `memon-migrate-fs` itself is exempt from preflight (it IS the migration entry; it reads `.memon/version.json` directly as part of its own protocol).

#### Scenario: Skill body contains the preflight preamble
- **WHEN** a reader inspects the workflow body of any of the six listed skills
- **THEN** the very first numbered step (or a section labelled "Preflight") executes `memon fs-version check --project-root <p> --format json`
- **AND** the step explicitly enumerates branches for `match` (proceed), `behind` (stop with migrate-fs recommendation), `uninitialised` (stop with install-skills recommendation), and `ahead` (stop with MEMON_TOO_OLD message)

#### Scenario: Behind status halts spec mutation
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 1` and the bundled `FS_CONVENTION_VERSION === 2`
- **WHEN** `memon-run-experiment` is invoked against `<root>`
- **THEN** the skill's preflight reports `status: "behind"`
- **AND** the skill stops without writing `<runDir>/README.md` or any other spec file
- **AND** the user is told to run `memon-migrate-fs` first

#### Scenario: Uninitialised status halts and points to install-skills
- **GIVEN** `<root>` has no `.memon/version.json`
- **WHEN** `memon-append-journal` is invoked against `<root>`
- **THEN** the skill's preflight reports `status: "uninitialised"`
- **AND** the skill stops without appending to `JOURNAL.md`
- **AND** the user is told to run `memon install-skills` first

#### Scenario: migrate-fs is exempt from preflight
- **WHEN** a reader inspects `packages/skills/memon-migrate-fs/SKILL.md`
- **THEN** the body does NOT call `memon fs-version check`
- **AND** the body reads `<root>/.memon/version.json` directly as part of its own state-determination step

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

