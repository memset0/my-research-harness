## Purpose

Defines the on-disk wiki page model under `docs/wiki/`, its discovery and diagnostics, staleness and backlink derivation from declared sources, and the list/get/put/asset HTTP contract that the dashboard and Backend expose for it.

## ADDED Requirements

### Requirement: Wiki pages live under `docs/wiki/<kind>/W<NNNN>-<slug>`

A wiki page SHALL be discovered at `<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>.md` (single-file form) or `<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>/README.md` (bundle form). `<slug>` SHALL match `^[a-z0-9][a-z0-9-]*$` and SHALL be unique across every kind directory in the project; the `W<NNNN>` prefix SHALL equal the frontmatter `id` (`WIKI_ID_MISMATCH` otherwise). The slug is the primary human address: the dashboard, CLI, and links SHALL accept a bare slug everywhere an id is accepted, and renaming a slug SHALL be an explicit `move`. Discovery SHALL be exactly two levels deep; files directly under `docs/wiki/`, entries not matching the naming pattern, and entries deeper than the bundle `README.md` SHALL be ignored. A `<kind>` directory whose name is not one of `meeting`, `finding`, `bottleneck`, `showcase`, `question`, `decision`, `note`, `harness-feedback` SHALL still be discovered with `kind` equal to the directory name and SHALL produce the `WIKI_UNKNOWN_KIND` diagnostic.

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

Every page SHALL start with YAML frontmatter. `id` SHALL match `^W\d{4}$` and be unique in the project; `kind` SHALL equal the enclosing directory name; `title` SHALL be a non-empty string; `created_at` and `updated_at` SHALL be ISO8601 timestamps with an explicit offset. `status` SHALL be required and restricted per kind: `finding` `TENTATIVE|VERIFIED|RETRACTED`; `bottleneck` `OPEN|MITIGATED|RESOLVED`; `question` `OPEN|ANSWERED|DROPPED`; `decision` `PROPOSED|ACCEPTED|SUPERSEDED`; `showcase` `DRAFT|READY|OUTDATED`; `harness-feedback` `PROPOSED|ACCEPTED|SHIPPED|REJECTED`; `meeting` and `note` SHALL NOT require `status`. `meeting` SHALL require `date` in `YYYY-MM-DD` form. `finding` SHALL require a non-empty `sources` list. `description` (a one-to-three-sentence plain-text summary of the page, no Markdown), `tags` (string list), `sources` (string list), `legacy_id` (`^R\d{4}$`), `entry` (bundle pages only; relative path to an HTML document inside the bundle),  Keys outside this schema SHALL be preserved verbatim by every write path.

Violations SHALL be reported as diagnostics (`WIKI_ID_INVALID`, `WIKI_ID_DUPLICATE`, `WIKI_KIND_MISMATCH`, `WIKI_TITLE_MISSING`, `WIKI_STATUS_MISSING`, `WIKI_STATUS_INVALID`, `WIKI_DATE_MISSING`, `WIKI_SOURCES_REQUIRED`, `WIKI_TIMESTAMP_INVALID`) with severity `error`; the page SHALL remain readable and listed.

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

### Requirement: Recommended sections are advisory

For each canonical kind the system SHALL define recommended H2 sections: `meeting` Attendees, Notes, Decisions, Action items; `finding` Claim, Evidence, Limits; `bottleneck` Problem, Impact, Status, Candidates; `question` Question, Context, Answer; `decision` Decision, Rationale, Consequences; `showcase` What to show, How to reproduce, Assets; `harness-feedback` Motivation, Proposal, Status; `note` none. A missing recommended section SHALL produce a `WIKI_MISSING_SECTION` diagnostic with severity `warn`. Additional or reordered sections SHALL NOT produce diagnostics.

#### Scenario: Finding without Limits
- **GIVEN** a `finding` page whose body has `## Claim` and `## Evidence` only
- **WHEN** the page is linted
- **THEN** exactly one `WIKI_MISSING_SECTION` warning naming `Limits` is produced

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

### Requirement: Live cache backed by Poller

The runtime SHALL keep an in-memory cache of every project's wiki, warmed at start, watching `docs/wiki/`, every kind directory, and every page file or bundle `README.md` through the shared Poller, beside the existing reports cache. Additions, deletions, and content changes SHALL refresh the cache within the polling window and emit an SSE event of kind `wiki-change` carrying `project`. Because staleness depends on Experiments and legacy resolution depends on Reports, `experiment-change` and `reports-change` events SHALL also cause clients to refetch the wiki list.

#### Scenario: New page appears
- **WHEN** an agent writes `docs/wiki/finding/new.md`
- **THEN** within the polling window the list contains it and a `wiki-change` event fires

#### Scenario: New kind directory appears
- **WHEN** `docs/wiki/decision/` is created with a first page
- **THEN** the directory is watched from then on and the page is listed

### Requirement: Fenced blocks are the single component container

A body component SHALL be expressed as a fenced code block whose info string is `<component>[@<version>] [key=value …]`: the first token selects a registered component (optionally pinning a major version), the remaining `key=value` / `key="quoted value"` tokens are its attributes, and the block body is its payload. The central dashboard SHALL ship the component registry that maps each component version to a payload schema, a React renderer, a Markdown projection, and lint rules; Backends and the CLI SHALL treat component blocks as opaque fenced code (they parse only the info string for `WIKI_COMPONENT_UNPINNED` and pass the body through), and central SHALL compute `components[]` and every `WIKI_COMPONENT_*` / `WIKI_DATA_BLOCK_*` diagnostic when it serves a page. The initial registry SHALL contain exactly `memon-data@1` and `html-embed@1`; further components are added by later central releases. A fenced block whose language is not a registered component SHALL render as an ordinary code block everywhere (dashboard, CLI, GitHub) and SHALL NOT produce a diagnostic — unknown components degrade, never break. Attribute values SHALL be validated per component; an invalid attribute or payload SHALL produce `WIKI_COMPONENT_INVALID` (`error`, message naming the component, version, and the field) and the block SHALL render verbatim as a code block. The page projection SHALL list `components: [{ index, name, version, line }]` so tooling can address blocks by index.

#### Scenario: Unregistered language degrades
- **GIVEN** a page body containing a fenced block with language `foo-chart`
- **WHEN** the page renders and is linted
- **THEN** the block is shown as a plain code block and no diagnostic is produced

#### Scenario: Invalid attribute is reported
- **GIVEN** a fenced `html-embed height=tall` block
- **WHEN** the page is linted
- **THEN** `WIKI_COMPONENT_INVALID` names `html-embed`, its version, and `height`, and the block renders verbatim

#### Scenario: Backend stays opaque
- **GIVEN** a Backend serving a page with a `memon-data@1` block whose payload is invalid
- **WHEN** the Backend's own `GET /wiki/<id>` is called
- **THEN** it returns the raw content with no `WIKI_DATA_BLOCK_INVALID` diagnostic
- **AND** central's `GET /api/wiki/<id>` for the same page reports the diagnostic and `components[]`

#### Scenario: Components are listed
- **GIVEN** a page with one `memon-data@1` and one `html-embed@1` block
- **WHEN** `GET /api/wiki/<id>` is requested
- **THEN** `components` contains both entries with their resolved versions and line numbers

### Requirement: Components are versioned by major version and every version keeps rendering

Each component SHALL live in the central web application at `apps/web/lib/wiki-components/<slug>@<N>/` (never in `@memon/core`, `@memon/backend`, or the CLI artifact, so that adding or changing a component is a central-only PATCH release and no Backend or CLI is reinstalled) where `<N>` is a positive integer major version, and SHALL export a descriptor with `name`, `version`, `description` (what it shows), `args` (every attribute and payload field with type, default, and meaning), `effect` (how the dashboard and Markdown projections render it), `useWhen` (scenarios where it is the right choice, and when it is not), at least one complete `example` block, `invalidExamples` (a list of `{ block, code }` pairs: a wrong block and the diagnostic code it produces), and `fixtures` (project-relative paths of fixture pages in `mock/project-a/docs/wiki/` that render this version). The canonical authored form SHALL be pinned (`memon-data@1`): every template, `refresh`, `create`, and skill output SHALL write the pinned form. An unpinned info string (`memon-data`) SHALL still resolve to the highest registered version at read time but SHALL produce `WIKI_COMPONENT_UNPINNED` (`warn`); `memon wiki components migrate` SHALL rewrite unpinned blocks to the pinned latest version. A pinned info string SHALL resolve to exactly that version. A new major version SHALL be created only when the attribute or payload contract of the previous version cannot accept old blocks unchanged; compatible additions SHALL extend the current version. Every registered version SHALL remain readable, lintable, and renderable forever. A version directory MAY export `migrate(block) -> block | null` that mechanically rewrites a block of the previous version into the new contract; `memon wiki components migrate` SHALL apply such migrations across the wiki and SHALL rewrite the info string to the new pinned version. A version without an automatic migration SHALL NOT offer partial or interactive migration — old blocks simply keep rendering under their pinned version, and the page projection SHALL flag `components[].outdated: true` for any block resolved to a version below the latest. Pinning a version that is not registered SHALL produce `WIKI_COMPONENT_INVALID`.

#### Scenario: Unpinned resolves to latest but warns
- **GIVEN** registered `memon-data@1` and `memon-data@2` and a block whose info string is `memon-data`
- **WHEN** the page renders and is linted
- **THEN** version 2 renders it, `components[0].version` is 2, and `WIKI_COMPONENT_UNPINNED` is reported; `memon wiki components migrate` rewrites the info string to `memon-data@2`

#### Scenario: Old pinned block keeps rendering
- **GIVEN** a block whose info string is `memon-data@1` after `memon-data@2` is registered
- **WHEN** the page renders and is linted
- **THEN** version 1 renders it without diagnostics and `components[0].outdated` is `true`

#### Scenario: Automatic migration rewrites the block
- **GIVEN** `memon-data@2` exports `migrate` and a page with a `memon-data@1` block
- **WHEN** the user runs `memon wiki components migrate`
- **THEN** the block is rewritten to the version 2 contract with info string `memon-data@2` and every other byte of the page is unchanged

#### Scenario: Unknown pinned version
- **GIVEN** a block with info string `memon-data@9`
- **WHEN** the page is linted
- **THEN** `WIKI_COMPONENT_INVALID` is reported and the block renders verbatim

### Requirement: Components render on every Markdown surface of the dashboard

The dashboard's shared Markdown renderer SHALL apply the component registry wherever it renders project Markdown — wiki pages, Experiment README sections, Run READMEs, digests, code reviews, and legacy Reports — so a registered fenced block renders identically regardless of the document that contains it. Relative payload paths (`data:`, `data.url`, iframe `<base>`) SHALL resolve against the asset route of the containing document when it has one (wiki bundles, Report bundles) and SHALL otherwise be reported as unresolvable in the rendered block without failing the page. Only the wiki surfaces SHALL expose component lint diagnostics and `components[]` projections; other document parsers remain unchanged.

#### Scenario: Data block inside an Experiment README
- **GIVEN** an Experiment README whose Findings section contains a `memon-data` block with inline `rows`
- **WHEN** the Experiment page renders
- **THEN** the block renders as the same table component used on wiki pages

#### Scenario: Relative data path outside a bundle
- **GIVEN** a Run README containing a `memon-data@1` block whose `data:` is `./data/x.csv`
- **WHEN** the Run page renders
- **THEN** the block shows an unresolvable-path notice in place of the table and the rest of the README renders

### Requirement: Callouts use GitHub alert syntax

A blockquote whose first line is `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`, or `> [!DEPRECATED] …` SHALL render as a styled callout of that type; any other blockquote renders as an ordinary quotation. `[!DEPRECATED]` additionally carries the section-deprecation semantics defined below.

#### Scenario: Warning callout
- **GIVEN** `> [!WARNING] reference path differs from upstream`
- **WHEN** the page renders
- **THEN** a warning-styled callout appears with that text

### Requirement: Agent-authored HTML is a first-class body form

Free-form HTML SHALL be supported at three scopes. **Inline**: raw HTML (`<div>`, `<svg>`, inline styles, `<table>`) in the body renders in place; `<script>` inside raw HTML SHALL NOT execute. **Block**: the `html-embed` component (attributes `height=<px|auto>`, `title="…"`) SHALL render its payload as an unsandboxed same-origin iframe built from the block content (`srcdoc`) inside the shared embed toolbar (zoom, reload, expand, mobile menu); for a bundle page the iframe document SHALL resolve relative URLs against `/api/wiki-assets/<project>/<W-id>/` so `./data/*` and `./views/*` are reachable; for a single-file page only inline and CDN resources are available. **Page**: a bundle page MAY declare frontmatter `entry: ./views/<slug>/index.html`; the dashboard SHALL then render that document as the primary body (full-height iframe through the same toolbar) with the Markdown body shown as notes beneath, and `memon wiki show` SHALL print the entry path. An `entry` that does not exist inside the bundle SHALL produce `WIKI_ENTRY_MISSING` (`error`). Multiple views remain embeddable individually via `![label](./views/<slug>/index.html)`. All HTML forms share the existing v1 trust model (trusted agent-authored, same-origin, not sandboxed, no dev server at read time). Outside the dashboard (`show`, `--format markdown`) `html-embed` remains a plain fenced block.

#### Scenario: Static SVG renders inline
- **GIVEN** a page body containing a hand-authored `<svg>` bar chart
- **WHEN** the page renders
- **THEN** the SVG is displayed in place without an iframe

#### Scenario: Scripted chart in an html-embed block
- **GIVEN** a bundle page containing a fenced `html-embed height=420` block that loads `./data/latency.json` and draws with a CDN library
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

### Requirement: Data blocks record table data together with the script and commit that produced it

The `memon-data` component's payload SHALL be YAML with: exactly one of `script` (a command line executed from the project root) or `code` (an inline script body, normally a YAML block scalar) with optional `runner` (interpreter command that reads the script from stdin; default `python3 -`; `bash -s` for shell); `captured_at` (required; ISO8601 with offset); `captured_commit` (required; the 40-character git HEAD of the project root at capture time, or `null` when the project is not a git worktree) and optional `captured_dirty: true` when the worktree had uncommitted changes; exactly one of `rows` (inline form: `columns` string list + `rows` list of lists aligned to it) or `data` (file form: a relative path to a CSV or JSON file inside the page bundle whose header/keys are the columns); and optional `title`, `sources` (same forms as page `sources`), `note`. The script contract for both `script` and `code`: run from the project root, exit 0, print to stdout a JSON object `{ "columns": [...], "rows": [[...], ...] }`. The renderer SHALL present the block as a table with a caption showing `title`, `captured_at`, `captured_commit` (abbreviated, marked dirty when applicable), and either the `script` line in code style or a collapsible "Collection script" panel showing `code`; CLI `show --format markdown` SHALL render the inline form as a GFM table followed by the caption and the file form as the caption plus the file path, in both cases followed by `code` in a fenced block when present. A block whose YAML is invalid, whose row widths disagree with `columns`, whose `data` file is missing, or which has both `rows` and `data` or both `script` and `code` SHALL produce `WIKI_DATA_BLOCK_INVALID` (`error`) and render verbatim. A block missing `captured_commit` SHALL produce `WIKI_DATA_PROVENANCE_MISSING` (`warn`). A block whose `sources` resolve to artifacts changed after `captured_at` SHALL mark the page stale with `data[<n>]:<source>` in `staleSources`. A `data` file MAY be shared with `vega-lite` blocks on the same page.

#### Scenario: Inline collection script
- **GIVEN** a `memon-data` block with `code: |` containing a Python script and no `script`
- **WHEN** the page renders
- **THEN** the table shows with a collapsible "Collection script" panel containing the code, and the caption shows the abbreviated `captured_commit`

#### Scenario: Missing commit is a warning
- **GIVEN** a `memon-data` block without `captured_commit`
- **WHEN** the page is linted
- **THEN** `WIKI_DATA_PROVENANCE_MISSING` is reported and the block still renders as a table

#### Scenario: Inline data block renders as a table
- **GIVEN** a `memon-data` block with two columns and three rows and a `script`
- **WHEN** the page renders
- **THEN** a three-row table appears with a caption containing the script command and `captured_at`

#### Scenario: File-form data block
- **GIVEN** a bundle page with `./data/p50.csv` and a `memon-data` block with `data: ./data/p50.csv`
- **WHEN** the page renders
- **THEN** the CSV is shown as a table with the caption, and an `html-embed@1` block on the same page may fetch the same file through the asset route

#### Scenario: Ragged rows are an error
- **GIVEN** a `memon-data` block whose second row has one cell fewer than `columns`
- **WHEN** the page is linted
- **THEN** `WIKI_DATA_BLOCK_INVALID` is reported and the block renders verbatim

#### Scenario: Data captured before its source moved
- **GIVEN** a block with `sources: [E0017/V0068]` and `captured_at` earlier than `E0017`'s effective updated time
- **WHEN** the wiki is listed
- **THEN** the page is `stale` and `staleSources` contains `data[0]:E0017/V0068`

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
