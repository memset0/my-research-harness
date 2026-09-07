## Why

Reports (`docs/reports/R<NNNN>-*`) are write-once, theme-keyed narratives. They cannot represent the living knowledge a research project accumulates — meeting decisions, verified conclusions, current bottlenecks, showcase-ready artifacts, open questions — nor can they tell the reader when an Experiment they cite has moved on, nor whether a human has reviewed what an agent wrote. The project needs one place where all of that is maintained continuously, co-evolving with Experiments and with the harness itself.

## What Changes

- **New `docs/wiki/` knowledge base, additive to Reports.** Pages are typed by `kind` (`meeting`, `finding`, `bottleneck`, `showcase`, `question`, `decision`, `note`, `harness-feedback`; one kind per page, extensible through future harness changes), carry a stable `W<NNNN>` id, a project-unique slug, kind-specific `status`, `tags`, and `sources` (Experiment / Variant / Run / Hypothesis / Wiki references). Single-file and static-bundle (HTML views) forms both exist, reusing the Report bundle contract. `docs/reports/` and every Report surface remain unchanged; no FS convention bump.
- **Three explicit trust axes per page**: evidence (`sources`, resolved to Experiment data; derived `stale`), author judgement (`status`), human review (*wiki review*: humans verify wiki commits oldest-to-newest; per page derived `review.state` = `VERIFIED` / `CHANGED_SINCE_VERIFY` / `UNVERIFIED` with the exact unverified line ranges and commits). Marks live in `.memon/wiki-review.csv`, are written only by humans (dashboard History panel or `memon wiki review verify`), and are independent of the older commit-marks system, which this change deprecates.
- **Staleness and backlinks** derived from `sources`: a page is stale when any cited source changed after the page's `updated_at`; every Experiment page lists the wiki pages that cite it.
- **`memon wiki` CLI**: `ls`, `show`, `create`, `move`, `set`, `review`, `lint`, `stale`, `backlinks`, `migrate-report`, `delete`; `--format json|human|markdown`.
- **Gradual Report migration by humans + agents**: `memon wiki migrate-report <R-id> <kind> [<slug>]` moves one Report into the wiki, records `legacy_id: R<NNNN>`, and deletes the Report; `R<NNNN>` references resolve to the Report while it exists and to the wiki page afterwards.
- **Web**: `Wiki` tab added beside `Reports`; kind-grouped rail with status / stale / review badges and a text filter; detail view with frontmatter panel, diagnostics, Monaco edit, "Mark reviewed"; side-pane workspace (`?wiki=W0007&wikiSurface=split|drawer`) sharing the single right-side slot with Reports and the terminal; bare `W<NNNN>` identifiers and `docs/wiki/...` links resolve; Experiment detail shows "Cited by wiki".
- **New skill `memon-wiki`** (bundled source in `packages/skills/memon-wiki/`, installed into this repo's `.claude/skills/` immediately). It authors and updates any page kind, anchors every claim to Experiment evidence, detects whether it runs inside a project root or against an sshfs `mounted/<cluster>/<project>` path (deriving host and remote path from `findmnt`), and ends every task with a mandatory *harness feedback* step that records improvement candidates as `harness-feedback` pages for later OpenSpec proposal. `memon-write-report` stays.

## Capabilities

### New Capabilities
- `wiki-store`: on-disk page model, discovery, diagnostics, evidence/status/review axes, staleness and backlink derivation, list/get/put/review/asset HTTP contract, live cache + SSE.
- `wiki-cli`: `memon wiki ...` subcommand contract including `migrate-report`.
- `wiki-viewer`: dashboard rendering of the wiki (tab, grouped rail, detail, badges, review action, Experiment backlinks, page titles).
- `wiki-workspace`: side pane and artifact-link navigation for wiki pages, coexisting with the Report workspace.
- `memon-wiki-skill`: the bundled `memon-wiki` skill: mode detection, evidence-anchored authoring per kind, review boundary, harness-feedback step.

### Modified Capabilities
- `report-workspace`: the single right-side slot is shared by terminal, Report, and wiki surfaces; bare `W<NNNN>` and `docs/wiki/...` links resolve; `R<NNNN>` falls back to a wiki page via `legacy_id` once the Report is gone.
- `runtime-cache`: wiki cache added beside the reports cache.
- `web-layout`: AppBar gains a `Wiki` tab with a count badge.
- `web-dashboard`: Report HTML embed behavior applies to wiki bundle pages via the wiki asset route; viewer-mode nav lists Wiki.
- `page-titles`: `Wiki · <project>` and `W<NNNN> · Wiki · <project>`.
- `commit-verification` (MODIFIED): the commit-marks system is deprecated - it remains functional and unchanged in behaviour, but its UI entry points are labelled deprecated and it is not consulted for wiki trust; wiki review replaces it for `docs/wiki/`.
- `memon-skills`: `memon-wiki` and `memon-author-components` added to the bundle and invocation policy; preflight scope adds `docs/wiki/`. Component authoring guidance lives only in `memon-author-components`; other writer skills delegate with one sentence.
- `memon-cli`: `wiki` command group registered.
- `cluster-backend-api`: `wiki` document kind, wiki routes, `wikiAssets` capability, `wiki-change` topic added.

## Impact

- `packages/core`: `ids.ts` (`W` prefix), `types.ts`, `backend-protocol.ts` (wiki schemas/routes/topic), `backend-negotiation.ts` (`wikiAssets`), new `wiki/` module (parser, serializer, discovery, lint, staleness, review state). No change to `version.ts` FS constant; release `6.7.0`.
- `packages/backend`: `document-service.ts` (`discoverWiki`, `listWiki/getWiki/putWiki`, `wikiReviewLog/markWikiReview/unmarkWikiReview`, `citedBy` on experiment detail), `server.ts` routes.
- `packages/cli`: `commands/wiki.ts`, registration in `index.ts`.
- `packages/skills`: add `memon-wiki/` (+ `references/`); update `README.md`, `PREFLIGHT.md`; copy into `.claude/skills/memon-wiki/`.
- `apps/web`: new `app/api/wiki*`, `app/api/wiki-assets`, `app/p/[project]/wiki*`, `app/h/[host]/p/[project]/wiki*`, `components/wiki-shell.tsx`, `components/wiki-pane.tsx`, `lib/wiki-workspace-url.ts`, `hooks/use-wiki-workspace.ts`; update `app-bar.tsx`, `tab-badge.tsx`, `use-memon-events.tsx`, `artifact-links.ts`, `document-artifact-link-provider.tsx`, `markdown.tsx`, `runtime.ts`, `api.ts`, `api-route-manifest.ts`, `central/backend-proxy.ts`, `auth/project-resolver.ts`, `terminal-drawer-provider.tsx`, Experiment detail page.
- `mock/project-a`: add `docs/wiki/` fixtures; Reports fixtures unchanged.
- Docs: `README.md` gains a `### Wiki` section; `CLAUDE.md` file-model and surface lists.
- Deployment: Backend/CLI artifact change → `6.7.0`; Backends and central reinstall the same revision; projects run `memon install-skills` to receive `memon-wiki`. No project migration required.
