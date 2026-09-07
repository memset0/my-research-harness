## Context

Reports are 15 files in the real project today, all written by `memon-write-report`, read through `/api/reports*`, `InboxShell`, `ReportPane`, and cross-linked by bare `R<NNNN>` tokens from Experiments. They have no CLI, no typing beyond "markdown vs bundle", no notion of evidence freshness, and no channel for human review or for feeding harness improvements back. The wiki is added beside Reports; Reports stay fully functional and are migrated page by page, editorially, by humans and agents together.

Three principles drive every decision below:

1. **Truth lives in Experiments.** A wiki page is not authoritative by itself; it cites the Experiment / Variant / Run evidence it rests on, and the system derives freshness from that declaration instead of trusting prose.
2. **Human review confers indirect trust.** Humans verify *wiki commits* oldest-to-newest ("wiki review"); a page is `VERIFIED` only when every line and asset is covered by the verified prefix, `CHANGED_SINCE_VERIFY` when later commits or uncommitted edits touched it, `UNVERIFIED` otherwise. Agents therefore commit every wiki change separately.
3. **Co-evolution with the harness.** The `memon-wiki` skill ends every task by writing improvement candidates as `harness-feedback` pages. Users pick from that queue and drive `/opsx:propose` in this repo.

## Goals / Non-Goals

Goals
- One typed knowledge base per project under `docs/wiki/`, editable by agents (CLI/skill), humans (dashboard editor), and plain file edits.
- Stable ids (`W<NNNN>`), project-unique slugs, one kind per page, per-kind status vocabularies, tolerant reading + strict lint (same posture as Experiment sections).
- Explicit evidence / status / review axes, each with its own owner.
- Coexistence with Reports; a one-command editorial migration path per Report.
- Mounted (sshfs) and in-project skill operation.

Non-Goals
- Removing `docs/reports/`, `memon-write-report`, or any Report surface. No FS convention bump.
- Full-text search beyond a client-side filter.
- Page history beyond git.
- Web-side page creation/deletion (CLI + skill own creation; web renders, edits, reviews).
- Per-project custom kinds. New kinds arrive through harness changes; that is the feedback loop working as intended.

## Decisions

### D1.

- Files: `docs/wiki/<kind>/W<NNNN>-<slug>.md` or `docs/wiki/<kind>/W<NNNN>-<slug>/README.md`; the slug is the human address (CLI/links accept it first), the prefix keeps ids visible in listings.
- Links: `[text](@<ref>)` and bare `@<ref>` resolve across all rendered Markdown to wiki (id or slug), Experiment, Report, Hypothesis, Run; unresolved -> plain text + `WIKI_LINK_UNRESOLVED` on wiki pages. Replaces the bare `R<NNNN>` token linking for new content; the old token linking stays for Reports. On-disk model

```
docs/wiki/
├── meeting/2026-09-01-weekly-sync.md
├── finding/vsa-common-path-debt.md
├── bottleneck/c256-leaf-wrapper-roundtrip.md
├── showcase/fa4-kernel-map/            # bundle form
│   ├── README.md
│   ├── data/*.json
│   └── views/<slug>/index.html
├── question/…  decision/…  note/…
└── harness-feedback/wiki-needs-attachment-kind.md
```

- Page path: `docs/wiki/<kind>/<slug>.md` or `docs/wiki/<kind>/<slug>/README.md` (bundle). Slug regex `^[a-z0-9][a-z0-9-]*$`, unique across all kinds.
- `WIKI_KINDS = ['meeting','finding','bottleneck','showcase','question','decision','note','harness-feedback']`. A subdirectory outside this list is still discovered (kind = directory name) and produces lint `WIKI_UNKNOWN_KIND`.
- Bundle form reuses the Report bundle contract verbatim (`data/` writer-owned, `views/<slug>/index.html`, image-form `.html` embeds as same-origin iframes, no manifest). Served at `/api/wiki-assets/<project>/<W-id>/<...path>`.
- Frontmatter (YAML):

| key | required | owner | notes |
|---|---|---|---|
| `id` | yes | CLI | `W<NNNN>`, unique |
| `kind` | yes | CLI | must equal directory name → lint `WIKI_KIND_MISMATCH` |
| `title` | yes | author | display title (H1 fallback for display only; lint error when absent) |
| `description` | no | author | 1–3 plain-text sentences summarising the page; shown by `ls` and in the rail |
| `status` | per kind | author | see D2 |
| `date` | meeting only | author | `YYYY-MM-DD` |
| `tags` | no | author | string[] |
| `sources` | no | author | string[]; see D3 |
| `legacy_id` | no | `migrate-report` | `R<NNNN>` |

| `entry` | no (bundle only) | author | relative HTML document rendered as the primary body → lint `WIKI_ENTRY_MISSING` |
| `deprecated` | no | author/human | `{ at, reason, superseded_by? }`; page sorted last, never `stale`, banner on render. Section level: `> [!DEPRECATED] since <date>: <reason>` under a heading |
| `created_at`, `updated_at` | yes | CLI/author | ISO8601 with offset |

Unknown keys preserved verbatim on every write.

### D2. Kinds, status vocabularies, recommended sections

| kind | status enum | required frontmatter | recommended H2s (lint `WIKI_MISSING_SECTION` warn) |
|---|---|---|---|
| `meeting` | — | `date` | Attendees, Notes, Decisions, Action items |
| `finding` | `TENTATIVE`/`VERIFIED`/`RETRACTED` | `sources` non-empty | Claim, Evidence, Limits |
| `bottleneck` | `OPEN`/`MITIGATED`/`RESOLVED` | — | Problem, Impact, Status, Candidates |
| `question` | `OPEN`/`ANSWERED`/`DROPPED` | — | Question, Context, Answer |
| `decision` | `PROPOSED`/`ACCEPTED`/`SUPERSEDED` | — | Decision, Rationale, Consequences |
| `showcase` | `DRAFT`/`READY`/`OUTDATED` | — | What to show, How to reproduce, Assets |
| `note` | — | — | free-form |
| `harness-feedback` | `PROPOSED`/`ACCEPTED`/`SHIPPED`/`REJECTED` | — | Motivation, Proposal, Status |

Status is written by the author (agent or human); the system never auto-transitions it. Missing recommended H2s are warnings only.

### D3. Evidence: sources, staleness, backlinks

- Source forms: `E<NNNN>[-slug]`, `E<NNNN>[-slug]/V<NNNN>` (a Variant inside that Experiment's `results.yaml`), `H<NNNN>`, `W<NNNN>`, run directory base name. The Variant form is the preferred citation for a `finding`: it points at the exact Results row.
- Last-change resolution: `E…` and `E…/V…` → Experiment `effectiveUpdatedAt`; run dir → run `updated_at` else README mtime; `H…` → `docs/hypotheses.md` mtime; `W…` → target page `updated_at`. Unresolvable → lint warn `WIKI_SOURCE_UNRESOLVED`, ignored for staleness; a Variant id absent from the Experiment's Results → `WIKI_SOURCE_UNRESOLVED` too.
- `stale = sources.some(src => src.updatedAt > page.updated_at)`; summary carries `stale` and `staleSources`. Computed in the list projection from caches already in memory.
- Backlinks: inverted index `artifact → W-ids`. Experiment detail response gains `citedBy: { id, slug, kind, title, status, stale, reviewState }[]`.
- Lint `WIKI_CLAIM_WITHOUT_EVIDENCE` (warn): a `finding` whose body cites no `E`/`V`/run identifier at all, even if `sources` is non-empty — prose must point at evidence, not only the frontmatter.

### D4. Wiki review (commit-ordered human verification)

- Storage `.memon/wiki-review.csv` (`sha,verified_at,note`), independent of the deprecated `.memon/commit-marks.csv`. Wiki commit = any commit touching `docs/wiki/`. Marks are sequential (oldest first; out-of-order → `REVIEW_ORDER`), unmark cascades to newer marks. `verifiedThrough` = newest mark.
- Derivation (core `src/wiki/review.ts`): `git log --format=%H -- docs/wiki` for the commit list; per page `git blame --line-porcelain <path>` + `git diff --name-only`/`git status --porcelain docs/wiki` for dirty state → `review: { state, verifiedThrough, verifiedAt, unverifiedCommits, unverifiedRanges, dirty }`. Computed in the runtime cache on `wiki-change`, `wiki-review-change`, and HEAD change (Poller watches `.git/HEAD` + the ref it points to and `.memon/wiki-review.csv`); never on the request path. Non-git root → `review: null`.
- Write paths: `POST|DELETE /api/wiki/review/<sha>` (owner-only, `shell`-class; read-only Backends accept because `.memon/` is not project content) and `memon wiki review verify|unverify`. SSE `wiki-review-change` invalidates `['wiki', project]` and `['wiki-review', project]`.
- CLI: `memon wiki review log|ls|diff|verify|unverify`, `memon wiki commit` (stages only `docs/wiki/`, refuses mixed index, subject `wiki: …`). `ls --review STATE` uses the derived state.
- Web: History panel (Verify next / Unverify, diff preview via the existing git history dialog filtered to `docs/wiki/`), review badge + tinted unverified blocks in the reading pane, "changes since verification" diff link.
- Trust rule for agents (skill): trust by default; on contradiction prefer VERIFIED lines > covered lines of CHANGED pages > UNVERIFIED; unresolved → ask the user quoting both passages.
- `commit-verification` (commit-marks) is deprecated: unchanged behaviour, UI entries labelled deprecated, no longer consulted for wiki trust; removal is a later change.
### D5. Coexistence with Reports and identifiers

- `ID_PREFIXES` gains `'W'`. Report regex, Report cache, `/api/reports*`, `ReportPane`, `memon-write-report`: untouched.
- Artifact inventory: `W<NNNN>` → wiki page; `R<NNNN>` → Report when it exists, else wiki page whose `legacy_id` matches, else plain text. Path-based link resolution adds `docs/wiki/<kind>/<slug>{.md,/README.md}`.
- `memon wiki migrate-report <R-id> <kind> [<slug>] [--status S]`: copies the Report file or bundle into `docs/wiki/<kind>/<slug>{.md|/}`, allocates `W<next>`, sets `kind`, `legacy_id: R<NNNN>`, `status`, keeps `title`/`created_at`/`selector`/unknown keys, sets `updated_at`, deletes the Report, prints old/new paths. Refuses when the slug is taken (9). Relative links elsewhere are left alone: the renderer resolves the Report path form only while the Report exists, so the migrating agent runs `memon wiki backlinks R<NNNN>` and fixes any Markdown links in the same session — the skill's migration workflow makes that explicit.

### D6. Core module and services

- `packages/core/src/wiki/`: `types.ts`, `frontmatter.ts` (parse/serialize via existing `yaml-engine`), `discover.ts` (two-level scan), `lint.ts`, `staleness.ts`, `review.ts` (body hash + state), `index.ts`. Exported from `@memon/core`; client bundles import types only.
- `packages/backend/src/document-service.ts`: `discoverWiki`, `listWiki`, `getWiki`, `putWiki` (rejects `id`/`kind` changes), `reviewWiki`; `BACKEND_DOCUMENT_KINDS` gains `'wiki'`. Same `.tmp.<rand>` + rename and 409 body as Reports.
- `backend-protocol.ts`: `BackendWikiSummarySchema` (`id ^W\d{4}$`, `slug`, `kind`, `title`, `status`, `date`, `tags`, `sources`, `legacyId`, `stale`, `staleSources`, `reviewState`, `reviewedAt`, `mtime`, `updatedAt`, `format`, `diagnostics[]`), `BackendWikiDocumentSchema` (+ `hash`, `content`), routes `BACKEND_WIKI_ROUTE`, `BACKEND_WIKI_PAGE_ROUTE`, `BACKEND_WIKI_REVIEW_ROUTE`, `BACKEND_WIKI_ASSET_ROUTE`, topic `wiki-change`. Capability `wikiAssets` added beside `reportAssets`.
- `apps/web/lib/runtime.ts`: `wikiCache: DirCache<WikiSummary>` over `docs/wiki/*/` — `DirCache` gains an opt-in depth-2 mode; depth-1 stays the default so reports/digests/code-reviews are unaffected. `onUpdate` emits `wiki-change`.

### D7. CLI (`memon wiki …`)

All commands take `--project-root <p>` and `--format json|human` (`ls`/`show` also `markdown`). `<page>` accepts `W<NNNN>` or slug.

| command | effect | exit |
|---|---|---|
| `ls [--kind K] [--status S] [--tag T] [--stale] [--review STATE] [--source A] [--no-description]` | every page file with `path` + `description`, sorted kind → updated_at desc | 0 |
| `show <page> [--body-only]` | frontmatter + body + diagnostics | 0 / 4 not found |
| `create <kind> <slug> --title T [--description D] [--status S] [--date D] [--source A]... [--tag T]... [--bundle]` | allocate next `W`, write template with recommended H2s | 0 / 2 invalid kind, status, date / 9 slug taken |
| `move <page> <kind>[/<slug>] [--status S]` | relocate; rewrites `kind`; id unchanged | 0 / 2 / 9 |
| `set <page> [--status S] [--title T] [--description D] [--date D] [--add-source A] [--rm-source A] [--add-tag T] [--rm-tag T] [--expected-mtime]` | frontmatter-only edit, bumps `updated_at` | 0 / 2 / 9 |
| `review log|ls [--state S]|diff <page>|verify <sha|next>|unverify <sha>` | D4; `verify`/`unverify` are human-only | 0 / 4 / 9 |
| `commit [-m S]` | stage+commit only `docs/wiki/`; subject `wiki: S` | 0 / 2 / 9 |
| `lint [page] [--strict]` | diagnostics; `--strict` exit 1 on any error | 0 / 1 |
| `stale` | pages with `stale: true` | 0 |
| `backlinks <artifact>` | pages whose `sources` contain the artifact; for `R<NNNN>` also Markdown files linking the Report path | 0 |
| `migrate-report <R-id> <kind> [<slug>] [--status S]` | D5 | 0 / 2 / 4 / 9 |
| `components ls|show <name>[@N]|migrate [page] [--dry-run]` | via central HTTP (`--central`); exit 2 without a central address | 0 / 2 / 4 |
| `deprecate <page> --reason R [--superseded-by W] [--at ISO]` / `undeprecate <page>` | page-level deprecation object | 0 / 4 |
| `delete <page> [--force]` | delete; bundle requires `--force` when it holds non-README content | 0 / 2 |

Body edits are intentionally not a CLI concern: agents edit the Markdown file directly (mounted or local).

### D8. Web

- Routes: `/p/[project]/wiki`, `/p/[project]/wiki/[id]`, central mirrors. API: `GET /api/wiki`, `GET|PUT /api/wiki/[id]`, `POST|DELETE /api/wiki/review/[sha]`, `GET /api/wiki/review`, `GET|HEAD /api/wiki-assets/[project]/[id]/[...path]`. Manifest + central proxy gate on `wikiAssets`.
- `WikiShell` (new; `InboxShell` unchanged): flat card rail ordered by `updatedAt` desc (deprecated last) with kind badge + title + description + meta line, kind filter + text filter; right sticky outline (TOC) column on desktop; entry = title + status badge + stale dot + review badge; text filter over title/slug/tags; selected page renders frontmatter panel, diagnostics block, TOC, Markdown, Monaco edit (existing components); "Mark reviewed" button for owners, disabled when `REVIEWED`.
- `WikiPane` beside `ReportPane`; URL params `wiki` / `wikiSurface`; `lib/wiki-workspace-url.ts`; the right-side slot arbitration in `terminal-drawer-provider.tsx` becomes three-way (terminal / report / wiki), opening one hides the others; `report=` and `wiki=` are mutually exclusive in the URL — setting one removes the other.
- Experiment detail: "Cited by wiki" list, entries open the side pane.
- AppBar: `Wiki` tab with count badge to the right of `Code Review` (last tab). SSE `wiki-change` invalidates `['wiki', project]` and `['wiki-page', project, id]`; `experiment-change` additionally invalidates `['wiki', project]`; `reports-change` invalidates `['wiki', project]` too (legacy-id resolution depends on Report presence).

### D8b. Body component library

One container, one registry, three HTML scopes.

- **Container**: fenced code block, info string `<component> key=value …` (CommonMark; remark exposes `lang` + `meta`). Unregistered lang → ordinary code block, no diagnostic. This is chosen over raw `<div data-*>` (opaque to lint/TOC), Pandoc `:::` fenced divs (non-standard, ugly on GitHub), and MDX (compile step, brittle for agent-written text).
- **Registry lives on the host (central)**: `apps/web/lib/wiki-components/<slug>@<N>/`. Backends/CLI are opaque to components (structural `WIKI_COMPONENT_UNPINNED` only); central computes `components[]`, component lint, and rendering when it serves a page, and exposes `GET /api/wiki/components[/<name>[@N]]`, `POST /api/wiki/components/lint|migrate` for the CLI (`--central`/`MEMON_CENTRAL_URL`). A component change is a central-only PATCH release: no peer reinstall. Old layout note: previously planned under `packages/core`: one directory per component *major version*, each exporting a descriptor `{ name, version, description, args, effect, useWhen, example[], attributes (zod), parse, toMarkdown, lint, migrate? }`; `index.ts` scans the directories. Authored form is always pinned (`memon-data@1`); unpinned still resolves to the highest `N` but lints `WIKI_COMPONENT_UNPINNED` and `components migrate` pins it. A new `N` only when old blocks cannot be accepted unchanged; every old `N` stays renderable forever so old pages never break. `migrate(block)` is optional and purely mechanical - `memon wiki components migrate` chains it across the wiki and rewrites the info string to the pinned latest; a version without `migrate` is simply skipped (no half-automatic path). `apps/web/components/wiki-components/<slug>@<N>.tsx` holds the matching renderers. `memon wiki components ls|show|migrate` read the descriptors directly - the CLI is the component reference; no generated Markdown copy exists. Adding or bumping a component is a harness change: edit this repo, ship through the normal release; the skills' harness-feedback step is how the need surfaces.
- **One renderer everywhere**: the registry plugs into the shared `markdown.tsx` renderer, so wiki pages, Experiment/Run READMEs, digests, code reviews, and Reports all render registered blocks identically. Relative payload paths resolve against the containing document's asset route when it has one; otherwise the block shows an unresolvable-path notice. Only wiki parsers emit component diagnostics; other parsers are untouched, and non-wiki skills are *not* taught the components - authoring guidance lives solely in `memon-author-components`.
- **Initial registry is minimal**: `memon-data@1` and `html-embed@1` only (`vega-lite`, `mermaid`, and the aaron-derived candidates below are recorded, not shipped). `memon-data` (YAML; inline `rows` or `data:` file; `script` command or inline `code` + `runner`; `captured_at` + `captured_commit`/`captured_dirty` stamped by `refresh`; check via CLI; dashboard **Saved / Live** toggle - Live calls `POST /api/wiki/[id]/data/[index]/capture`, an owner-only `shell` route proxied on the `wikiCapture` capability that runs the collector and returns rows without writing; differing rows badge the Saved view `stale`, a non-zero exit shows `collector broken` with the stderr tail; Saved is always the default and page staleness never depends on Live), `vega-lite` (JSON spec; relative `data.url` through the asset route; rendered with `vega-embed` static), `mermaid`, `html-embed` (attrs `height`, `title`; `srcdoc` iframe in the existing embed wrapper; `<base href>` injected for bundle pages), `math` (existing KaTeX path formalised). Callouts use GitHub alert blockquotes (`[!NOTE]/[!TIP]/[!IMPORTANT]/[!WARNING]/[!CAUTION]/[!DEPRECATED]`). Further components are decided case by case when a real page needs one.
- **Agent-written HTML is first-class at three scopes**: inline raw HTML (already renders; scripts inert), block (`html-embed`), page (bundle frontmatter `entry: ./views/x/index.html` → full-height iframe as the primary body, Markdown beneath). Declarative components are the preferred path, not the only path; the skill states its choice.
- **Data**: `data/*.csv|json` inside a bundle is the canonical store when a table is large or shared; `memon-data` inline `rows` is for small tables where a readable diff matters. `vega-lite` and `memon-data` may point at the same file. `memon wiki data refresh` rewrites the file (file form) or the block (inline form) and only `captured_at` in the block; never runs on the read path.
- **API**: `GET /api/wiki/<id>` returns `components: [{index, name, line}]`; lint emits `WIKI_COMPONENT_INVALID`, `WIKI_DATA_BLOCK_INVALID`, `WIKI_ENTRY_MISSING`.

### D8c. Future consolidation (FS v7, out of scope here)

When Reports are fully migrated, a later change bumps `FS_CONVENTION_VERSION` to 7 and folds the remaining stores into the wiki: `docs/reports/` (removed once empty) and `docs/code-review/` + `docs/experiments/*/code-review/` (as a reserved kind `code-review`, keeping the current `<YYYY-MM-DD>-<slug>` naming inside `docs/wiki/code-review/`). The kind name `code-review` is therefore reserved now: `memon wiki create code-review …` exits 2 with a message pointing at `memon-write-code-review` until that change lands. Digests stay separate (cursor-advancing).

### D9. Skills: `memon-wiki` and `memon-author-components`

- `memon-wiki` (`packages/skills/memon-wiki/SKILL.md` + `references/page-kinds.md`, `references/html-bundle.md`): page lifecycle, kinds, evidence anchoring, review boundary, mounted-vs-in-project detection, Report migration, harness feedback. It does not describe components; it contains one routing sentence to `memon-author-components`. `memon-write-experiment-doc`, `memon-run-experiment`, `memon-write-code-review` get the same single sentence.
- `memon-author-components` (new, `packages/skills/memon-author-components/SKILL.md`, zero-argument manual, no `references/` of its own). Approved rules (user-reviewed from the aaron-premier survey, items 1/2/4/5/6/7):
  1. Manual + pointers: SKILL.md says how to choose, where to look, how to verify; it never lists component fields. The component reference is the CLI itself: `memon wiki components ls` / `show <name>[@N]` scan the registry directories, so docs cannot drift from code and no generated Markdown file is kept.
  2. Name the content shape before picking a component ("a table whose numbers must be reproducible", "a diagram of the pipeline"); default is plain Markdown - most sections use no component.
  3. Each descriptor also carries `invalidExamples: [{ block, code }]` (a wrong block and the lint code it triggers); `components show` prints them after the valid examples.
  4. Coverage is the fixture wiki: `components show` ends with `Rendered examples: mock/project-a/docs/wiki/...` pointers derived from the descriptor's `fixtures` list; no separate coverage page.
  5. Finish with `memon wiki lint --strict` (read the diagnostics text, not just the exit code) and, when a dashboard is reachable, open the page . No "ask the user which component" or "show a draft first" step - the lint/render loop is the feedback.
  Plus the already-required rules: run collector scripts by hand and paste the rows into `memon-data` (automatic `data refresh`/live capture is deferred, see below); if no component fits, write raw HTML at the right scope and file a `harness-feedback` page.
- Not adopted: "pick the lowest rung of the ladder and state the reason" (item 3), pack-directory versioning, `open` links to absolute local paths, lossy HTML->MD projection.

