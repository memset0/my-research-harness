## MODIFIED Requirements

### Requirement: `memon wiki` command group and addressing

`memon wiki <subcommand>` SHALL exist with subcommands `ls`, `show`, `create`, `move`, `set`, `review`, `commit`, `lint`, `stale`, `backlinks`, `migrate-report`, `data`, `components`, `kinds`, `deprecate`, `undeprecate`, `delete`. Every subcommand SHALL accept `--project-root <p>` (defaulting to `cwd`) and `--format json|human` (default `json`); `ls` and `show` SHALL additionally accept `--format markdown`. Where a `<page>` argument is taken it SHALL accept a slug (primary) or a canonical `W<NNNN>` id; an unpadded id (`W7`) SHALL exit 2 `BAD_REQUEST`; an unknown page SHALL exit 4 `NOT_FOUND`. Error output SHALL be a single JSON object on stderr of the form `{"error":{"code":…,"message":…}}`.

#### Scenario: Slug addressing
- **GIVEN** page `W0004` with slug `vsa-debt`
- **WHEN** the user runs `memon wiki show vsa-debt --project-root .`
- **THEN** the output is identical to `memon wiki show W0004 --project-root .`

#### Scenario: Unknown page
- **WHEN** the user runs `memon wiki show nope --project-root .`
- **THEN** the command exits 4 with `{"error":{"code":"NOT_FOUND",…}}`

#### Scenario: Inspect installed kinds without a project
- **WHEN** the user runs `memon wiki kinds ls` or `memon wiki kinds show <kind>` with `--format human|json`
- **THEN** the command returns the shipped registry definitions without project discovery, central access, git or journal writes
- **AND** an unknown kind exits 2 with BAD_REQUEST

### Requirement: `memon wiki create` allocates an id and writes a template

`memon wiki create <kind> <slug> --title <T> [--description <D>] [--status S] [--date D] [--source A]... [--tag T]... [--bundle]` SHALL: validate `kind` against the canonical list (exit 2 on an unknown kind), validate the slug regex and project-wide uniqueness (exit 9 `CONFLICT` when taken), validate `status` against the kind's vocabulary (exit 2 when invalid; default to the vocabulary's first value when omitted for a kind that requires one), require `--date` when the registry date policy requires it (including `meeting`; exit 2 when absent), allocate the next free `W<NNNN>` across all pages, and write `docs/wiki/<kind>/<slug>.md` (or `<slug>/README.md` with `--bundle`) containing the full frontmatter (including `description` when given), an H1 equal to the title, and an empty H2 for every recommended section of the kind. `created_at` and `updated_at` SHALL be the current time with offset. Output SHALL be the new page's summary including its absolute `path`.

#### Scenario: Create a finding
- **WHEN** the user runs `memon wiki create finding vsa-debt --title "VSA common-path debt" --status VERIFIED --source E0017`
- **THEN** `docs/wiki/finding/vsa-debt.md` exists with `id: W<next>`, `kind: finding`, `status: VERIFIED`, `sources: [E0017]`, and H2s `Claim`, `Evidence`, `Limits`
- **AND** stdout is the page summary with `stale: false`

#### Scenario: Slug already used in another kind
- **GIVEN** `docs/wiki/note/vsa-debt.md` exists
- **WHEN** the user runs `memon wiki create finding vsa-debt --title x`
- **THEN** the command exits 9 with `CONFLICT` and writes nothing

#### Scenario: Meeting without date
- **WHEN** the user runs `memon wiki create meeting weekly --title "Weekly"`
- **THEN** the command exits 2 with `BAD_REQUEST` mentioning `--date`
