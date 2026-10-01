## ADDED Requirements

### Requirement: Project section page titles

Each project sub-page route (`reports`, `hypotheses`, `journal`) SHALL emit a title of the form `<Section> · <project>`, where `<Section>` is the capitalized English noun for the page (`Reports`, `Hypotheses`, `Journal` respectively) and `<project>` is the decoded project name from the URL.

#### Scenario: Reports list
- **WHEN** the user navigates to `/p/my-project/reports`
- **THEN** the rendered `<title>` is `Reports · my-project · memon`

#### Scenario: Hypotheses page
- **WHEN** the user navigates to `/p/my-project/hypotheses`
- **THEN** the rendered `<title>` is `Hypotheses · my-project · memon`

#### Scenario: Journal page
- **WHEN** the user navigates to `/p/my-project/journal`
- **THEN** the rendered `<title>` is `Journal · my-project · memon`

### Requirement: Report detail titles

Report detail routes SHALL emit a title of the form `<id> · Reports · <project>`, where `<id>` is the raw decoded id (e.g. `R0123`).

If the id does not match the expected `R\d{4}` shape, the page already returns a Next.js 404 and the title is irrelevant — but `generateMetadata` SHALL still return without throwing.

#### Scenario: Report detail
- **WHEN** the user navigates to `/p/my-project/reports/R0123`
- **THEN** the rendered `<title>` is `R0123 · Reports · my-project · memon`

## MODIFIED Requirements

### Requirement: Global title template

The root layout (`apps/web/app/layout.tsx`) SHALL set
`metadata.title` to an object of the form
`{ default: 'memon', template: '%s · memon' }` so that any descendant
route emitting its own title is automatically suffixed with ` · memon`,
and any route that does NOT emit its own title renders the bare
`memon`.

Because Next.js does NOT chain `title.template` across multiple nested
layout segments, the project layout (`/p/[project]/layout.tsx`) SHALL
set its own `title.template` that bakes the project name and the trailing
` · memon` suffix into a single format string. Pages under
`/p/[project]/**` SHALL therefore emit only the segment-specific
prefix (e.g. `Reports`, `R0001 · Reports`), and the project layout's
template prepends `· <project> · memon`.

The template separator SHALL be the middle-dot character `·` (U+00B7)
surrounded by single spaces. No other separators (`-`, `|`, `:`) SHALL
appear in the title template.

The string literal `memon` SHALL NOT appear inside any page-level
title (only in the templates), so that the suffix is added exactly
once at the deepest template the route is wrapped by.

#### Scenario: Page without its own title falls back to `memon`
- **WHEN** a route does not export `metadata.title` nor
  `generateMetadata`
- **THEN** the rendered HTML's `<title>` tag is exactly `memon`

#### Scenario: Page-supplied title is wrapped by the template
- **WHEN** a route exports `metadata.title = 'X'` (or
  `generateMetadata` returning `{ title: 'X' }`)
- **THEN** the rendered HTML's `<title>` tag is exactly `X · memon`

### Requirement: Wiki page titles

The wiki list route `/p/<project>/wiki` SHALL emit a title of the form `Wiki · <project>`, and the wiki detail route `/p/<project>/wiki/<id>` SHALL emit a title of the form `<W-id> · Wiki · <project>`, where `<id>` is the raw decoded id (e.g. `W0123`) and `<project>` is the decoded project name from the URL. As with every other route under `/p/[project]/**`, the page SHALL emit only the segment-specific prefix and let the project layout's template append `· <project> · memon`.

If the id does not match the expected `W\d{4}` shape, the page already returns a Next.js 404 and the title is irrelevant — but `generateMetadata` SHALL still return without throwing.

Report titles are unaffected: `/p/<project>/reports` and `/p/<project>/reports/<id>` keep the titles specified by the requirements "Project section page titles" and "Report detail titles".

#### Scenario: Wiki list
- **WHEN** the user navigates to `/p/my-project/wiki`
- **THEN** the rendered `<title>` is `Wiki · my-project · memon`

#### Scenario: Wiki page detail
- **WHEN** the user navigates to `/p/my-project/wiki/W0123`
- **THEN** the rendered `<title>` is `W0123 · Wiki · my-project · memon`

#### Scenario: Report titles are unchanged
- **WHEN** the user navigates to `/p/my-project/reports/R0123`
- **THEN** the rendered `<title>` is still `R0123 · Reports · my-project · memon`

#### Scenario: Malformed wiki id does not throw
- **WHEN** the user navigates to `/p/my-project/wiki/nope`
- **THEN** `generateMetadata` returns a fallback title without throwing and the page body owns the 404 response

## REMOVED Requirements

### Requirement: Digest and Report detail titles
**Reason**: The standalone Digest detail route is retired; the Report half of this requirement moves unchanged to "Report detail titles".
**Migration**: Migrated digests are ordinary Wiki pages of kind `digest`; the reviewed v7 migration converts every legacy file before the reader switch. Their titles follow "Wiki page titles".

### Requirement: Project sub-page titles
**Reason**: Superseded by "Project section page titles", which drops the retired standalone Digest branch (a MODIFIED block cannot drop its Digest scenarios).
**Migration**: Behavior for Reports is unchanged under "Project section page titles". Migrated digests are ordinary Wiki pages of kind `digest`.
