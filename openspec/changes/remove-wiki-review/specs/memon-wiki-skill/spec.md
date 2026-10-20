## REMOVED Requirements

### Requirement: Review is a human boundary and the agent commits wiki changes separately

**Reason**: Wiki human verification and its ledger are retired.
**Migration**: Follow the existing independent requirement for committing batches; no review command, mark or review-status handoff remains.

### Requirement: The agent trusts documents by default and consults review state on conflict

**Reason**: Human-review state no longer exists and cannot rank conflicting evidence.
**Migration**: Compare underlying evidence, measurement validity, scope and source conditions; ask for clarification when available evidence cannot resolve the discrepancy.

## ADDED Requirements

### Requirement: Wiki guidance matches the review-free interface

Bundled Wiki guidance SHALL NOT instruct an agent or user to use retired review commands, review marks, review UI or review-state priority. Existing evidence requirements and ordinary Git commit guidance SHALL remain applicable. Conflicting claims SHALL be checked against their cited evidence and measurement scope instead of a review badge.

#### Scenario: Conflicting Wiki claims
- **WHEN** two pages report different numbers for the same research question
- **THEN** the agent checks cited execution evidence and measurement conditions and explains unresolved uncertainty without consulting a review ledger

## MODIFIED Requirements

### Requirement: The skill migrates Reports editorially on request

When asked to migrate a Report, the skill SHALL run `memon wiki migrate-report <R-id> <kind> [<slug>]`, reorganise the body into the kind's recommended sections without dropping content, derive `sources` from the Experiments, Variants, and runs the Report cited, run `memon wiki backlinks <R-id>` and fix every listed Markdown link so it targets the new page path, run lint, and hand the page over with its evidence sources and remaining limitations. The skill SHALL migrate one Report per invocation unless the user explicitly asks for a batch, and SHALL never migrate a Report the user did not name.

#### Scenario: Migrate one report
- **WHEN** the user asks to move `R0007` into the wiki as a finding
- **THEN** the skill runs `migrate-report`, restructures the page, fixes the listed links, and reports the page id and its evidence sources

### Requirement: Outdated content is deprecated, not deleted

When updating a page whose earlier claims no longer hold, the skill SHALL keep the earlier text and mark it: a whole page via `memon wiki deprecate … --reason … [--superseded-by …]`, a section via a `> [!DEPRECATED] since <date>: <reason>` blockquote directly under its heading. The skill SHALL NOT delete or rewrite historical claims to make a page look current, and SHALL NOT run `memon wiki delete` unless the user explicitly asks for deletion by id.

#### Scenario: Superseded section
- **WHEN** new Results contradict the `## Throughput` section of a `VERIFIED` page
- **THEN** the skill adds a new section with the current numbers and marks `## Throughput` with a `[!DEPRECATED]` blockquote naming the superseding Variant, leaving its text intact

### Requirement: Skill index and preflight docs name the wiki

`packages/skills/README.md` SHALL list `memon-wiki` in the skill index and files-written table (write scope: wiki pages via `memon wiki` and direct Markdown edits; never Experiment bundles, Reports, the journal cursor, or legacy `docs/digests/` files, which only the reviewed v7 migration converts; a `digest`-kind Wiki page is an ordinary Wiki page) and SHALL describe the wiki forms next to the Report forms. `packages/skills/PREFLIGHT.md` SHALL add `docs/wiki/` to the protected-file lists.

#### Scenario: README updated
- **WHEN** a reader greps `packages/skills/README.md` for `memon-wiki`
- **THEN** it appears in both tables, and `memon-write-report` still appears
