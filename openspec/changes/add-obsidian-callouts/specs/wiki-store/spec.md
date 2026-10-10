## MODIFIED Requirements

### Requirement: Callouts use GitHub alert syntax

A blockquote whose first line is `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`, or `> [!DEPRECATED] …` SHALL render as a styled callout of that type; Obsidian types and aliases, custom titles, and folding follow the shared markdown-callouts contract. A blockquote without a valid callout marker renders as an ordinary quotation. `[!DEPRECATED]` additionally carries the section-deprecation semantics defined below.

#### Scenario: Warning callout
- **GIVEN** `> [!WARNING] reference path differs from upstream`
- **WHEN** the page renders
- **THEN** a warning-styled callout appears with that text

### Requirement: Outdated content is marked deprecated, never silently kept

Deprecation exists at two levels. **Page level**: frontmatter `deprecated` is an optional object `{ at: <ISO8601 with offset>, reason: <non-empty string>, superseded_by?: W<NNNN> }`; a page carrying it SHALL expose `deprecated: true` in the list projection, SHALL sort after non-deprecated pages within its kind, SHALL NOT be reported as `stale` (its sources are no longer expected to be current), SHALL still appear in `citedBy`/backlinks flagged `deprecated`, and SHALL render with a full-width banner above the body showing `at`, `reason`, and a link to `superseded_by` when present. **Section level**: a blockquote whose first line is `> [!DEPRECATED] <reason>` (optionally `> [!DEPRECATED] since <YYYY-MM-DD>: <reason>`) placed immediately under a heading SHALL mark that heading's section — through the next heading of the same or higher level — as deprecated; the renderer SHALL show the section with a deprecated banner and visually muted body, and the table of contents SHALL tag the entry. The same marker anywhere else SHALL mark only its own blockquote. A `[!DEPRECATED]` marker without a reason, and a `deprecated` object missing `at` or `reason`, SHALL produce `WIKI_DEPRECATION_INVALID` (`error`). `superseded_by` pointing at a page that does not exist SHALL produce `WIKI_SOURCE_UNRESOLVED` (`warn`). The list projection SHALL expose `deprecatedSections` (the affected heading texts) so callers can see partially outdated pages without reading the body.

#### Scenario: Deprecated page is banner-marked and not stale
- **GIVEN** `W0004` has `deprecated: { at: 2026-09-01T10:00:00+08:00, reason: "superseded by the fused path", superseded_by: W0012 }` and cites `E0017` which changed afterwards
- **WHEN** the wiki is listed and the page renders
- **THEN** `deprecated: true`, `stale: false`, and a banner links to `W0012`

#### Scenario: Deprecated section stays readable
- **GIVEN** a page whose `## Old approach` heading is followed by `> [!DEPRECATED] since 2026-08-20: replaced by V0068`
- **WHEN** the page renders
- **THEN** the `Old approach` section shows the deprecated banner and muted styling up to the next `##`, the TOC entry is tagged, and `deprecatedSections` contains `Old approach`

#### Scenario: Marker without reason is an error
- **GIVEN** a blockquote `> [!DEPRECATED]` with nothing after it
- **WHEN** the page is linted
- **THEN** `WIKI_DEPRECATION_INVALID` is reported

#### Scenario: Foldable deprecation marker retains semantics
- **WHEN** a case-insensitive `> [!DEPRECATED]-` or `> [!DEPRECATED]+` marker appears directly under a heading
- **THEN** the folding suffix is excluded from its reason, the existing heading association and optional `since` date semantics remain, and a missing reason is still an error
- **AND** a reason can appear in the custom title or the following quoted content
