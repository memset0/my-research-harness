## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Central data page titles identify Host and Project
In central mode, page titles for Project-scoped runs, Experiments, reports, wiki pages, reviews, inbox entries, Git views, tmux, and terminals SHALL include enough Host and Project identity to distinguish equal names across Hosts. Standalone titles SHALL preserve their existing form.

#### Scenario: Equal Project names produce distinct titles
- **WHEN** two tabs show `project-x` on Host A and Host B
- **THEN** their document titles visibly distinguish Host A from Host B

#### Scenario: Host-qualified wiki detail identifies its Host
- **WHEN** the user opens `/h/<host>/p/project-x/wiki/W0007`
- **THEN** the document title identifies the Host alongside `W0007` and `project-x`
