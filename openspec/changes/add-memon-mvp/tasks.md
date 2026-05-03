## 1. Repo bootstrap

- [x] 1.1 Initialize pnpm workspace at repo root (`package.json`, `pnpm-workspace.yaml` declaring `apps/*` and `packages/*`)
- [x] 1.2 Create base TypeScript config (`tsconfig.base.json`) and per-package `tsconfig.json` extending it
- [x] 1.3 Add Biome config (`biome.json`) for lint + format; add `format`/`lint` scripts at root
- [x] 1.4 Add `lefthook.yml` with pre-commit running Biome + tsc on changed packages
- [x] 1.5 Add `.gitignore` covering `node_modules/`, `.next/`, `dist/`, `config.yml`, `mock-runtime/`, `~/.cache/memon` patterns local to repo
- [x] 1.6 Scaffold `packages/core/`, `packages/cli/`, `apps/web/` with empty entry points and inter-package deps wired (`workspace:*`)

## 2. Core schemas and parsers (`packages/core`)

- [x] 2.1 Define TypeScript types for `Experiment`, `Hypothesis`, `JournalEvent`, `Config`, `Status` (matching specs/experiment-readme/spec.md and specs/hypotheses/spec.md)
- [x] 2.2 Implement `parseReadme(content: string)` using `gray-matter` + zod; emit `{frontMatter, sections, parseErrors[], parseWarnings[]}`
- [x] 2.3 Implement `serializeReadme({frontMatter, body})` preserving section order Motivation/Setup/Method/Result/Conclusion/Caveats/Artifacts/(opt)New Hypotheses
- [x] 2.4 Implement `parseArtifacts(section)` extracting `{path, description}` pairs from list items
- [x] 2.5 Implement `parseHypotheses(content: string)` producing `{summaryTable, entries[]}` with each entry validated by zod
- [x] 2.6 Implement `parseJournal(content: string)` producing `{lastDigestAt, events[]}` with tag enum + per-tag body validators
- [x] 2.7 Implement `serializeJournal` and `appendJournalEvent(path, event)` (read → append-only line write → sync); reject any write touching frontmatter unless `digestMode: true`
- [x] 2.8 Status enum normalization: lowercase → uppercase with parse warning; unknown values → `UNKNOWN` with parse error
- [x] 2.9 Unit tests (vitest): valid/invalid README, invalid status, missing required fields, valid HYPOTHESES with various entries, JOURNAL frontmatter present/absent, all event tag formats

## 3. Discovery and indexing (`packages/core`)

- [x] 3.1 Implement `discoverExperiments(projectRoot, excludes)` using `fast-glob` to find directories matching `^.+-\d{6}-\d{6}$`, applying default + custom excludes
- [x] 3.2 Implement `ExperimentIndex` class: in-memory map of `{id → Experiment}`, methods `add/update/remove/get/list/search`
- [x] 3.3 Implement `Poller`: per-directory poll state (`{interval, lastMtime, nextRunAt}`); event-loop scheduler triggering callback on change; exponential backoff with `min/max/factor` from config
- [x] 3.4 `Poller.resetBackoff(path)` to be invoked on user attention events
- [x] 3.5 Stale-RUNNING detector: configurable threshold (default 1h); flag exposed on each index entry
- [x] 3.6 Unit tests: discovery with nested logs, exclude application, regex edge cases, backoff progression, reset, stale detection

## 4. LineIndex and log tail (`packages/core`)

- [x] 4.1 Implement `LineIndex.build(path)` streaming a one-pass scan; sparse anchor mapping (default every 1024 lines store byte offset)
- [x] 4.2 Implement `LineIndex.range(endLine, count)` returning `{lineNumber, text}[]` using anchor seek + sequential read between anchors
- [x] 4.3 Implement `LineIndex.appendDelta(path)` reading bytes from previous size to current size; extend index without rescan
- [x] 4.4 Implement disk persistence: write index header + offsets to `~/.cache/memon/lineindex/<sha1(path)>.bin`; verify on load with file `mtime + size`
- [x] 4.5 Implement file rotation/truncation detection (size shrink or inode change → invalidate cache)
- [x] 4.6 Unit tests: small file, 1M-line synthetic file, append after build, truncation invalidation, disk cache hit/miss, out-of-range request

## 5. Config loading (`packages/core`)

- [x] 5.1 Implement `loadConfig({explicitPath?, cwd})` resolving order: `explicitPath` → `cwd/config.yml` → null; parse YAML with `js-yaml`; validate with zod
- [x] 5.2 Implement `loadConfig.implicitCwdProject(cwd)` returning a single anonymous project with cwd as root, used by non-`serve` CLI commands when no config found
- [x] 5.3 Implement `mergeExcludes(userExcludes)` returning default set ∪ user set
- [x] 5.4 Author `config.example.yml` at repo root pointing to `./mock/<project>` paths
- [x] 5.5 Unit tests: explicit path wins, cwd lookup, missing config error for `serve`, implicit project for non-`serve`

## 6. CLI (`packages/cli`)

- [x] 6.1 Set up `commander.js` (or similar) with binary `memon`; register subcommands `serve`, `list`, `show`, `search`, `new`, `hypo`, `mock`
- [x] 6.2 Implement `--config` and `--format human|json` global options; default JSON for read commands
- [x] 6.3 Implement `memon list [--project NAME]` — load config, build index, print sorted experiments
- [x] 6.4 Implement `memon show <id> [--format json]` — print raw README or parsed structure
- [x] 6.5 Implement `memon search <query> [--in body|fm]` — substring search across loaded experiments with snippets
- [x] 6.6 Implement `memon new <name> [--project NAME]` — create directory `<root>/logs/<name>-<yymmdd>-<hhmmss>/` with `README.md` + `run.sh` templates; append `[CREATE]` event to JOURNAL.md; collision check
- [x] 6.7 Implement `memon hypo list [--project NAME]` and `memon hypo show <H#> [--project NAME]`
- [x] 6.8 Implement `memon mock seed [--force]` copying `mock/` → `mock-runtime/`; refuse overwrite without `--force`
- [x] 6.9 Implement `memon serve [--config PATH] [--dev] [--port N]` — spawn Next.js with `MEMON_CONFIG_PATH` env var pointing at resolved config
- [x] 6.10 Wire `package.json` `bin: { memon: "./dist/index.js" }` and tsc build
- [x] 6.11 CLI unit tests for output formatters and index builder (full e2e fixture tests deferred to phase 12)

## 7. Web backend (Next.js API routes in `apps/web`)

- [x] 7.1 Set up Next.js 15 (App Router) + TypeScript + Tailwind v4 + `MEMON_CONFIG_PATH` env consumption
- [x] 7.2 Implement `/api/projects` returning configured projects list
- [x] 7.3 Implement `/api/experiments?project=NAME` returning index entries; trigger `Poller.resetBackoff` for accessed experiments
- [x] 7.4 Implement `/api/experiments/[id]` returning single experiment with full parsed README
- [x] 7.5 Implement `PUT /api/readme` accepting `{path, content, expectedMtime, expectedHash?}`; on mtime/hash mismatch return 409 with current content; on success append `[STATUS]` event to JOURNAL.md when applicable, return new mtime
- [x] 7.6 Implement `/api/hypotheses?project=NAME` returning parsed HYPOTHESES.md
- [x] 7.7 Implement `/api/journal?project=NAME&limit=N&before=ISO` returning paged events; `/api/journal/append` for explicit `[NOTE]`/`[REQUEST]` writes (NOT touching `last_digest_at`)
- [x] 7.8 Implement `/api/log` (range) and `/api/log/stream` (SSE) per log-viewer spec; reject paths outside configured project roots with 403
- [x] 7.9 Background worker (singleton, started on first request or via `serve`) running the Poller across all projects; experiment changes broadcast via internal pub-sub
- [x] 7.10 SSE endpoint `/api/events` pushing experiment index updates to subscribed clients
- [ ] 7.11 Backend integration tests deferred to phase 12 (manual verification via fixtures + curl in interim)

## 8. Web frontend (`apps/web/app/`)

- [x] 8.1 Built minimal Tailwind primitives directly (Button/Card/Badge/StatusPill) instead of pulling in shadcn (interactive init blocked). Same visual vocabulary; smaller bundle.
- [x] 8.2 TanStack Query provider with default `staleTime: 5s`, `refetchInterval` adaptive between 5s (fresh) and 30s (steady). Full exponential backoff still TODO; current setup adequate for MVP demo.
- [x] 8.3 Top navigation with project tabs + view tabs (Experiments / Hypotheses / Journal). URLs: `/p/[project]/{,hypotheses,journal,experiments/[id]}`.
- [x] 8.4 Experiment list view with status emoji column, status filter, free-text search across id/name/tags/hypotheses. Default sort `createdAt desc`.
- [x] 8.5 Stale RUNNING `⚠` indicator on StatusPill, sourced from backend `stale` flag.
- [x] 8.6 Experiment detail page: front matter panel, all 8 body sections rendered as markdown, Hypotheses cross-link panel, Artifacts panel, Resources placeholder.
- [ ] 8.7 Status edit control deferred (read-only MVP).
- [ ] 8.8 README editor + localStorage draft deferred.
- [ ] 8.9 Conflict resolution diff view deferred.
- [ ] 8.10 Draft recovery prompt deferred.
- [x] 8.11 Hypothesis view: summary table rendered as-is + per-hypothesis cards with experiment cross-links + emoji status.
- [x] 8.12 Journal timeline view: reverse-chrono list, filter by tag and experiment ID, browser-tz timestamps.
- [x] 8.13 Log viewer component: last 100 lines with absolute line numbers, follow toggle (3s polling), `↑ load 100 earlier` button, jump-to-tail.
- [x] 8.14 Mobile-responsive: Tailwind `md:` grid breakpoints, list collapses to card stack <768px, detail panels stack.
- [ ] 8.15 Component tests deferred to phase 12.

## 9. Mock data

- [x] 9.1 Create `mock/project-a/` with 5 experiments + 1 bare directory: nested logs path, with/without WandB, with/without PID, all 5 status enum values, varied hypothesis links, ~5k-line synthetic stdout.log, edge-case missing README
- [x] 9.2 Create `mock/project-b/` with 4 experiments incl. deeply nested (sub1/sub2/), JOURNAL with CREATE/STATUS/NOTE/REQUEST/ARCHIVE/ERROR tags
- [x] 9.3 Author `mock/project-a/HYPOTHESES.md` (6 entries, all 5 statuses) and `mock/project-b/HYPOTHESES.md` (4 entries) with legend + summary table + entries
- [x] 9.4 Author `mock/project-a/JOURNAL.md` and `mock/project-b/JOURNAL.md` with `last_digest_at` mid-stream; mix all tag types
- [x] 9.5 `config.example.yml` already points `projects` at `./mock/project-a` and `./mock/project-b`
- [x] 9.6 Verified end-to-end: backend live at https://memon-vultr.dev.mem.ac/, /api/projects + /api/experiments + /api/hypotheses + /api/journal + /api/log all return mock data; /etc/passwd request 403'd

## 10. Cross-cutting concerns

- [ ] 10.1 Implement atomic write helper `writeWithRollback({path, content, expectedMtime})` used by both README and JOURNAL writes; pair-coordinated rollback on failure
- [ ] 10.2 Path-confinement helper `assertWithinProjectRoot(path, projects[])` used by all file-reading API endpoints; reject 403 on violation
- [ ] 10.3 Structured logger (`pino`) with environment-controlled level
- [ ] 10.4 Error envelope shape `{error: {code, message, details?}}` used by all CLI and API errors
- [ ] 10.5 Resources hook: `/api/experiments/[id]/resources` returns `{gpu: null, disk: null}` placeholder; frontend renders the panel as "not yet available"

## 11. Documentation and developer onboarding

- [ ] 11.1 Author `README.md` at repo root: 60-second quickstart (`pnpm install && cp config.example.yml config.yml && pnpm dev`), feature overview, file format references with examples
- [ ] 11.2 Author `docs/schemas.md` linking to / inlining the README, HYPOTHESES, JOURNAL schemas (single human-friendly reference)
- [ ] 11.3 Author `CONTRIBUTING.md`: how to add a new section to README schema, how to add a new event tag, code layout overview
- [ ] 11.4 Add `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint` root scripts that fan out to workspaces

## 12. Validation and acceptance

- [ ] 12.1 Manually verify all spec scenarios pass against the implementation by walking through each `Scenario:` block
- [ ] 12.2 Run `openspec validate add-memon-mvp` clean before merging
- [ ] 12.3 Verify mobile responsive on actual phone (or Chrome DevTools 375px) for list, detail, hypothesis, journal views
- [ ] 12.4 Smoke test the CLI as an agent would invoke it: `memon list --format json | jq`, `memon show <id>`, `memon search <q>`
