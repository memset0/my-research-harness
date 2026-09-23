# wiki-store Specification

## Purpose
Defines the on-disk wiki page model under `docs/wiki/`, its discovery and diagnostics, staleness and backlink derivation from declared sources, and the list/get/put/asset HTTP contract that the dashboard and Backend expose for it.

## Requirements

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

### Requirement: `@` references link to any project artifact

In every Markdown surface the dashboard renders, a link whose destination is `@<ref>` (`[text](@W0001)`, `[text](@zero-snr-brightness)`, `[text](@E0002)`, `[text](@R0003)`, `[text](@H0004)`, `[text](@edm2-precond-260503-080000)`) and a bare mention `@<ref>` in running text SHALL resolve to the canonical dashboard route of that artifact: wiki page by id or slug, Experiment by id or id-with-slug, Report by id, Hypothesis by id, Run by directory name. Resolution SHALL use the runtime cache, never a filesystem lookup at render time. A bare mention SHALL render as a link showing the reference text; a `[text](@ref)` link SHALL show `text`. An unresolvable `@<ref>` SHALL render as plain text with a `title` explaining it is unresolved and, on wiki pages only, SHALL produce `WIKI_LINK_UNRESOLVED` (`warn`). `@` inside code spans, code blocks, URLs, and email-like tokens SHALL be left untouched. Wiki `sources` entries and `@` references are independent: a link never adds a source, and a source never has to be linked. The CLI `--format markdown` projection SHALL leave `@` references verbatim.

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

### Requirement: Sources resolve to project artifacts and drive staleness

Each `sources` entry SHALL be resolved as one of: an Experiment id `E<NNNN>` optionally followed by `-<slug>`; a Variant inside an Experiment, `E<NNNN>[-<slug>]/V<NNNN>`, which resolves only when that Variant exists in the Experiment's Results; a Hypothesis id `H<NNNN>`; a wiki page id `W<NNNN>`; or a run directory base name. For a resolved source the system SHALL determine its last-change time: Experiment effective updated time (also for Variant form), Hypothesis file modification time, cited page `updated_at`, run `updated_at` (README mtime when absent). A page SHALL be `stale` when at least one resolved source changed after the page's `updated_at`; the list projection SHALL expose `stale` and `staleSources` (the offending entries in declaration order). An unresolvable entry SHALL produce `WIKI_SOURCE_UNRESOLVED` (`warn`) and SHALL NOT contribute to staleness. A `finding` whose Markdown body contains no `E<NNNN>`, `V<NNNN>`, or run directory token SHALL produce `WIKI_CLAIM_WITHOUT_EVIDENCE` (`warn`) even when `sources` is non-empty.

#### Scenario: Cited experiment moved on
- **GIVEN** page `W0004` with `updated_at: 2026-09-01T10:00:00+08:00` citing `E0017`, and `E0017`'s effective updated time is `2026-09-03T09:00:00+08:00`
- **WHEN** the wiki is listed
- **THEN** `W0004` has `stale: true` and `staleSources: ["E0017"]`

#### Scenario: Fresh page
- **GIVEN** a page whose every source changed before its `updated_at`
- **WHEN** the wiki is listed
- **THEN** the page has `stale: false` and empty `staleSources`

#### Scenario: Unknown source is a warning
- **GIVEN** a page citing `E9999`
- **WHEN** the wiki is listed
- **THEN** the page carries `WIKI_SOURCE_UNRESOLVED` and `E9999` is absent from `staleSources`

#### Scenario: Variant source resolves through its experiment
- **GIVEN** a page citing `E0017/V0068` and `E0017`'s `results.yaml` declares Variant `V0068`
- **WHEN** the wiki is listed
- **THEN** the source resolves, no diagnostic is produced, and staleness uses `E0017`'s effective updated time

#### Scenario: Missing variant is unresolved
- **GIVEN** a page citing `E0017/V0999` and no such Variant exists
- **WHEN** the wiki is listed
- **THEN** the page carries `WIKI_SOURCE_UNRESOLVED` for `E0017/V0999`

#### Scenario: Finding body without evidence tokens
- **GIVEN** a `finding` with `sources: [E0017]` whose body mentions no Experiment, Variant, or run identifier
- **WHEN** the page is linted
- **THEN** a `WIKI_CLAIM_WITHOUT_EVIDENCE` warning is produced

### Requirement: Wiki review is a commit-ordered human verification of `docs/wiki/`

Human trust in the wiki SHALL be recorded per git commit, not per page. A *wiki commit* is any commit in the project's git history that touches a path under `docs/wiki/` (bundle assets included). The system SHALL persist verification marks in `<projectRoot>/.memon/wiki-review.csv` with header `sha,verified_at,note` (full 40-char SHA, ISO8601 with offset, RFC 4180 quoted note), rows sorted by commit order; this file is independent of `.memon/commit-marks.csv`, which is deprecated by this change and no longer consulted for wiki trust. Verification SHALL proceed oldest to newest: a commit MAY be marked only when every older wiki commit is already marked (409 `REVIEW_ORDER` / exit 9 otherwise); removing a mark SHALL also remove every newer mark. `verifiedThrough` SHALL be the newest marked wiki commit. Marking SHALL be owner-only (`POST /api/wiki/review/<sha>`, `DELETE /api/wiki/review/<sha>`, and the CLI `memon wiki review verify|unverify`); viewer shares and `PUT /api/wiki/<id>` SHALL have no way to write marks. `GET /api/wiki/review?project=<name>` SHALL return `{ verifiedThrough, commits: [{ sha, authoredAt, subject, pages: [W-ids], verified: bool, verifiedAt?, note? }] }` in commit order. Projects whose root is not inside a git worktree SHALL report `review: null` everywhere and hide the surface.

#### Scenario: Marks are sequential
- **GIVEN** wiki commits `c1`, `c2`, `c3` with only `c1` marked
- **WHEN** the owner marks `c3`
- **THEN** the request is rejected with `REVIEW_ORDER` and `c2` is offered as the next commit

#### Scenario: Unmarking cascades
- **GIVEN** `c1`, `c2`, `c3` all marked
- **WHEN** the owner unmarks `c2`
- **THEN** `c2` and `c3` are unmarked and `verifiedThrough` is `c1`

#### Scenario: Viewer cannot mark
- **WHEN** a request carrying only a viewer share cookie posts to `/api/wiki/review/<sha>`
- **THEN** the response is 403 and `.memon/wiki-review.csv` is unchanged

#### Scenario: Not a git project
- **GIVEN** a project root outside any git worktree
- **WHEN** the wiki is listed
- **THEN** every page carries `review: null` and `GET /api/wiki/review` returns 404

### Requirement: Page review state is derived from verified commits and the working tree

For every page the system SHALL derive `review: { state, verifiedThrough, verifiedAt, unverifiedCommits, unverifiedRanges, dirty }`: `state` SHALL be `VERIFIED` when every line of the page's Markdown file (and every asset of a bundle) was last changed in a commit at or before `verifiedThrough` and the working tree matches HEAD for those paths; `CHANGED_SINCE_VERIFY` when some but not all of it is covered; `UNVERIFIED` when no line is covered or `verifiedThrough` is absent. `unverifiedRanges` SHALL list the 1-based line ranges of the Markdown file whose last change is newer than `verifiedThrough` (uncommitted edits count as unverified and set `dirty: true`); `unverifiedCommits` SHALL list the wiki commits newer than `verifiedThrough` that touched the page. Derivation SHALL run in the runtime cache on wiki-change, review-change, and git-HEAD change and SHALL never shell out on the request path. The list projection SHALL expose `review.state` and the page projection the full object; `reviewState` used by earlier deltas of this change means this `review.state`. A `finding` with `status: VERIFIED` whose `review.state` is not `VERIFIED` SHALL produce `WIKI_UNREVIEWED_VERIFIED` (`warn`). Frontmatter SHALL NOT carry review fields; `reviewed_at`/`reviewed_hash` keys, if present, are preserved as unknown keys and ignored.

#### Scenario: Fully verified page
- **GIVEN** `W0004` last changed in `c2` and `verifiedThrough` is `c2`
- **WHEN** the page is projected
- **THEN** `review.state` is `VERIFIED` and `unverifiedRanges` is empty

#### Scenario: Partial edit after verification
- **GIVEN** `W0004` verified through `c2`, then `c3` rewrites lines 12-18
- **WHEN** the page is projected
- **THEN** `review.state` is `CHANGED_SINCE_VERIFY`, `unverifiedRanges` is `[[12,18]]`, and `unverifiedCommits` is `[c3]`

#### Scenario: Uncommitted edit
- **GIVEN** `W0004` is `VERIFIED` and an agent edits it without committing
- **WHEN** the page is projected
- **THEN** `review.state` is `CHANGED_SINCE_VERIFY` with `dirty: true`

#### Scenario: Verified finding without review warns
- **GIVEN** a `finding` with `status: VERIFIED` whose `review.state` is `UNVERIFIED`
- **WHEN** the page is linted
- **THEN** a `WIKI_UNREVIEWED_VERIFIED` warning is produced

### Requirement: Legacy Report identifiers fall back to wiki pages

A page MAY carry `legacy_id: R<NNNN>`. Artifact resolution for a bare `R<NNNN>` token or a Report path SHALL target the Report while a Report with that id exists in `docs/reports/`; when no such Report exists, it SHALL target the wiki page whose `legacy_id` equals `R<NNNN>`; when neither exists the token stays plain text. Two pages sharing a `legacy_id` SHALL each produce `WIKI_LEGACY_ID_DUPLICATE` (`error`).

#### Scenario: Report still present wins
- **GIVEN** `docs/reports/R0007-x.md` exists and `W0021` has `legacy_id: R0007`
- **WHEN** an Experiment body containing `R0007` renders
- **THEN** the link opens the Report `R0007`

#### Scenario: Report gone, wiki page takes over
- **GIVEN** no Report `R0007` exists and `W0021` has `legacy_id: R0007`
- **WHEN** the same body renders
- **THEN** the `R0007` token links to wiki page `W0021`

### Requirement: Backlinks are derived from sources

The system SHALL expose, for any Experiment id, the list of wiki pages whose `sources` reference it (by bare id, id-with-slug, or Variant form), each with `id`, `slug`, `kind`, `title`, `status`, `stale`, and `reviewState`. `GET /api/experiments/<id>` SHALL include this list as `citedBy`, ordered by `updated_at` descending.

#### Scenario: Experiment detail lists citing pages
- **GIVEN** `W0004` (finding) and `W0009` (bottleneck) both cite `E0017`
- **WHEN** `GET /api/experiments/E0017-fused-attention` is requested
- **THEN** `citedBy` contains exactly `W0009` and `W0004` ordered by `updated_at` descending

### Requirement: GET /api/wiki?project=NAME lists all pages

`GET /api/wiki?project=<name>` SHALL return `{ pages: WikiSummary[] }` where `WikiSummary` includes `id`, `slug`, `kind`, `title`, `description` (nullable), `status` (nullable), `date` (nullable), `tags`, `sources`, `legacyId` (nullable), `stale`, `staleSources`, `review` (nullable; `state`, `verifiedThrough`, `unverifiedCommits`, `dirty`), `format`, `mtime`, `updatedAt`, and `diagnostics` (code + severity + message). Pages SHALL be ordered by kind in canonical order (unknown kinds last, alphabetically), then `updated_at` descending. The response SHALL NOT include page bodies and SHALL be served from the runtime cache.

#### Scenario: Empty wiki
- **WHEN** `docs/wiki/` is empty or missing
- **THEN** the API returns `{ pages: [] }` with HTTP 200

#### Scenario: Canonical kind ordering
- **GIVEN** pages of kinds `note`, `meeting`, `finding`, `retro`
- **WHEN** the wiki is listed
- **THEN** the order of kinds is `meeting, finding, note, retro`

### Requirement: GET /api/wiki/[id]?project=NAME returns one page

`GET /api/wiki/<id>?project=<name>` SHALL return the summary fields plus `hash` (sha1 hex of the UTF-8 content) and `content` (full file including frontmatter). `<id>` SHALL match `^W\d{4}$`; otherwise 400 `BAD_REQUEST`. An unknown id SHALL return 404 `NOT_FOUND`.

#### Scenario: Read existing page
- **WHEN** `/api/wiki/W0004?project=p` is requested
- **THEN** the response includes `mtime`, `hash`, `content`, and `diagnostics`

#### Scenario: Legacy id is not an API address
- **WHEN** `/api/wiki/R0004?project=p` is requested
- **THEN** the response is 400 `BAD_REQUEST`

### Requirement: PUT /api/wiki/[id]?project=NAME writes with mtime+hash optimistic lock

`PUT /api/wiki/<id>?project=<name>` with body `{ content, expectedMtime, expectedHash }` SHALL atomically replace the file via a `.tmp.<random>` sibling and rename, and return `{ ok: true, mtime, hash }`. When on-disk mtime or hash differ from the expected values it SHALL return 409 `CONFLICT` with `currentMtime`, `currentHash`, `currentContent`. The target path SHALL pass project-root containment; escapes return 403 `FORBIDDEN`. A write whose new content changes `id` or `kind` SHALL be rejected with 400 `BAD_REQUEST` (identity is changed only through `memon wiki move`), as SHALL a write that touches `reviewed_at` or `reviewed_hash`.

#### Scenario: Successful write
- **WHEN** PUT carries matching `expectedMtime` and `expectedHash`
- **THEN** the file is rewritten and the response carries the new `mtime` and `hash`

#### Scenario: Stale write
- **GIVEN** the file changed on disk after the client read it
- **WHEN** PUT arrives with the old values
- **THEN** the response is 409 with the current mtime, hash, and content

#### Scenario: Identity change rejected
- **WHEN** PUT content changes `id: W0004` to `id: W0040`
- **THEN** the response is 400 and the file is unchanged

### Requirement: Bundle assets are served within the page directory

`GET|HEAD /api/wiki-assets/<project>/<W-id>/<...path>` SHALL serve files from the bundle directory of the page with that id, with correct MIME types, range support, and `etag`/`last-modified` headers. Dot-segments SHALL be rejected with 400 and any path resolving outside the bundle SHALL be rejected without reading it. A Markdown image whose relative target ends in `.html` SHALL render as an unsandboxed same-origin iframe; a Markdown link to the same target SHALL remain a link. The bundle layout contract (`data/*.json` writer-owned, `views/<slug>/index.html`, no manifest, no build step at read time) is identical to the Report bundle contract. In central mode the route SHALL be proxied only to Backends advertising the `wikiAssets` capability, and binary responses SHALL be byte-identical to the source.

#### Scenario: HTML view embeds
- **GIVEN** `docs/wiki/showcase/kernel-map/README.md` containing `![Map](./views/map/index.html)`
- **WHEN** the page renders
- **THEN** the image becomes an iframe sourced from `/api/wiki-assets/<project>/<id>/views/map/index.html`

#### Scenario: Traversal rejected
- **WHEN** `/api/wiki-assets/p/W0003/../../hypotheses.md` is requested
- **THEN** the server rejects the request without reading the escaped path

### Requirement: Wiki refresh uses shared file observations and foreground polling

The runtime SHALL derive Wiki resources from the shared file Store, listing `docs/wiki/` and kind directories and reading required page files or bundle README files. Additions, deletions and content changes SHALL be checked through shared per-operation backoff and become visible through foreground resource heartbeat queries, without Wiki-specific SSE or a second parsed-object cache. Experiment and Report dependencies SHALL participate when needed for staleness or legacy resolution.

#### Scenario: New page appears
- **WHEN** an agent writes `docs/wiki/finding/new.md`
- **THEN** a due directory observation finds the page and the next foreground resource query can return the updated list without a push event

#### Scenario: New kind directory appears
- **WHEN** `docs/wiki/decision/` is created with a first page
- **THEN** the directory is watched from then on and the page is listed

### Requirement: Callouts use GitHub alert syntax

A blockquote whose first line is `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`, or `> [!DEPRECATED] …` SHALL render as a styled callout of that type; any other blockquote renders as an ordinary quotation. `[!DEPRECATED]` additionally carries the section-deprecation semantics defined below.

#### Scenario: Warning callout
- **GIVEN** `> [!WARNING] reference path differs from upstream`
- **WHEN** the page renders
- **THEN** a warning-styled callout appears with that text

### Requirement: Agent-authored HTML is a first-class body form

Free-form HTML SHALL be supported at three scopes. **Inline**: raw HTML (`<div>`, `<svg>`, inline styles, `<table>`) in the body renders in place; `<script>` inside raw HTML SHALL NOT execute. **Block**: the `embed@1` component (payload `data`, optional `height: <px|"auto">`, `title`; declared as `` ```html embed@1 `` or produced by an executable payload) SHALL render its HTML as an unsandboxed same-origin iframe built from the block content (`srcdoc`) inside the shared embed toolbar (zoom, reload, expand, mobile menu); for a bundle page the iframe document SHALL resolve relative URLs against `/api/wiki-assets/<project>/<W-id>/` so `./data/*` and `./views/*` are reachable; for a single-file page only inline and CDN resources are available. **Page**: a bundle page MAY declare frontmatter `entry: ./views/<slug>/index.html`; the dashboard SHALL then render that document as the primary body (full-height iframe through the same toolbar) with the Markdown body shown as notes beneath, and `memon wiki show` SHALL print the entry path. An `entry` that does not exist inside the bundle SHALL produce `WIKI_ENTRY_MISSING` (`error`). Multiple views remain embeddable individually via `![label](./views/<slug>/index.html)`. All HTML forms share the existing v1 trust model (trusted agent-authored, same-origin, not sandboxed, no dev server at read time). Outside the dashboard (`show`, `--format markdown`) `embed` remains a plain fenced block.

#### Scenario: Static SVG renders inline
- **GIVEN** a page body containing a hand-authored `<svg>` bar chart
- **WHEN** the page renders
- **THEN** the SVG is displayed in place without an iframe

#### Scenario: Scripted chart in an html-embed block
- **GIVEN** a bundle page containing a `` ```yaml embed@1 `` block whose function returns `{ data, height: 420 }` and has been run that loads `./data/latency.json` and draws with a CDN library
- **WHEN** the page renders
- **THEN** the block appears as a 420 px iframe with the embed toolbar and the JSON request resolves through the page's asset route

#### Scenario: HTML page entry
- **GIVEN** a `showcase` bundle with `entry: ./views/dashboard/index.html`
- **WHEN** the page opens in the dashboard
- **THEN** the view fills the reading surface with the toolbar, and the Markdown body appears beneath it

#### Scenario: Script in raw HTML is inert
- **GIVEN** `<div><script>alert(1)</script></div>` in the body
- **WHEN** the page renders
- **THEN** the div renders and the script does not execute

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

### Requirement: Opening one page does not wait on project-wide work

A single-page read (`GET /api/wiki/<id>`) and the projection returned after a page write SHALL derive git review state for the requested page only, never for every page of the wiki. The inventory of Run directories that bare Run citations and `@` Run mentions resolve against SHALL be shared by every wiki projection of a Project (list, single page, write, backlinks): concurrent projections SHALL share one directory walk, and once an inventory exists it SHALL be served immediately while a walk older than a short refresh age runs in the background. Failure of a background refresh SHALL keep the last successful inventory. Reads of cited Run metadata SHALL be issued with bounded concurrency, so a projection citing many Runs does not delay the file operations of a concurrent single-page read until all of its own reads finish. The metadata of cited Runs SHALL still be read at request time, so staleness of an already-resolved citation is always current; only whether a newly created or removed Run directory exists may lag by one refresh.

#### Scenario: Page and list requested together
- **GIVEN** a Project with many Run directories and no inventory cached yet
- **WHEN** the page `W0004` and the wiki list are requested concurrently
- **THEN** the Run directories are walked once and both responses use that walk

#### Scenario: Warm page open
- **GIVEN** a Run inventory was built by an earlier wiki request
- **WHEN** `W0004` is requested again
- **THEN** the response is built from the cached inventory without waiting for a new walk
- **AND** an inventory older than the refresh age is refreshed in the background for later requests

#### Scenario: Single page review
- **WHEN** `W0004` is requested from a wiki of 30 pages
- **THEN** git review is derived for `W0004` alone and its `review` field is the same as the list reports for it
