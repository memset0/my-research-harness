## MODIFIED Requirements

### Requirement: Numeric IDs are 4-digit zero-padded across all skill outputs

All numeric identifiers emitted by skills (hypothesis `H<NNNN>`, report `R<NNNN>`, wiki page `W<NNNN>`, and the legacy `R<NNNN>` / `D<NNNN>` forms preserved in a migrated page's `legacy_id`) SHALL use the canonical 4-digit zero-padded form per the `hypotheses` capability. Skills that compute `next_n + 1` SHALL format the result with `printf '%04d'` (or equivalent) before constructing the filename or id string. Skills SHALL NOT emit unpadded ids (`H1`, `D7`, `R42`, `W42`).

#### Scenario: Report filename uses %04d
- **WHEN** `memon-write-report` computes the next N as 42 with slug `bf16-investigation`
- **THEN** the filename is `R0042-bf16-investigation.md`, NOT `R42-bf16-investigation.md`

#### Scenario: Frontmatter hypothesis refs are padded
- **WHEN** `memon-run-experiment` writes a new run README and the user mentioned "this run tests hypothesis 3"
- **THEN** the frontmatter `hypotheses:` array contains `H0003`, NOT `H3`

#### Scenario: Wiki page id is padded
- **WHEN** `memon-wiki` refers to the page whose allocated number is 42
- **THEN** it writes the id as `W0042`, NOT `W42`

### Requirement: Spec-mutating skills SHALL preflight-check the FS convention version

Every memon skill that reads or writes spec files (the per-experiment `<runDir>/README.md`, the project's `<projectRoot>/docs/hypotheses.md`, `<projectRoot>/docs/journal.md`, or any file under `<projectRoot>/docs/reports/` or `<projectRoot>/docs/wiki/`) SHALL invoke `memon fs-version check --project-root <p> --format json` as the first executable step in its workflow body, parse the result, and branch as follows:

- `status === "match"`: proceed with the rest of the skill.
- `status === "behind"`: surface the gap to the user (current version, expected version), recommend invoking `memon-migrate-fs`, and stop. The skill SHALL NOT proceed to read or write any spec file.
- `status === "uninitialised"`: surface that `<projectRoot>/.memon/version.json` is absent and recommend running `memon install-skills` first. The skill SHALL stop.
- `status === "ahead"`: the CLI subcommand has already exited `MEMON_TOO_OLD`; the skill SHALL forward this error to the user and stop.

This preflight section SHALL appear in the skill body using consistent language across skills, so that an agent reading any memon-* skill encounters the same preamble shape. The exact preamble text is canonicalised in the bundled skills' source; skills SHALL NOT diverge from it.

The following skills are subject to this requirement (matching the user-invoked skill set plus the model-invocable append-* skills):
- `memon-write-script` — writes launcher scripts (does not directly mutate spec files, but is part of the run-experiment workflow that does).
- `memon-run-experiment` — writes `<runDir>/README.md`.
- `memon-write-report` — writes report files under `docs/reports/`.
- `memon-wiki` — writes wiki pages under `docs/wiki/`.
- `memon-propose` — writes proposal artifacts.
- `memon-append-warning` — appends warning rows to `<runDir>/README.md`.
- `memon-migrate-fs` itself is exempt from preflight (it IS the migration entry; it reads `.memon/version.json` directly as part of its own protocol).

A skill that must first establish *how* it reaches the project (for example `memon-wiki`, which detects whether it operates in-project or through an sshfs mount and derives the `memon` invocation channel from that) MAY place that non-mutating detection step ahead of the preflight, provided the preflight call is still the first `memon` invocation and no spec file is read or written before it resolves.

#### Scenario: Skill body contains the preflight preamble
- **WHEN** a reader inspects the workflow body of any of the six listed skills
- **THEN** the very first numbered step (or a section labelled "Preflight") executes `memon fs-version check --project-root <p> --format json`
- **AND** the step explicitly enumerates branches for `match` (proceed), `behind` (stop with migrate-fs recommendation), `uninitialised` (stop with install-skills recommendation), and `ahead` (stop with MEMON_TOO_OLD message)

### Requirement: Three narrative artifacts divide the project's prose surface

Reports SHALL remain theme-keyed snapshots authored by their Report skill. Wiki pages SHALL remain living, source-linked knowledge maintained by the Wiki skill. Historical Digests SHALL survive only as ordinary Wiki pages of kind `digest` (keeping their `D<NNNN>` identity in `legacy_id`) after the reviewed v7 migration; no standalone Digest surface, managed digest authoring skill or Journal cursor advancement SHALL be required. A writer SHALL stay within its owning artifact and preserve research history.

#### Scenario: Maintaining current knowledge
- **WHEN** accepted findings change
- **THEN** the writer updates the relevant Wiki and Experiment sources without generating a mandatory digest or advancing a Journal cursor
