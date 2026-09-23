## MODIFIED Requirements

### Requirement: `memon wiki create` allocates an id and writes a template

`memon wiki create <kind> <slug> --title <T> [--description <D>] [--status S] [--date D] [--source A]... [--tag T]... [--language L] [--bundle]` SHALL: validate `kind` against the canonical list (exit 2 on an unknown kind), validate the slug regex and project-wide uniqueness (exit 9 `CONFLICT` when taken), validate `status` against the kind's vocabulary (exit 2 when invalid; default to the vocabulary's first value when omitted for a kind that requires one), require `--date` when the registry date policy requires it (including `meeting`; exit 2 when absent), allocate the next free `W<NNNN>` across all pages, and write `docs/wiki/<kind>/<slug>.md` (or `<slug>/README.md` with `--bundle`) containing the full frontmatter (including `description` when given), an H1 equal to the title, and an empty H2 for every recommended section of the kind. `created_at` and `updated_at` SHALL be the current time with offset. Output SHALL be the new page's summary including its absolute `path`. `--language <en|zh>` SHALL write the `language` field; the scaffolded H2s SHALL be the English recommended headings for every language; any other value SHALL exit 2.

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

#### Scenario: Create a Chinese finding
- **WHEN** the user runs `memon wiki create finding kv-cache --title "KV cache 显存占用" --language zh --source E0017`
- **THEN** the page has `language: zh` and H2s `Claim`, `Evidence`, `Limits`
