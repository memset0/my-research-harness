## MODIFIED Requirements

### Requirement: Recommended sections are advisory

For each canonical kind the system SHALL derive recommended H2 sections from the shipped registry, initially: `meeting` Attendees, Notes, Decisions, Action items; `finding` Claim, Evidence, Limits; `bottleneck` Problem, Impact, Status, Candidates; `question` Question, Context, Answer; `decision` Decision, Rationale, Consequences; `showcase` What to show, How to reproduce, Assets; `harness-feedback` Motivation, Proposal, Status; `note`, `roadmap`, `initiative`, and `catalog` none. Required H2 structure SHALL NOT be inferred from suggestions. A missing recommended section SHALL produce a `WIKI_MISSING_SECTION` diagnostic with severity `warn`. Additional or reordered sections SHALL NOT produce diagnostics. Section headings SHALL be matched by their English text on every page regardless of its `language`; there are no translated heading forms.

#### Scenario: Finding without Limits
- **GIVEN** a `finding` page whose body has `## Claim` and `## Evidence` only
- **WHEN** the page is linted
- **THEN** exactly one `WIKI_MISSING_SECTION` warning naming `Limits` is produced

#### Scenario: Chinese page keeps English headings
- **GIVEN** a `language: zh` `finding` page whose body has `## Claim`, `## Evidence` and `## Limits` with Chinese prose beneath them
- **WHEN** the page is linted
- **THEN** no `WIKI_MISSING_SECTION` diagnostic is produced

#### Scenario: Chinese finding headings
- **GIVEN** a `language: zh` `finding` page whose body has `## 结论`, `## 证据` and `## 局限` instead of the English headings
- **WHEN** the page is linted
- **THEN** three `WIKI_MISSING_SECTION` warnings name `Claim`, `Evidence` and `Limits`

### Requirement: Maintenance rules section holds only list items

A page MAY carry one section named `Maintenance rules for agents` (English on every page) recording the owner's standing requirements for agents working on that page. Inside that section every non-blank line SHALL be a list item or an indented line belonging to a list item. Any other content, or a second section with that name, SHALL produce a `WIKI_MAINTENANCE_RULES_INVALID` diagnostic with severity `warn` on the offending line; the page SHALL remain valid and listed. A page without the section SHALL produce no diagnostic.

#### Scenario: Valid rules with an agent-scoped group
- **GIVEN** a page ending with `## Maintenance rules for agents` whose lines are `- Keep the top callout current. (2026-09-23)`, `- Only for Oh My Pi:` and an indented `  - Never cancel a Slurm allocation. (2026-09-18)`
- **WHEN** the page is linted
- **THEN** no `WIKI_MAINTENANCE_RULES_INVALID` diagnostic is produced

#### Scenario: Prose inside the rules
- **GIVEN** the same section followed by a plain paragraph line
- **WHEN** the page is linted
- **THEN** one `WIKI_MAINTENANCE_RULES_INVALID` warning names that line

#### Scenario: Two rules sections
- **GIVEN** a page with two `## Maintenance rules for agents` headings
- **WHEN** the page is linted
- **THEN** a `WIKI_MAINTENANCE_RULES_INVALID` warning names the second heading
