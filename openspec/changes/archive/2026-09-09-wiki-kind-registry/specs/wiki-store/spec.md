## MODIFIED Requirements

### Requirement: Wiki pages live under `docs/wiki/<kind>/W<NNNN>-<slug>`

A wiki page SHALL be discovered at `<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>.md` (single-file form) or `<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>/README.md` (bundle form). `<slug>` SHALL match `^[a-z0-9][a-z0-9-]*$` and SHALL be unique across every kind directory in the project; the `W<NNNN>` prefix SHALL equal the frontmatter `id` (`WIKI_ID_MISMATCH` otherwise). The slug is the primary human address: the dashboard, CLI, and links SHALL accept a bare slug everywhere an id is accepted, and renaming a slug SHALL be an explicit `move`. Discovery SHALL be exactly two levels deep; files directly under `docs/wiki/`, entries not matching the naming pattern, and entries deeper than the bundle `README.md` SHALL be ignored. A `<kind>` directory whose name is not in the shipped canonical Wiki kind registry SHALL still be discovered with `kind` equal to the directory name and SHALL produce the `WIKI_UNKNOWN_KIND` diagnostic.

#### Scenario: Both forms discovered
- **GIVEN** `docs/wiki/finding/W0003-vsa-debt.md` and `docs/wiki/showcase/W0004-kernel-map/README.md`
- **WHEN** the project's wiki is listed
- **THEN** both pages appear, with `format` `markdown` and `bundle` respectively

#### Scenario: Prefix disagrees with frontmatter
- **GIVEN** `docs/wiki/note/W0009-alpha.md` whose frontmatter says `id: W0008`
- **WHEN** the project's wiki is listed
- **THEN** the page appears with a `WIKI_ID_MISMATCH` diagnostic

#### Scenario: Unknown kind is tolerated
- **GIVEN** `docs/wiki/retro/W0005-sprint-3.md`
- **WHEN** the project's wiki is listed
- **THEN** the page appears with `kind: "retro"` and a `WIKI_UNKNOWN_KIND` diagnostic

#### Scenario: Duplicate slug is an error
- **GIVEN** `docs/wiki/note/W0006-alpha.md` and `docs/wiki/finding/W0007-alpha.md`
- **WHEN** the project's wiki is listed
- **THEN** both pages appear and each carries a `WIKI_SLUG_DUPLICATE` diagnostic

### Requirement: Page frontmatter carries identity, kind, status, and sources

Every page SHALL start with YAML frontmatter. `id` SHALL match `^W\d{4}$` and be unique in the project; `kind` SHALL equal the enclosing directory name; `title` SHALL be a non-empty string; `created_at` and `updated_at` SHALL be ISO8601 timestamps with an explicit offset. Status/date/source policies SHALL derive from the validated shipped Wiki kind registry. The existing defaults SHALL remain: `status` required and restricted per kind: `finding` `TENTATIVE|VERIFIED|RETRACTED`; `bottleneck` `OPEN|MITIGATED|RESOLVED`; `question` `OPEN|ANSWERED|DROPPED`; `decision` `PROPOSED|ACCEPTED|SUPERSEDED`; `showcase` `DRAFT|READY|OUTDATED`; `harness-feedback` `PROPOSED|ACCEPTED|SHIPPED|REJECTED`; `meeting`, `roadmap`, `note`, `initiative`, and `catalog` SHALL NOT require `status`. `meeting` SHALL require `date` in `YYYY-MM-DD` form. `finding` SHALL require a non-empty `sources` list. `description` (a one-to-three-sentence plain-text summary of the page, no Markdown), `tags` (string list), `sources` (string list), `legacy_id` (`^R\d{4}$`), `entry` (bundle pages only; relative path to an HTML document inside the bundle),  Keys outside this schema SHALL be preserved verbatim by every write path.

Violations SHALL be reported as diagnostics (`WIKI_ID_INVALID`, `WIKI_ID_DUPLICATE`, `WIKI_KIND_MISMATCH`, `WIKI_TITLE_MISSING`, `WIKI_STATUS_MISSING`, `WIKI_STATUS_INVALID`, `WIKI_DATE_MISSING`, `WIKI_SOURCES_REQUIRED`, `WIKI_TIMESTAMP_INVALID`) with severity `error`; the page SHALL remain readable and listed.

#### Scenario: Valid finding
- **GIVEN** a `finding` page with `status: VERIFIED` and `sources: [E0017-fused-attention]`
- **WHEN** the page is validated
- **THEN** no diagnostics are produced

#### Scenario: Wrong status vocabulary
- **GIVEN** a `bottleneck` page with `status: VERIFIED`
- **WHEN** the page is validated
- **THEN** a `WIKI_STATUS_INVALID` error diagnostic is produced and the page is still listed

#### Scenario: Custom keys survive a write
- **GIVEN** a page whose frontmatter contains `owner: alice`
- **WHEN** the page is rewritten through the API or CLI
- **THEN** `owner: alice` is still present unchanged

### Requirement: Recommended sections are advisory

For each canonical kind the system SHALL derive recommended H2 sections from the shipped registry, initially: `meeting` Attendees, Notes, Decisions, Action items; `finding` Claim, Evidence, Limits; `bottleneck` Problem, Impact, Status, Candidates; `question` Question, Context, Answer; `decision` Decision, Rationale, Consequences; `showcase` What to show, How to reproduce, Assets; `harness-feedback` Motivation, Proposal, Status; `note`, `roadmap`, `initiative`, and `catalog` none. Required H2 structure SHALL NOT be inferred from suggestions. A missing recommended section SHALL produce a `WIKI_MISSING_SECTION` diagnostic with severity `warn`. Additional or reordered sections SHALL NOT produce diagnostics.

#### Scenario: Finding without Limits
- **GIVEN** a `finding` page whose body has `## Claim` and `## Evidence` only
- **WHEN** the page is linted
- **THEN** exactly one `WIKI_MISSING_SECTION` warning naming `Limits` is produced
