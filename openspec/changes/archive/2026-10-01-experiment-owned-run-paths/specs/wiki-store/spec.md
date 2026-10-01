## MODIFIED Requirements

### Requirement: `@` references link to any project artifact

In every Markdown surface the dashboard renders, a link whose destination is `@<ref>` (`[text](@W0001)`, `[text](@zero-snr-brightness)`, `[text](@E0002)`, `[text](@R0003)`, `[text](@H0004)`, `[text](@edm2-precond-260503-080000)`) and a bare mention `@<ref>` in running text SHALL resolve to the canonical dashboard route of that artifact: wiki page by id or slug, Experiment by id or id-with-slug, Report by id, Hypothesis by id, Run by canonical project-relative directory path (`[text](@logs/edm2-precond-260503-080000)`) or by directory base name when the walk knows that name. Run identity for reference checking SHALL come from the Run-root directory walk alone, never from opening Run READMEs, so an uncited or unreadable Run still resolves. Resolution SHALL use the runtime cache, never a filesystem lookup at render time. A bare mention SHALL render as a link showing the reference text; a `[text](@ref)` link SHALL show `text`. An unresolvable `@<ref>` SHALL render as plain text with a `title` explaining it is unresolved and, on wiki pages only, SHALL produce `WIKI_LINK_UNRESOLVED` (`warn`). `@` inside code spans, code blocks, URLs, and email-like tokens SHALL be left untouched. Wiki `sources` entries and `@` references are independent: a link never adds a source, and a source never has to be linked. The CLI `--format markdown` projection SHALL leave `@` references verbatim.

#### Scenario: Link by slug
- **GIVEN** wiki page `W0001` with slug `zero-snr-brightness`
- **WHEN** a Run README containing `[the finding](@zero-snr-brightness)` renders
- **THEN** the anchor points at the `W0001` wiki route with text "the finding"

#### Scenario: Bare mention of an Experiment
- **GIVEN** `E0002-zero-snr-eval` exists
- **WHEN** a wiki page containing `see @E0002 for the sweep` renders
- **THEN** `@E0002` becomes a link to the Experiment page

#### Scenario: Slug renamed
- **GIVEN** a page linked as `[x](@old-slug)` is moved to slug `new-slug`
- **WHEN** the linking page renders
- **THEN** the link renders as unresolved plain text and the linking wiki page reports `WIKI_LINK_UNRESOLVED`

#### Scenario: Not a reference
- **WHEN** a page containing `` `@W0001` `` and `mail@example.com` renders
- **THEN** neither is turned into a link

#### Scenario: Run referenced by path
- **GIVEN** `logs/edm2-precond-260503-080000` exists and its README is unreadable
- **WHEN** a wiki page containing `[run](@logs/edm2-precond-260503-080000)` and `@edm2-precond-260503-080000` is listed
- **THEN** neither reference reports `WIKI_LINK_UNRESOLVED` and the Run README is never opened
