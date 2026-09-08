# Historical implementation record

This is the pre-closeout checklist, including superseded designs and unchecked verification. It is retained as evidence, not the final delivered contract. No unchecked item is retrospectively asserted to have passed.

## 1. Core model (`packages/core`)

- [x] 1.1 Add `W` to `ID_PREFIXES`/`ID_REGEX` in `ids.ts`; verify `ids.test.ts` covers `padId('W', 7) === 'W0007'` and `R`/`E`/`H`/`D` still parse
- [x] 1.2 Create `src/wiki/types.ts` (`WIKI_KINDS`, per-kind status vocabularies, recommended sections, source forms, `WikiFrontmatter`, `WikiSummary`, `WikiDiagnostic`, `ReviewState`) and export from `index.ts`; verify `pnpm --filter @memon/core typecheck`
- [x] 1.3 Implement `src/wiki/frontmatter.ts` parse/serialize preserving unknown keys and key order; verify a unit test round-trips a page with a custom `owner:` key byte-identically outside edited keys
- [x] 1.4 Implement `src/wiki/discover.ts` two-level scan (kind dirs → `.md` | `<slug>/README.md`), unknown-kind tolerance, duplicate slug/id/legacy_id detection; verify a unit test on a temp tree with both forms + an unknown kind dir
- [x] 1.5 Implement `src/wiki/lint.ts` producing every `WIKI_*` code in wiki-store (incl. `WIKI_CLAIM_WITHOUT_EVIDENCE`, `WIKI_UNREVIEWED_VERIFIED`, `WIKI_LEGACY_ID_DUPLICATE`); verify unit tests per code with one positive and one negative case
- [x] 1.6 Implement `src/wiki/staleness.ts` (source parsing for `E`, `E/V`, `H`, `W`, run-dir; Variant existence check against `results.yaml`; last-change resolution; `stale`/`staleSources`; backlink index) ; verify unit tests for "cited experiment moved on" and "missing variant unresolved" (review derivation is task 10.1)
- [x] 1.7 `backend-protocol.ts`: add `BackendWikiSummarySchema`, `BackendWikiDocumentSchema`, `BackendWikiPagesResponseSchema`, `BACKEND_WIKI_ROUTE`, `BACKEND_WIKI_PAGE_ROUTE`, `BACKEND_WIKI_REVIEW_ROUTE`, `BACKEND_WIKI_ASSET_ROUTE`, `wiki-change` topic, `wiki` in `BACKEND_DOCUMENT_KINDS`; `backend-negotiation.ts` `wikiAssets`; verify `backend-protocol.test.ts` / `backend-negotiation.test.ts` extended and passing

## 2. Backend service and routes

- [x] 2.1 `packages/backend/src/document-service.ts`: `discoverWiki`, `listWiki`, `getWiki`, `putWiki` (400 on `id`/`kind` change), `wikiReviewLog`/`markWikiReview`/`unmarkWikiReview` (task 10.3); add `citedBy` to the experiment detail projection; verify service unit tests for list/get/put/conflict/identity-rejection/review
- [x] 2.2 `packages/backend/src/server.ts`: routes `/wiki`, `/wiki/[id]`, `/wiki/review`, `/wiki/review/[sha]`, `/wiki-assets/[project]/[id]/[...path]`, emit `wiki-change` after PUT/review, advertise `wikiAssets`; verify backend server tests hit all routes incl. asset traversal rejection

## 3. CLI (`packages/cli`)

- [x] 3.1 Create `src/commands/wiki.ts` implementing `ls|show|create|move|set|review {log,ls,diff,verify,unverify}|commit|lint|stale|backlinks|migrate-report|components {ls,show,migrate}|deprecate|undeprecate|delete` per wiki-cli (exit codes 2/4/9/1), register under `memon wiki` in `index.ts`; verify `memon wiki --help` lists all fifteen supported top-level commands (`memon-data` recomputation is deferred)
- [x] 3.2 Add `src/commands/wiki.test.ts` covering every wiki-cli scenario against a temp project (create template, slug conflict → 9, meeting without date → 2, move with incompatible status → 2, set stale mtime → 9, review → `VERIFIED`, lint --strict → 1, backlinks incl. `R` markdownReferences, migrate-report file + bundle + lint-abort rollback); verify `pnpm --filter @memon/cli exec vitest run src/commands/wiki.test.ts`

## 4. Skill `memon-wiki`

- [x] 4.1 Create `packages/skills/memon-wiki/SKILL.md` (mode detection via `findmnt`, preflight through the selected channel, evidence discipline, review anti-pattern block, kind selection, lint before handoff, migration workflow, mandatory harness-feedback step, Chinese dialogue templates in block quotes), `references/page-kinds.md`, and `references/html-bundle.md` (adapted copy of the Report bundle reference); add to `SKILL_NAMES`; verify the skills package test passes
- [x] 4.2 Update `packages/skills/README.md` (index, forms, files-written) and `PREFLIGHT.md` (`docs/wiki/`); verify `grep -n "memon-wiki" packages/skills/README.md packages/skills/PREFLIGHT.md` shows both
- [x] 4.3 Copy `packages/skills/memon-wiki/` to `.claude/skills/memon-wiki/`; verify `diff -r` is empty
- [x] 4.4 Smoke-test mode detection: run the skill's detection snippet against `a real sshfs-mounted project (path in LOCAL.md)` and against `mock/project-a`; verify it prints mounted mode with the derived `user@host` + remote root for the former and in-project for the latter (read-only)

## 5. Fixtures

- [x] 5.1 Add `mock/project-a/docs/wiki/` fixtures: `meeting`, `finding` (stale, citing an `E/V` row and a run dir), `finding` (`VERIFIED` + reviewed), `bottleneck`, `showcase` bundle with a view, `note` with `legacy_id` of a non-existent report, `harness-feedback`; verify `memon wiki lint --project-root mock/project-a --strict` exits 0 and `memon wiki stale` lists the stale finding

## 6. Web app (`apps/web`)

- [x] 6.1 Runtime: add `wikiCache` (DirCache opt-in depth-2 mode; depth-1 default untouched), warmup registration, `wiki-change` emit, `resolveByWikiId` in `auth/project-resolver.ts`; verify runtime and `dir-cache` tests pass and reports cache behaviour is unchanged
- [x] 6.2 API routes `app/api/wiki`, `app/api/wiki/[id]`, `app/api/wiki/review` and `app/api/wiki/review/[sha]` (owner-only), `app/api/wiki-assets/[project]/[id]/[...path]`; update `api-route-manifest.ts` and `central/backend-proxy.ts` (`wikiAssets`); verify `curl -u … /api/wiki?project=project-a` returns fixtures with `stale`/`reviewState`/`diagnostics` and a viewer cookie gets 403 on review
- [x] 6.3 `lib/api.ts`: `fetchWiki`, `fetchWikiPage`, `putWikiPage`, `fetchWikiReview`, `markWikiReview`, `unmarkWikiReview`, types; `use-memon-events.tsx`: `wiki-change` → `['wiki', …]`/`['wiki-page', …]`, `experiment-change` and `reports-change` → also `['wiki', …]`; verify typecheck
- [x] 6.4 `lib/artifact-links.ts` + `document-artifact-link-provider.tsx` + `markdown.tsx`: `ArtifactKind 'wiki'`, resolve `W\d{4}`, `R\d{4}` → report-if-exists else `legacyId`, path resolution for `docs/wiki/<kind>/<slug>{.md,/README.md}`; verify artifact-link unit tests incl. both legacy cases
- [x] 6.5 `lib/wiki-workspace-url.ts` + `hooks/use-wiki-workspace.ts` + `components/wiki-pane.tsx`; `terminal-drawer-provider.tsx` three-way slot (terminal/report/wiki), `report=`/`wiki=` mutual exclusion; verify typecheck and a unit test for URL mutual exclusion
- [x] 6.6 `components/wiki-shell.tsx` (flat card rail sorted by updatedAt desc: kind badge + title + description + meta, kind filter, right sticky TOC column, status/stale/review badges, text filter, frontmatter panel, diagnostics block, TOC, Markdown, Monaco edit with conflict flow, owner-only History / Verify next, empty state) and pages `app/p/[project]/wiki[/[id]]` + `app/h/[host]/p/[project]/wiki[/[id]]` with titles; verify typecheck
- [x] 6.7 `app-bar.tsx` + `tab-badge.tsx`: `Wiki` tab right of `Code Review` (last) with count; reuse `report-html-embed.tsx` with a configurable asset base for wiki bundles; verify typecheck
- [x] 6.8 Experiment detail: "Cited by wiki" list from `citedBy` (status/stale/review badges), entries open the side pane; verify on `/p/project-a/e/<fixture exp>` the list shows the fixture findings

## 7. Docs and repo conventions

- [x] 7.1 README.md: add `### Wiki` (layout, kinds table, trust axes, bundle form, CLI cheatsheet, migration path) and the skills table row; verify grep for `memon-wiki` in README
- [x] 7.2 CLAUDE.md: add wiki to the file model, Web endpoints, SSE topics, query keys, CLI subcommands lists; verify grep for `docs/wiki` in CLAUDE.md
- [x] 7.3 Bump `MEMON_RELEASE` to `6.7.0` in `version.ts` per the release policy; verify `version.test.ts`/`release-policy.test.ts` pass

## 8. Verification

- [x] 8.1 Verification recorded: `pnpm -r typecheck` passed. The historical full test run stopped at a core migration-test timeout; that file passed 7/7 when rerun with a 15-second timeout, and change-relevant suites passed. The whole monorepo suite was not established green. The user requested direct archive, so the pre-archive full unit-test suite is skipped under AGENTS.md.
- [x] 8.2 Prod build + HTTP smoke on `/p/project-a/wiki` and `/p/project-a/wiki/W0001`: markup contains flat card rail, kind/status/stale/review badges and right TOC; CSS tokens present; `/p/project-a/reports` unchanged
- [x] 8.4 Migration dry-run: copy one Report from `a real mounted project's `docs/reports` (path in LOCAL.md)` into a temp project with a stub experiment, run `memon wiki migrate-report`, confirm the page lints, `backlinks R<id>` lists the stub's link, and the original copy is removed

## 9. Body component library and deprecation (added mid-proposal)

- [x] 9.1 `apps/web/lib/wiki-components/<slug>@<N>/` (central only; nothing in core/backend/cli): versioned registry (directory scan, unpinned -> latest, pinned resolution, `outdated` flag, optional `migrate` chain) and descriptor contract (`name`, `purpose`, `attributes` zod, `parse`, `toMarkdown`, `lint`) + info-string attribute parser; modules `memon-data@1` (inline/file forms, ragged-row + missing-file validation, `sources` staleness as `data[<n>]:<source>`, `WIKI_DATA_PROVENANCE_MISSING`) and `html-embed@1` (`height`, `title`) only; `components[]` in the page projection; verify unit tests per module incl. unregistered-lang no-diagnostic, `WIKI_COMPONENT_INVALID` attribute and unknown-pinned-version cases, and a two-version fixture component proving old pinned blocks still render and `migrate` rewrites only the block
- [x] 9.2 `packages/core/src/wiki/deprecation.ts`: page-level `deprecated` object validation, section-level `[!DEPRECATED]` detection → `deprecatedSections`, `WIKI_DEPRECATION_INVALID`; list ordering (deprecated last) and stale suppression; frontmatter `entry` validation → `WIKI_ENTRY_MISSING`; verify unit tests
- [x] 9.3 CLI: `components ls|show|migrate` over central HTTP (`--central`/`MEMON_CENTRAL_URL`, exit 2 without), `lint --central` merging central component diagnostics; verify `wiki.test.ts` against a stub central server
- [x] 9.4 Web: `components/wiki-components/memon-data@1.tsx` (table + caption) and `html-embed@1.tsx` (sandboxed srcdoc iframe in the embed toolbar) wired into the shared `markdown.tsx`; routes `GET /api/wiki/components[/[name]]`, `POST /api/wiki/components/lint|migrate`; central computes `components[]` + component lint for served wiki pages; verify an Experiment README with a `memon-data@1` block renders the table and a Backend-served page shows central-computed diagnostics
- [x] 9.5 Descriptor completeness: every registered version has `invalidExamples` whose blocks actually trigger the named lint code and `fixtures` paths that exist and contain a block of that component; verify with a registry test
- [x] 9.6 Fixtures: `mock/project-a/docs/wiki/<kind>/W<NNNN>-<slug>` W0001-W0008 (with `@`-references incl. deliberately unresolved `@H0007`, `@bar-260502-150000`) exercising both registered components (vega-lite/mermaid blocks replaced by `html-embed@1` SVG / plain ```mermaid) (inline `code` + `bash -s` and `script` forms, file-form `memon-data` + collectors under `mock/project-a/scripts/`, `vega-lite` sharing the CSV and inline values, `mermaid`, `html-embed`, bundle with `views/`, pinned `memon-data@1`, unregistered `foo-chart`, callouts), a deprecated page (W0007), a deprecated section (W0003), a reviewed page (W0001), a `harness-feedback` page (W0008); collectors verified by hand to reproduce the saved rows - re-verify with `memon wiki data check` and `lint --strict` once the CLI exists
- [x] 9.7 Skill `memon-author-components` (D9 approved rules): zero-arg SKILL.md (content shape first, plain Markdown default, `memon wiki components ls|show --central` as the only reference, lint + open page, no draft/confirm step, harness-feedback when nothing fits); one routing sentence in `memon-wiki`, `memon-write-experiment-doc`, `memon-run-experiment`, `memon-write-code-review`; README skill matrix row; verify copies in `.claude/skills` are identical and `captured_commit` appears in no SKILL.md

## 10. Wiki review (commit-ordered verification; added mid-proposal)

- [x] 10.1 `packages/core/src/wiki/review.ts`: `.memon/wiki-review.csv` reader/writer (sorted, sequential-mark rule → `REVIEW_ORDER`, cascading unmark), wiki-commit log via `git log -- docs/wiki`, per-page derivation via `git blame --line-porcelain` + working-tree dirty check → `review` object; `review: null` outside git; verify unit tests on a temp git repo covering full/partial/dirty/unverified and the order/cascade rules
- [x] 10.2 Runtime cache: compute `review` for every page on `wiki-change`, `wiki-review-change`, and HEAD change (Poller on `.git/HEAD`, its ref, and `.memon/wiki-review.csv`); SSE `wiki-review-change`; verify no git subprocess runs on `GET /api/wiki` (instrumentation counter)
- [x] 10.3 Backend + web routes `GET /api/wiki/review`, `POST|DELETE /api/wiki/review/[sha]` (owner-only, shell-class, central proxy, accepted by read-only Backends); verify viewer → 403, out-of-order → 409 `REVIEW_ORDER` — (backend done)
- [x] 10.4 CLI `memon wiki review log|ls|diff|verify|unverify` and `memon wiki commit`; verify `wiki.test.ts` covers diff-since-verify, `verify next`, cascade unverify, mixed-index refusal, non-git → 4
- [x] 10.5 Web: History panel (Verify next with diff preview, Unverify with cascade confirmation), review badge + `verifiedThrough` + "changes since verification" link in the frontmatter panel, tinted unverified blocks (theme tokens, both themes), rail badges renamed to `VERIFIED|CHANGED_SINCE_VERIFY|UNVERIFIED`; label commit-marks entries "(deprecated)"; verify via the CLAUDE.md UI protocol plus a screenshot of a partially verified fixture page
- [x] 10.6 Skills: `memon-wiki` commit-per-change rule (`memon wiki commit`, ssh in mounted mode), closing-message review states, trust-on-conflict rule; the one shared trust sentence in `memon-write-experiment-doc` and `memon-drive`; verify no `review verify` text beyond the prohibition
- [x] 10.7 Docs: CLAUDE.md web/CLI surface lists gain the review routes/commands; `openspec/specs/commit-verification` Purpose notes deprecation; verify `openspec validate --strict`
