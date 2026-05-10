## MODIFIED Requirements

### Requirement: Spec-mutating skills SHALL preflight-check the FS convention version

Every memon skill that reads or writes spec files (the per-experiment `<runDir>/README.md`, the project's `<projectRoot>/docs/hypotheses.md`, `<projectRoot>/docs/journal.md`, or any file under `<projectRoot>/docs/digests/` or `<projectRoot>/docs/reports/`) SHALL invoke `memon fs-version check --project-root <p> --format json` as the first executable step in its workflow body, parse the result, and bail on any status other than `match`. The four-status protocol (`match` / `behind` / `uninitialised` / `ahead`) and the per-status user-facing recommendations SHALL be referenced from the canonical `packages/skills/PREFLIGHT.md` doc rather than re-stated inline in each skill body.

The skill body SHALL contain a condensed `## Preflight — FS convention version` section with the following shape (≤5 prose lines, English):

1. The imperative: "run `memon fs-version check --project-root . --format json` as the first step".
2. The bail rule: "if `status !== \"match\"`, STOP and follow the branch protocol".
3. A relative-path reference to `../PREFLIGHT.md` (the sibling-of-skill-dir layout that `memon install-skills` deposits per the `memon-cli` capability).
4. An enumeration of the four expected status values (`match`, `behind`, `uninitialised`, `ahead`) so the agent knows the closed enum without reading PREFLIGHT.md.

The pointer body SHALL be byte-equal across all seven affected skill files, so an agent reading any memon-* skill encounters the same preamble. The exact pointer text is canonicalised in the bundled skills' source; skills SHALL NOT diverge from it.

The following skills are subject to this requirement (matching the user-invoked skill set plus the model-invocable append-* skills):
- `memon-write-script` — writes launcher scripts (does not directly mutate spec files, but is part of the run-experiment workflow that does).
- `memon-run-experiment` — writes `<runDir>/README.md`.
- `memon-digest-journal` — reads `docs/journal.md`, writes digests, advances cursor.
- `memon-write-report` — writes report files under `docs/reports/`.
- `memon-propose` — writes proposal artifacts.
- `memon-append-journal` — appends event lines to `docs/journal.md`.
- `memon-append-warning` — appends warning rows to `<runDir>/README.md`.
- `memon-migrate-fs` itself is exempt from preflight (it IS the migration entry; it reads `.memon/version.json` directly as part of its own protocol). Its skill body does NOT contain a `## Preflight — FS convention version` section; it has a self-described exemption note instead.

#### Scenario: Skill body contains the condensed preflight pointer
- **WHEN** a reader inspects the workflow body of any of the seven listed spec-mutating skills
- **THEN** the body contains exactly one section titled `## Preflight — FS convention version`
- **AND** that section is at most 5 prose lines (excluding the heading and any blank line)
- **AND** the section's body executes `memon fs-version check --project-root . --format json` as an imperative
- **AND** the section's body instructs the agent to STOP on any non-`match` status
- **AND** the section's body references `../PREFLIGHT.md` by that relative path
- **AND** the section's body names all four status values (`match`, `behind`, `uninitialised`, `ahead`)

#### Scenario: Skill body does NOT inline the per-branch user-facing wording
- **WHEN** a reader inspects the preflight section of any of the seven affected SKILL.md files
- **THEN** the section does NOT contain the per-status user-facing recommendation text (e.g. "Project FS convention is at v…; current memon expects v…; please run the `memon-migrate-fs` skill")
- **AND** that wording lives in `packages/skills/PREFLIGHT.md` instead

#### Scenario: Pointer text is byte-equal across the seven skills
- **WHEN** a reader extracts the body of the `## Preflight — FS convention version` section from each of the seven spec-mutating skills
- **THEN** all seven extracted bodies are byte-equal to one another
