## MODIFIED Requirements

### Requirement: `memon wiki create` allocates an id and writes a template

`memon wiki create <kind> <slug> --title <T> [--description <D>] [--status S] [--date D] [--source A]... [--tag T]... [--language L] [--bundle]` SHALL: validate `kind` against the canonical list (exit 2 on an unknown kind), validate the slug regex and project-wide uniqueness (exit 9 `CONFLICT` when taken), validate `status` against the kind's vocabulary (exit 2 when invalid; default to the vocabulary's first value when omitted for a kind that requires one), require `--date` when the registry date policy requires it (including `meeting`; exit 2 when absent), allocate the next free `W<NNNN>` across all pages, and write `docs/wiki/<kind>/<slug>.md` (or `<slug>/README.md` with `--bundle`) containing the full frontmatter (including `description` when given), an H1 equal to the title, and an empty H2 for every recommended section of the kind. `created_at` and `updated_at` SHALL be the current time with offset. Output SHALL be the new page's summary including its absolute `path`. `--language <en|zh>` SHALL write the `language` field and, for `zh`, scaffold the Chinese forms of the recommended H2s; any other value SHALL exit 2.

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
- **THEN** the page has `language: zh` and H2s `结论`, `证据`, `局限`


### Requirement: `memon wiki set` edits frontmatter with an optimistic lock

`memon wiki set <page> [--status S] [--title T] [--description D] [--date D] [--add-source A]... [--rm-source A]... [--add-tag T]... [--rm-tag T]... [--language L] [--expected-mtime <ms>]` SHALL apply only the requested frontmatter changes, preserve the body byte-for-byte, preserve unknown keys, bump `updated_at`, and write atomically. When `--expected-mtime` is given and differs from the on-disk mtime the command SHALL exit 9 `CONFLICT` with the current mtime in the error. At least one change flag SHALL be required (exit 2 otherwise). Invalid `status` for the page's kind SHALL exit 2. `--language <en|zh>` SHALL set the `language` field and counts as a change flag; any other value SHALL exit 2.

#### Scenario: Mark a finding retracted
- **WHEN** the user runs `memon wiki set vsa-debt --status RETRACTED`
- **THEN** the frontmatter has `status: RETRACTED`, a newer `updated_at`, and the body is unchanged

#### Scenario: Stale expected mtime
- **WHEN** the user runs `memon wiki set vsa-debt --add-tag x --expected-mtime 1`
- **THEN** the command exits 9 with `CONFLICT` and the file is unchanged

#### Scenario: Switch a page to Chinese
- **WHEN** the user runs `memon wiki set vsa-debt --language zh`
- **THEN** the frontmatter has `language: zh`, a newer `updated_at`, and the body is unchanged

