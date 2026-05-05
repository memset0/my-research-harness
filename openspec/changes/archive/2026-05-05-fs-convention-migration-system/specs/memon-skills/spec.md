## ADDED Requirements

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

## MODIFIED Requirements

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
