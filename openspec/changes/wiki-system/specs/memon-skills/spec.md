## ADDED Requirements

### Requirement: Three narrative artifacts divide the project's prose surface

Three persistent narrative artifacts SHALL coexist in `<projectRoot>/docs/`, each with a distinct key, cursor obligation, and owning skill:

- **Digests** at `docs/digests/D<NNNN>-<YYYY-MM-DD>.md`, written by `memon-digest-journal`. Date-keyed, cursor-advancing, non-overlapping coverage windows. Role: what happened in a bounded time window.
- **Reports** at `docs/reports/R<NNNN>-<slug>.md` (or the bundle form), written by `memon-write-report`. Theme-keyed, cursor-independent, `selector`-bearing, written once per theme. Role: a snapshot narrative of one theme at one point in time. Unchanged by this change.
- **Wiki pages** at `docs/wiki/<kind>/<slug>.md` (or `docs/wiki/<kind>/<slug>/README.md` in bundle form), maintained by `memon-wiki`. Kind- and theme-keyed (the directory classifies the page, the slug names the theme) and continuously updated rather than written once. They SHALL NOT advance the cursor, MAY cover any time range and overlap freely, and SHALL declare the artifacts they rely on in the frontmatter `sources` list so the system can derive staleness and backlinks. They SHALL NOT carry a journal `selector`; only a `meeting` page is date-bearing, through its `date` frontmatter key. Role: living knowledge that co-evolves with the Experiments it cites.

A skill SHALL NOT write outside the artifact it owns: `memon-wiki` SHALL NOT write digests or reports, and `memon-digest-journal` / `memon-write-report` SHALL NOT write wiki pages. Choosing between a report and a wiki page is an editorial decision made with the user: a one-off snapshot narrative stays a report, knowledge that will be revisited becomes a wiki page.

#### Scenario: Wiki page declares sources and leaves the cursor alone
- **WHEN** `memon-wiki` creates or updates a page
- **THEN** the frontmatter `sources` list names the Experiments, Variants, run directories, Hypotheses, or wiki pages the page relies on, and the skill does NOT call `memon journal digest-mark`

#### Scenario: A page is revisited instead of superseded
- **GIVEN** an existing `finding` page whose claim gained new evidence
- **WHEN** `memon-wiki` records that evidence
- **THEN** it updates the same page (body, `sources`, `updated_at`) rather than creating a second page for the same theme

#### Scenario: Reports remain a first-class artifact
- **WHEN** the user asks for a theme snapshot and `memon-write-report` runs
- **THEN** it writes under `docs/reports/` with its `selector` frontmatter as before, and no wiki page is created as a side effect

#### Scenario: Artifact ownership is not crossed
- **WHEN** a reader inspects the `memon-wiki` skill body
- **THEN** it states that the skill writes only under `docs/wiki/` and never writes digests, journal frontmatter, or reports

## MODIFIED Requirements

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
`memon-wiki`, `memon-write-code-review`, and `memon-propose`.

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

#### Scenario: Wiki allows model invocation

- **WHEN** a reader inspects the frontmatter of
  `packages/skills/memon-wiki/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is
  `false`)

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
  `memon-write-report`, `memon-wiki`, `memon-write-code-review`,
  `memon-propose`, and `memon-migrate-fs`

### Requirement: Numeric IDs are 4-digit zero-padded across all skill outputs

All numeric identifiers emitted by skills (hypothesis `H<NNNN>`, digest `D<NNNN>`, report `R<NNNN>`, wiki page `W<NNNN>`, and the legacy `R<NNNN>` form preserved in a migrated page's `legacy_id`) SHALL use the canonical 4-digit zero-padded form per the `hypotheses` capability. Skills that compute `next_n + 1` SHALL format the result with `printf '%04d'` (or equivalent) before constructing the filename or id string. Skills SHALL NOT emit unpadded ids (`H1`, `D7`, `R42`, `W42`).

#### Scenario: Digest filename uses %04d
- **WHEN** `memon-digest-journal` computes the next N as 7 and writes a new digest on 2026-05-04
- **THEN** the filename is `D0007-2026-05-04.md`, NOT `D7-2026-05-04.md`

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

Every memon skill that reads or writes spec files (the per-experiment `<runDir>/README.md`, the project's `<projectRoot>/docs/hypotheses.md`, `<projectRoot>/docs/journal.md`, or any file under `<projectRoot>/docs/digests/`, `<projectRoot>/docs/reports/`, or `<projectRoot>/docs/wiki/`) SHALL invoke `memon fs-version check --project-root <p> --format json` as the first executable step in its workflow body, parse the result, and branch as follows:

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
- `memon-wiki` — writes wiki pages under `docs/wiki/`.
- `memon-propose` — writes proposal artifacts.
- `memon-append-journal` — appends event lines to `docs/journal.md`.
- `memon-append-warning` — appends warning rows to `<runDir>/README.md`.
- `memon-migrate-fs` itself is exempt from preflight (it IS the migration entry; it reads `.memon/version.json` directly as part of its own protocol).

A skill that must first establish *how* it reaches the project (for example `memon-wiki`, which detects whether it operates in-project or through an sshfs mount and derives the `memon` invocation channel from that) MAY place that non-mutating detection step ahead of the preflight, provided the preflight call is still the first `memon` invocation and no spec file is read or written before it resolves.

#### Scenario: Skill body contains the preflight preamble
- **WHEN** a reader inspects the workflow body of any of the six listed skills
- **THEN** the very first numbered step (or a section labelled "Preflight") executes `memon fs-version check --project-root <p> --format json`
- **AND** the step explicitly enumerates branches for `match` (proceed), `behind` (stop with migrate-fs recommendation), `uninitialised` (stop with install-skills recommendation), and `ahead` (stop with MEMON_TOO_OLD message)
