## MODIFIED Requirements

### Requirement: Page frontmatter carries identity, kind, status, and sources

Every page SHALL start with YAML frontmatter. `id` SHALL match `^W\d{4}$` and be unique in the project; `kind` SHALL equal the enclosing directory name; `title` SHALL be a non-empty string; `created_at` and `updated_at` SHALL be ISO8601 timestamps with an explicit offset. Status/date/source policies SHALL derive from the validated shipped Wiki kind registry. The existing defaults SHALL remain: `status` required and restricted per kind: `finding` `TENTATIVE|VERIFIED|RETRACTED`; `bottleneck` `OPEN|MITIGATED|RESOLVED`; `question` `OPEN|ANSWERED|DROPPED`; `decision` `PROPOSED|ACCEPTED|SUPERSEDED`; `showcase` `DRAFT|READY|OUTDATED`; `harness-feedback` `PROPOSED|ACCEPTED|SHIPPED|REJECTED`; `meeting`, `roadmap`, `note`, `initiative`, and `catalog` SHALL NOT require `status`. `meeting` SHALL require `date` in `YYYY-MM-DD` form. `finding` SHALL require a non-empty `sources` list. `description` (a one-to-three-sentence plain-text summary of the page, no Markdown), `tags` (string list), `sources` (string list), `legacy_id` (`^R\d{4}$`), `entry` (bundle pages only; relative path to an HTML document inside the bundle),  Keys outside this schema SHALL be preserved verbatim by every write path.

Violations SHALL be reported as diagnostics (`WIKI_ID_INVALID`, `WIKI_ID_DUPLICATE`, `WIKI_KIND_MISMATCH`, `WIKI_TITLE_MISSING`, `WIKI_STATUS_MISSING`, `WIKI_STATUS_INVALID`, `WIKI_DATE_MISSING`, `WIKI_SOURCES_REQUIRED`, `WIKI_TIMESTAMP_INVALID`, `WIKI_LANGUAGE_INVALID`) with severity `error`; the page SHALL remain readable and listed. A page MAY declare `language: en` or `language: zh`, the language its content is written in; an absent field SHALL mean `en`, and page summaries and details SHALL expose the effective `language`.

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

#### Scenario: Chinese page
- **GIVEN** a page with `language: zh`
- **WHEN** the wiki is listed
- **THEN** its summary carries `language: zh` and no diagnostic is produced

#### Scenario: Unknown language
- **GIVEN** a page with `language: fr`
- **WHEN** the page is validated
- **THEN** a `WIKI_LANGUAGE_INVALID` error diagnostic is produced and the page is listed with `language: en`


### Requirement: Recommended sections are advisory

For each canonical kind the system SHALL derive recommended H2 sections from the shipped registry, initially: `meeting` Attendees, Notes, Decisions, Action items; `finding` Claim, Evidence, Limits; `bottleneck` Problem, Impact, Status, Candidates; `question` Question, Context, Answer; `decision` Decision, Rationale, Consequences; `showcase` What to show, How to reproduce, Assets; `harness-feedback` Motivation, Proposal, Status; `note`, `roadmap`, `initiative`, and `catalog` none. Required H2 structure SHALL NOT be inferred from suggestions. A missing recommended section SHALL produce a `WIKI_MISSING_SECTION` diagnostic with severity `warn`. Additional or reordered sections SHALL NOT produce diagnostics. Every recommended section SHALL also have a Chinese form from the registry (`finding` 结论, 证据, 局限, and so on); either form SHALL satisfy the recommendation on any page, and the warning SHALL name the form of the page's declared language.

#### Scenario: Finding without Limits
- **GIVEN** a `finding` page whose body has `## Claim` and `## Evidence` only
- **WHEN** the page is linted
- **THEN** exactly one `WIKI_MISSING_SECTION` warning naming `Limits` is produced

#### Scenario: Chinese finding headings
- **GIVEN** a `language: zh` `finding` page whose body has `## 结论`, `## 证据` and `## 局限`
- **WHEN** the page is linted
- **THEN** no `WIKI_MISSING_SECTION` diagnostic is produced

