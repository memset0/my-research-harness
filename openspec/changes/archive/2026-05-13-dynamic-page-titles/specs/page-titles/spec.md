## ADDED Requirements

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

### Requirement: Tmux manage page title

The route `/manage/tmux` SHALL emit the static title `Tmux`. The
combined title SHALL be `Tmux · memon`.

#### Scenario: Manage tmux page
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the rendered `<title>` is `Tmux · memon`

### Requirement: Terminal popup title

The route `/terminal-popup` SHALL emit a title that identifies the
attached tmux session, in one of two shapes depending on which query-
param form was used:

- If `sessionName` is present and matches the
  `^memon-[A-Za-z0-9._-]+$` shape, the title SHALL be the bare
  `sessionName` string (e.g. `memon-run-my-slug-260513-091200`).
- Otherwise, if `project`, `scope`, and `slug` are all present with
  `scope` in `{exp, run, project}`, the title SHALL be
  `<scope>:<slug>` (e.g. `run:my-slug-260513-091200`).
- If neither shape is recognizable, the title SHALL be the static
  `Terminal`.

#### Scenario: Raw sessionName form
- **WHEN** the popup is opened with
  `?sessionName=memon-run-my-slug-260513-091200`
- **THEN** the rendered `<title>` is
  `memon-run-my-slug-260513-091200 · memon`

#### Scenario: Structured form
- **WHEN** the popup is opened with
  `?project=p&scope=run&slug=my-slug-260513-091200`
- **THEN** the rendered `<title>` is
  `run:my-slug-260513-091200 · memon`

#### Scenario: Unrecognizable params
- **WHEN** the popup is opened with no recognizable session params
- **THEN** the rendered `<title>` is `Terminal · memon`

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
