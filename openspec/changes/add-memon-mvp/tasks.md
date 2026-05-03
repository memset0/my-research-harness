## 1. Repo bootstrap

- [ ] 1.1 Initialize pnpm workspace at repo root (`package.json`, `pnpm-workspace.yaml` declaring `apps/*` and `packages/*`)
- [ ] 1.2 Create base TypeScript config (`tsconfig.base.json`) and per-package `tsconfig.json` extending it
- [ ] 1.3 Add Biome config (`biome.json`) for lint + format; add `format`/`lint` scripts at root
- [ ] 1.4 Add `lefthook.yml` with pre-commit running Biome + tsc on changed packages
- [ ] 1.5 Add `.gitignore` covering `node_modules/`, `.next/`, `dist/`, `config.yml`, `mock-runtime/`, `~/.cache/memon` patterns local to repo
- [ ] 1.6 Scaffold `packages/core/`, `packages/cli/`, `apps/web/` with empty entry points and inter-package deps wired (`workspace:*`)

## 2. Core schemas and parsers (`packages/core`)

- [ ] 2.1 Define TypeScript types for `Experiment`, `Hypothesis`, `JournalEvent`, `Config`, `Status` (matching specs/experiment-readme/spec.md and specs/hypotheses/spec.md)
- [ ] 2.2 Implement `parseReadme(content: string)` using `gray-matter` + zod; emit `{frontMatter, sections, parseErrors[], parseWarnings[]}`
- [ ] 2.3 Implement `serializeReadme({frontMatter, body})` preserving section order Motivation/Setup/Method/Result/Conclusion/Caveats/Artifacts/(opt)New Hypotheses
- [ ] 2.4 Implement `parseArtifacts(section)` extracting `{path, description}` pairs from list items
- [ ] 2.5 Implement `parseHypotheses(content: string)` producing `{summaryTable, entries[]}` with each entry validated by zod
- [ ] 2.6 Implement `parseJournal(content: string)` producing `{lastDigestAt, events[]}` with tag enum + per-tag body validators
- [ ] 2.7 Implement `serializeJournal` and `appendJournalEvent(path, event)` (read → append-only line write → sync); reject any write touching frontmatter unless `digestMode: true`
- [ ] 2.8 Status enum normalization: lowercase → uppercase with parse warning; unknown values → `UNKNOWN` with parse error
- [ ] 2.9 Unit tests (vitest): valid/invalid README, invalid status, missing required fields, valid HYPOTHESES with various entries, JOURNAL frontmatter present/absent, all event tag formats

## 3. Discovery and indexing (`packages/core`)

- [ ] 3.1 Implement `discoverExperiments(projectRoot, excludes)` using `fast-glob` to find directories matching `^.+-\d{6}-\d{6}$`, applying default + custom excludes
- [ ] 3.2 Implement `ExperimentIndex` class: in-memory map of `{id → Experiment}`, methods `add/update/remove/get/list/search`
- [ ] 3.3 Implement `Poller`: per-directory poll state (`{interval, lastMtime, nextRunAt}`); event-loop scheduler triggering callback on change; exponential backoff with `min/max/factor` from config
- [ ] 3.4 `Poller.resetBackoff(path)` to be invoked on user attention events
- [ ] 3.5 Stale-RUNNING detector: configurable threshold (default 1h); flag exposed on each index entry
- [ ] 3.6 Unit tests: discovery with nested logs, exclude application, regex edge cases, backoff progression, reset, stale detection

## 4. LineIndex and log tail (`packages/core`)

- [ ] 4.1 Implement `LineIndex.build(path)` streaming a one-pass scan; sparse anchor mapping (default every 1024 lines store byte offset)
- [ ] 4.2 Implement `LineIndex.range(endLine, count)` returning `{lineNumber, text}[]` using anchor seek + sequential read between anchors
- [ ] 4.3 Implement `LineIndex.appendDelta(path)` reading bytes from previous size to current size; extend index without rescan
- [ ] 4.4 Implement disk persistence: write index header + offsets to `~/.cache/memon/lineindex/<sha1(path)>.bin`; verify on load with file `mtime + size`
- [ ] 4.5 Implement file rotation/truncation detection (size shrink or inode change → invalidate cache)
- [ ] 4.6 Unit tests: small file, 1M-line synthetic file, append after build, truncation invalidation, disk cache hit/miss, out-of-range request

## 5. Config loading (`packages/core`)

- [ ] 5.1 Implement `loadConfig({explicitPath?, cwd})` resolving order: `explicitPath` → `cwd/config.yml` → null; parse YAML with `js-yaml`; validate with zod
- [ ] 5.2 Implement `loadConfig.implicitCwdProject(cwd)` returning a single anonymous project with cwd as root, used by non-`serve` CLI commands when no config found
- [ ] 5.3 Implement `mergeExcludes(userExcludes)` returning default set ∪ user set
- [ ] 5.4 Author `config.example.yml` at repo root pointing to `./mock/<project>` paths
- [ ] 5.5 Unit tests: explicit path wins, cwd lookup, missing config error for `serve`, implicit project for non-`serve`

## 6. CLI (`packages/cli`)

- [ ] 6.1 Set up `commander.js` (or similar) with binary `memon`; register subcommands `serve`, `list`, `show`, `search`, `new`, `hypo`, `mock`
- [ ] 6.2 Implement `--config` and `--format human|json` global options; default JSON for read commands
- [ ] 6.3 Implement `memon list [--project NAME]` — load config, build index, print sorted experiments
- [ ] 6.4 Implement `memon show <id> [--format json]` — print raw README or parsed structure
- [ ] 6.5 Implement `memon search <query> [--in body|fm]` — substring search across loaded experiments with snippets
- [ ] 6.6 Implement `memon new <name> [--project NAME]` — create directory `<root>/logs/<name>-<yymmdd>-<hhmmss>/` with `README.md` + `run.sh` templates; append `[CREATE]` event to JOURNAL.md; collision check
- [ ] 6.7 Implement `memon hypo list [--project NAME]` and `memon hypo show <H#> [--project NAME]`
- [ ] 6.8 Implement `memon mock seed [--force]` copying `mock/` → `mock-runtime/`; refuse overwrite without `--force`
- [ ] 6.9 Implement `memon serve [--config PATH] [--dev] [--port N]` — spawn Next.js with `MEMON_CONFIG_PATH` env var pointing at resolved config
- [ ] 6.10 Wire `package.json` `bin: { memon: "./dist/cli.js" }` and esbuild/tsc build script
- [ ] 6.11 CLI integration tests: each subcommand against a fixture project under `__fixtures__/`

## 7. Web backend (Next.js API routes in `apps/web`)

- [ ] 7.1 Set up Next.js 15 (App Router) + TypeScript + Tailwind v4 + `@MEMON_CONFIG_PATH` env consumption
- [ ] 7.2 Implement `/api/projects` returning configured projects list
- [ ] 7.3 Implement `/api/experiments?project=NAME` returning index entries; trigger `Poller.resetBackoff` for the most recently accessed
- [ ] 7.4 Implement `/api/experiments/[id]` returning single experiment with full parsed README
- [ ] 7.5 Implement `PUT /api/readme` accepting `{path, content, expectedMtime, expectedHash?}`; on mtime/hash mismatch return 409 with current content; on success append `[STATUS]` or `[NOTE]` event to JOURNAL.md when applicable, return new mtime
- [ ] 7.6 Implement `/api/hypotheses?project=NAME` returning parsed HYPOTHESES.md
- [ ] 7.7 Implement `/api/journal?project=NAME&limit=N&before=ISO` returning paged events; `/api/journal/append` for explicit `[NOTE]`/`[REQUEST]` writes (NOT touching `last_digest_at`)
- [ ] 7.8 Implement `/api/log` (range) and `/api/log/stream` (SSE) per log-viewer spec; reject paths outside configured project roots with 403
- [ ] 7.9 Background worker (singleton, started on first request or via `serve`) running the Poller across all projects; experiment changes broadcast via internal pub-sub
- [ ] 7.10 SSE endpoint `/api/events?project=NAME` pushing experiment index updates to subscribed clients
- [ ] 7.11 Backend integration tests: each endpoint against fixture data; conflict path on `PUT /api/readme`; SSE log stream

## 8. Web frontend (`apps/web/app/`)

- [ ] 8.1 Install shadcn/ui CLI and add base components (`button`, `card`, `dialog`, `dropdown-menu`, `table`, `tabs`, `toast/sonner`, `input`, `textarea`, `badge`, `skeleton`)
- [ ] 8.2 Set up TanStack Query provider; configure global `refetchInterval` policy with exponential backoff via `staleTime` + custom function
- [ ] 8.3 Top navigation with project selector (reads `/api/projects`); URL `/projects/:project/...`
- [ ] 8.4 Experiment list page using TanStack Table: status emoji column, filter by status/tags/hypotheses, free-text search, default sort `created_at desc`
- [ ] 8.5 Stale RUNNING badge in list rows when `mtime` exceeds threshold
- [ ] 8.6 Experiment detail page: front matter panel, rendered body sections, Hypotheses panel (cross-link to `H#`), Artifacts panel, Resources placeholder
- [ ] 8.7 Status edit control on detail page invoking atomic README + JOURNAL write
- [ ] 8.8 README editor: `@uiw/react-md-editor` modal/inline; localStorage draft auto-save keyed by `<path>:<mtime>`
- [ ] 8.9 Conflict resolution UI: on 409, show `react-diff-viewer-continued` with three actions (keep/discard/merge)
- [ ] 8.10 Draft recovery prompt on editor open (`Restore N min draft / Discard from disk`); auto-discard outdated drafts
- [ ] 8.11 Hypothesis view: render `## Summary table` raw + per-entry collapsible cards with cross-links
- [ ] 8.12 Journal view: reverse-chronological timeline; filter by tag, by experiment ID; render timestamps in browser timezone via `date-fns-tz`
- [ ] 8.13 Log viewer component used in detail page: initial last 100 lines + line numbers, SSE follow, infinite scroll up, follow-pause/resume on scroll
- [ ] 8.14 Mobile-responsive layout (Tailwind `md:` breakpoints): list collapses to cards <768px; detail panels stack
- [ ] 8.15 Component-level tests (vitest + Testing Library): list filtering, conflict view, draft recovery, log viewer follow

## 9. Mock data

- [ ] 9.1 Create `mock/project-a/` with 6-8 experiments covering: nested logs paths, with/without WandB, with/without PID, all status enum values, varied hypothesis links, large `stdout.log` (~50MB synthetic), edge-case missing README
- [ ] 9.2 Create `mock/project-b/` with 4-5 experiments, distinct hypotheses, JOURNAL with at least one of every event tag
- [ ] 9.3 Author `mock/project-a/HYPOTHESES.md` and `mock/project-b/HYPOTHESES.md` with full schema (legend, summary table, ~6 entries each, all 5 statuses represented)
- [ ] 9.4 Author `mock/project-a/JOURNAL.md` and `mock/project-b/JOURNAL.md` with `last_digest_at` set to a timestamp midway through events; mix all tag types
- [ ] 9.5 Update `config.example.yml` to point `projects` at `./mock/project-a` and `./mock/project-b`
- [ ] 9.6 Verify end-to-end: `cp config.example.yml config.yml && pnpm dev` brings up the dashboard with all mock data visible

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
