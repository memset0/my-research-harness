# page-titles Specification

## Purpose
Present consistent project and artifact identity in browser titles without coupling titles to service transport.

## Requirements

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
prefix (e.g. `Digests`, `D0001 · Digests`), and the project layout's
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

### Requirement: Project list page title

The route `/p/<project>` SHALL emit a title equal to the decoded
project name. The combined title in the rendered HTML SHALL therefore
be `<project> · memon`.

#### Scenario: Project list renders project name
- **WHEN** the user navigates to `/p/my-project`
- **THEN** the rendered `<title>` is `my-project · memon`

### Requirement: Project sub-page titles

Each project sub-page route (`digests`, `reports`, `hypotheses`, `journal`) SHALL emit a title of the form `<Section> · <project>`, where `<Section>` is the capitalized English noun for the page (`Digests`, `Reports`, `Hypotheses`, `Journal` respectively) and `<project>` is the decoded project name from the URL.

#### Scenario: Digests list
- **WHEN** the user navigates to `/p/my-project/digests`
- **THEN** the rendered `<title>` is `Digests · my-project · memon`

#### Scenario: Reports list
- **WHEN** the user navigates to `/p/my-project/reports`
- **THEN** the rendered `<title>` is `Reports · my-project · memon`

#### Scenario: Hypotheses page
- **WHEN** the user navigates to `/p/my-project/hypotheses`
- **THEN** the rendered `<title>` is `Hypotheses · my-project · memon`

#### Scenario: Journal page
- **WHEN** the user navigates to `/p/my-project/journal`
- **THEN** the rendered `<title>` is `Journal · my-project · memon`

### Requirement: Digest and Report detail titles

Digest and Report detail routes SHALL emit a title of the form `<id> · <Section> · <project>`, where `<id>` is the raw decoded id (e.g. `D0007`, `R0123`) and `<Section>` is `Digests` or `Reports` respectively.

If the id does not match the expected `D\d{4}` / `R\d{4}` shape, the
page already returns a Next.js 404 and the title is irrelevant — but
`generateMetadata` SHALL still return without throwing.

#### Scenario: Digest detail
- **WHEN** the user navigates to `/p/my-project/digests/D0007`
- **THEN** the rendered `<title>` is `D0007 · Digests · my-project · memon`

#### Scenario: Report detail
- **WHEN** the user navigates to `/p/my-project/reports/R0123`
- **THEN** the rendered `<title>` is `R0123 · Reports · my-project · memon`

### Requirement: Experiment detail title

The route `/p/<project>/e/<id>` SHALL emit a title of the form
`<E-id> <slug> · <project>`, where `<E-id>` is the experiment id
(e.g. `E0042`) and `<slug>` is the experiment's `slug` field as
parsed from its README frontmatter. The id and slug SHALL be joined
by a single ASCII space (not a hyphen, not `·`).

The route `/p/<project>/experiments/<id>` SHALL emit a title of the
same shape.

#### Scenario: Resolved experiment renders id+slug
- **WHEN** experiment E0042 has slug `my-slug` and the user navigates
  to `/p/my-project/e/E0042-my-slug`
- **THEN** the rendered `<title>` is
  `E0042 my-slug · my-project · memon`

#### Scenario: Unresolved experiment falls back to id alone
- **WHEN** the user navigates to `/p/my-project/e/E9999-nonexistent`
  and the runtime cannot resolve that id
- **THEN** the rendered `<title>` is `E9999 · my-project · memon` and
  `generateMetadata` does NOT throw (the page body still handles the
  404)

### Requirement: Home / redirect fallback title

The route `/` SHALL NOT set its own metadata. When the route renders
its fallback markup (i.e. no projects configured and no redirect
happens), the title SHALL be the bare `memon` from the root layout's
default.

#### Scenario: Home with no projects
- **WHEN** the config has zero projects and the user navigates to `/`
- **THEN** the rendered `<title>` is `memon`

### Requirement: `generateMetadata` graceful failure

Every `generateMetadata` function introduced by this capability SHALL NOT throw under any input, and SHALL return a `Metadata` object with a fallback title on internal error. On any internal error (runtime
unavailable, id parse failure, unexpected exception), it SHALL return
a `Metadata` object with a sensible fallback `title` (typically the
raw id or the section name alone) so that the page body still owns
the 404/error response.

#### Scenario: Runtime error during metadata
- **WHEN** `generateMetadata` for an experiment route throws while
  reading the runtime index
- **THEN** the function catches internally and returns
  `{ title: '<E-id>' }` (or, for un-parseable id input, just the
  section name), and the page body continues to render normally

### Requirement: Central data page titles identify Host and Project
In central mode, page titles for Project-scoped runs, Experiments, reports, wiki pages, reviews, inbox entries, Git views, tmux, and terminals SHALL include enough Host and Project identity to distinguish equal names across Hosts. Standalone titles SHALL preserve their existing form.

#### Scenario: Equal Project names produce distinct titles
- **WHEN** two tabs show `project-x` on Host A and Host B
- **THEN** their document titles visibly distinguish Host A from Host B

#### Scenario: Host-qualified wiki detail identifies its Host
- **WHEN** the user opens `/h/<host>/p/project-x/wiki/W0007`
- **THEN** the document title identifies the Host alongside `W0007` and `project-x`

### Requirement: Host failure title remains contextual
When direct navigation targets an unusable Host, the error page title SHALL retain the requested Host/Project context rather than falling back to a generic or another Host's title.

#### Scenario: Offline direct link keeps identity
- **WHEN** a bookmarked Host-qualified Project URL is opened while that Host is offline
- **THEN** the title identifies the requested Host/Project and the page shows its availability state

### Requirement: Wiki page titles

The wiki list route `/p/<project>/wiki` SHALL emit a title of the form `Wiki · <project>`, and the wiki detail route `/p/<project>/wiki/<id>` SHALL emit a title of the form `<W-id> · Wiki · <project>`, where `<id>` is the raw decoded id (e.g. `W0123`) and `<project>` is the decoded project name from the URL. As with every other route under `/p/[project]/**`, the page SHALL emit only the segment-specific prefix and let the project layout's template append `· <project> · memon`.

If the id does not match the expected `W\d{4}` shape, the page already returns a Next.js 404 and the title is irrelevant — but `generateMetadata` SHALL still return without throwing.

Report titles are unaffected: `/p/<project>/reports` and `/p/<project>/reports/<id>` keep the titles specified by the requirements "Project sub-page titles" and "Digest and Report detail titles".

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
