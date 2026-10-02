# Project instructions — memon repository

Canonical instructions for every coding agent in this repository (`CLAUDE.md`
is a symlink to this file). Read the hard rules first. **Before any OpenSpec
or Git operation, you MUST read [`openspec/WORKFLOW.md`](openspec/WORKFLOW.md)**
(workflow routing, lifecycle phases, development entry gate); the
repository-specific requirements at the end of this file supplement it.

## 1. Hard rules

- **No filesystem watchers.** Never use `fs.watch`, `chokidar`, or any
  inotify-based watcher; refresh by polling with exponential backoff (default
  1s → 5min, factor 2). Operators run on shared clusters with hard inotify
  limits. Check: `grep -rnE "fs\.watch|chokidar|watchFile" --include=*.ts packages apps | grep -v node_modules`.
- **Timestamps on disk are ISO8601 with the writer's local offset**
  (`2026-05-03T08:28:00+08:00`). Never write UTC-converted timestamps
  (`toISOString()`). Use `formatIsoLocal` / `formatRunStamp` from
  `packages/core/src/time.ts`.
- **Status enums are uppercase** and defined in `packages/core/src/types.ts`:
  Run `PENDING`/`RUNNING`/`FINISHED`/`INTERRUPTED`/`FAILED`/`UNKNOWN`;
  Experiment `OPEN`/`RESOLVED`/`ABANDONED` (human-only write); Hypothesis
  `CONFIRMED`/`REFUTED`/`PARTIAL`/`OPEN`/`DEFERRED`.
- **Path containment.** Web routes that accept a path parameter MUST pass it
  through `assertWithinProjectRoots()` (`apps/web/lib/server/path-safety.ts`) before
  touching the filesystem. `@memon/backend` services do not use that helper;
  they resolve every path with `resolveContained()` from
  `packages/backend/src/containment.ts` (realpath containment, with
  `mustExist: false` for git paths that may be absent from the worktree). Any new
  path-taking code MUST do one or the other.
- **Optimistic locking for README/document writes.** Writers carry
  `expectedMtime` plus `expectedHash` (low-resolution mtime on NFS); a
  mismatch is a conflict (HTTP 409, CLI exit 9), never a silent overwrite.
- **Storage.** No external database service. Embedded SQLite files are allowed
  as central-side local state: `apps/web/lib/server/ui-preferences-store.ts`,
  `apps/web/lib/server/experiment-results-views-store.ts`,
  `apps/web/lib/server/translation/cache.ts`. Research data stays in project files.
- **Operator data stays out of Git** (see §1.1).
- **Skills** (`packages/skills/memon-*/SKILL.md`) are written in **English**;
  conversation with the user is in **Chinese**. Bundled skills live only in
  `packages/skills/` and reach research projects through `memon install-skills`
  / `memon update`; never copy them into this repository's `.claude/`,
  `.codex/` or `.opencode/` skill directories.
- **Client components never import `@memon/core` at runtime** (it pulls
  `fast-glob` → `fs`). Use `import type { … }` only.
- **Never fork shadcn primitives** in `apps/web/components/ui/` (F3).

### 1.1 Local deployment facts live in `LOCAL.md` (gitignored)

This is public code for a generic tool. Nothing about the operator's real
research projects or deployment may enter Git — no real project names,
dataset/experiment keywords, hostnames, domains, IPs, mesh addresses, SSH
targets, cluster/node names, absolute machine paths, usernames or secrets —
in commits, commit messages, PR text, OpenSpec artifacts, fixtures, mock data
or comments. Tracked examples use the neutral placeholders already in the repo
(`project-a`, `project-b`, `./mock/`, `localhost:3737`).

1. Read `LOCAL.md` at the start of any session touching deployment, release,
   CLI nodes, Caddy, systemd or the central instance; it is the only record of
   real hosts, ports, paths and config locations.
2. Write newly learned deployment facts to `LOCAL.md` (never AGENTS.md, README
   or OpenSpec) in the same turn, and bump its `Last verified:` line.
3. `LOCAL.md` holds pointers to secrets, not secrets (those stay in
   `config.yml` / `~/.config/memon/*.yml`).
4. Before committing, move anything that belongs in `LOCAL.md` out of the diff;
   `git diff --cached | grep -iE '<real host/project name>'` is the last check.
5. On a fresh clone `LOCAL.md` is missing by design; recreate it with sections
   Operator / central node / CLI nodes / dev server / where secrets live.

## 2. Repository map

pnpm monorepo (Node ≥ 20.19, pnpm 10). `pnpm install` also installs the
lefthook pre-commit hooks (`lefthook.yml`: Biome check on staged files +
root `pnpm typecheck`). `pnpm typecheck` is one incremental `tsc -b` over the
TypeScript project references in the root `tsconfig.json`; it reads workspace
packages' source, never their `dist/`, so no build is needed first.
`pnpm build` (each package's `tsconfig.build.json`) alone writes `dist/`.

| Path | Role / source of truth |
|---|---|
| `packages/core` | Shared domain library: types and enums (`src/types.ts`), README/experiment/wiki parsers and serializers, discovery and indexing, polling, project file store, time helpers, release policy (`src/version.ts`: `FS_CONVENTION_VERSION`, `MEMON_RELEASE`), Web/backend wire protocol (`src/backend-protocol.ts`). |
| `packages/backend` | Framework-agnostic domain service layer (project, document, mutation, stream, git, slurm, wiki services behind `createBackendHandler`). Its only runtime consumer is the central Web process, which calls it in-process (`apps/web/lib/server/central/direct-runtime.ts`). No daemon or remote listener. |
| `packages/cli` | The `memon` CLI. Command surface: `memon --help` / `memon <cmd> --help` and `packages/cli/src/index.ts`. |
| `packages/skills` | Bundled `memon-*` agent skills distributed to research projects. |
| `apps/web` | Next.js 15 App Router + Tailwind v4 + shadcn/ui central dashboard, custom `server.ts`, auth. HTTP endpoints: `apps/web/app/api/**/route.ts`. |
| `scripts/` | Repo tooling: `validate-release.mjs`, `wiki-kinds.mjs`, `component-docs.mjs` (`--write` regenerates the component registry barrels, core's name list and the `memon-components` skill table; `--check` runs in the skills build), `migrate-v6-to-v7.*`, `migrate-v7-to-v8.*`. |

Other sources of truth — consult these instead of copying lists here:
- SSE topics: `BACKEND_EVENT_TOPICS` in `packages/core/src/backend-protocol.ts`.
- Wiki kinds and per-kind status vocabularies: `packages/core/src/wiki/kinds.json`.
- Wiki body components: descriptor directories `apps/web/lib/components/<type>/v<N>/`.
- Behavior of every domain: `openspec/specs/<name>/spec.md`.

### 2.1 File model skeleton

- `FS_CONVENTION_VERSION` lives in `packages/core/src/version.ts`.
- **Experiment bundle**: `<projectRoot>/docs/experiments/E<NNNN>-<slug>/` with
  `README.md` plus schema-v1 `implementation.yaml`, `investigation.yaml`,
  `results.yaml`; other folder content is opaque experiment-local scratch.
  Canonical README H2 order: `CANONICAL_EXPERIMENT_SECTION_HEADINGS` in
  `packages/core/src/experiments/documents.ts`. The Experiment README `runs`
  list is the sole Run-membership authority.
- **Run**: a directory `<slug>-<YYMMDD>-<HHMMSS>/` containing `README.md`. No
  H2 section is required (`packages/core/src/readme/parse.ts`,
  `readme/lint.ts`); a Run README records execution facts only. Never write an
  `experiment:` field into a Run README — the parser still reads and lints a
  legacy value, but binding is done with `memon experiment link`. Run
  directories live at the effective `run_dirs` (`--run-dir` > deprecated
  central `run_dirs` > `.memon/project.yml` > default `logs/*`, `outputs/*`,
  `experiments/*`) and never nest inside another Run.
- **Derived index** `.memon/index/` (FS v8): a self-ignored (`.gitignore` `*`),
  rebuildable cache of Run/Experiment/wiki summaries maintained by writers'
  event files; never edited by hand, always safe to delete
  (`memon index rebuild|compact|status`).
- **Project declaration** `.memon/project.yml`: optional, git-tracked,
  `schema_version: 1` plus the optional project layout keys `run_dirs`,
  `include`, `exclude`, `github`; created only by `memon project init`
  (`--from-central <config> --project <name>` copies a central entry's
  layout) or by hand, checked by `memon project lint`.
- **Configuration split**: central `config.yml` Project entries hold only
  the project path and deployment facts (`name`, `root`, `host`, `storage`,
  `storage_group`, `persistent_cache`, `read_only`, `execution`). Layout
  belongs in the project's `.memon/project.yml`; a layout key still in a
  central entry keeps working and wins over the project file, but logs
  `CENTRAL_LAYOUT_DEPRECATED` (`memon project lint --from-central` lists them
  and flags conflicts).
- **Wiki**: `<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>.md` or
  `…/W<NNNN>-<slug>/README.md` (bundle).
- Hypotheses: `docs/hypotheses.md`.

## 3. Failure modes (rules learned the hard way)

**F1. UI work is not done until the rendered output is checked.** Background:
typecheck + HTTP 200 were once reported as "shipped" for unrenderable pages;
Next.js returns 200 on broken renders. Rule: prefer a screenshot/preview tool;
otherwise run §4.3 steps 3–4 (markup grep + CSS token grep) before claiming done.

**F2. Do not hand-roll shadcn setup.** Background: a hand-written
`components.json` skipped the base theme tokens and every semantic class
rendered blank. `components.json` now exists from a real init; add components
with `pnpm dlx shadcn@latest add <names...> --yes`. Never hand-write theme
token blocks in `globals.css`; if a re-init is ever needed, ask the user to run
it interactively.

**F3. Compose, never fork, shadcn primitives.** Files in
`apps/web/components/ui/` are CLI-owned. Domain variants go in a wrapper that
uses the primitive with `cn(…, className)` overrides — pattern:
`apps/web/components/colored-badge.tsx` (`WarningBadge` / `SuccessBadge`).

**F4. Verify the token behind every semantic Tailwind class.** Classes like
`bg-card` / `text-*-foreground` / `border-border` render only if the
`--<token>` variable is defined and exposed through `@theme inline`. Check:
`grep -n -- '--card:' apps/web/app/globals.css`. If a token is missing, stop and
fix the install (F2) before touching more components.

**F5. Never build or clean over a live server's output.** Background: a
validation build reused production's `.next` and the running server served
missing assets. Rule: never run dev, build or cleanup against a live server's
build output; verify the actual output directory of custom entrypoints (do not
assume a `distDir` override took effect); stop the host before rebuilding in
place; after restart verify the page's referenced CSS/JS and real rendering.

## 4. Operator runbooks

### 4.1 HTTP auth

Three modes, evaluated in order (`openspec/specs/auth-system/`): owner session
cookie `memon-session` (login page / `POST /api/auth/login`, rolling 30-day
TTL); owner HTTP Basic (CLI/curl); viewer share cookie `memon-shares` (set by
visiting `/share/<project>/<token>`, read-only, project-scoped, `read`-class
routes only). For automation use Basic with the credentials in `config.yml`:

```bash
MEMON_USER=$(grep -E '^\s*username:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
MEMON_PASS=$(grep -E '^\s*password:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/api/projects
```

- If `auth.password` is absent, the server has never run: start it once; the
  first request writes a random password and `session_secret` to `config.yml`.
- Viewer mode via curl: `SHARE_URL=$(memon share create project-a --label dev --format human)`,
  then `curl -sS -c viewer.txt -L "$SHARE_URL" -o /dev/null` and reuse `-b viewer.txt`.
- HTML pages rewrite 401 to `302 → /login?next=…`; `/api/*` returns a raw 401
  without `WWW-Authenticate`, so send `-u` preemptively. A 401 means missing
  credentials, not a dead server.
- 403 appears only when a viewer requests a project outside their share scope.
- Never read `~/.cache/memon/initial-password.txt` (removed). Never paste
  `auth.password` / `auth.session_secret` into commits, PRs or commands shared
  elsewhere.

### 4.2 Prefer the production build for the dashboard

Dev mode lazy-compiles each route (22–60s first hit); prod serves in
milliseconds. Use prod whenever the user is looking at the dashboard or an API
is exercised; use `pnpm dev` only for active UI iteration or when explicitly
asked. "Restart the dev server" defaults to a prod start. Any change under
`apps/web/**` or `packages/core/**` then needs rebuild + restart. Reuse an
already completed build of the exact release; otherwise stop the old host
first. The server process is `node … server.ts` (tsx), so `pkill -f "tsx
server.ts"` does not match — locate it by port. **Kill the old process before
touching `.next/`**; deleting it under a running server corrupts its manifests
(`ENOENT: build-manifest.json`, every API 500).

```bash
PID=$(ss -ltnp 2>/dev/null | grep 3737 | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
[ -n "$PID" ] && kill "$PID"; sleep 2
ss -ltnp 2>/dev/null | grep 3737 || echo "port free"
rm -rf apps/web/.next                        # only now, and only if a clean build is needed
pnpm --filter @memon/core build              # if packages/core changed
pnpm --filter @memon/web build
cd apps/web && pnpm start > /tmp/memon-prod.log 2>&1 &
```

### 4.3 UI verification protocol (all steps before reporting done)

```bash
# 1. typecheck
pnpm --filter @memon/web typecheck
# 2. server is up
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/
# 3. the served markup contains what was added (class names, data-slot, text)
PAGE=$(curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/p/project-a)
printf '%s' "$PAGE" | grep -oE '<expected classes | data-slot | text>'
# 4. the tokens the page relies on are defined in the CSS it actually loads.
#    Stylesheet URLs come from the HTML: dev serves /_next/static/css/app/layout.css,
#    prod serves hashed, minified files. Static assets need no auth.
for css in $(printf '%s' "$PAGE" | grep -oE '<link rel="stylesheet" href="[^"]+"' | sed -E 's/.*href="([^"]+)"/\1/'); do
  curl -sS "http://localhost:3737$css" | grep -oE -- '--(background|foreground|card|muted|primary):[^;}]+'
done   # every token must print an oklch(...) value
# 5. mobile-sensitive changes: also grep the markup for the responsive classes used
```

## 5. Web app conventions (`apps/web`)

- Import shadcn primitives from `@/components/ui/*` directly (there is no
  re-export shim). Status badges: `components/status-pill.tsx` (lucide icons;
  on-disk status emoji are never rendered).
- Use `cn()` from `@/lib/utils`; don't concatenate class strings except in tiny
  inline cases.
- Modals: shadcn `<Dialog>`, never hand-rolled backdrops. Forms: shadcn
  `Input` / `Select` / `Textarea` / `Label`, never native visible controls.
  Toasts: `sonner`, mounted once in `app/layout.tsx`.
- Data freshness: browser pages do not subscribe to SSE (the only browser
  `EventSource` is the log stream in `components/log-viewer.tsx`). TanStack
  Query refreshes by the default `staleTime` (`lib/get-query-client.ts`) and
  explicit `invalidateQueries` after writes. Every query key comes from the
  constructors in `lib/query-keys.ts` (snapshot-tested shapes); never write a
  key literal in a component, and invalidate through the same constructors.
- Layering: server-only modules live under `lib/server/` and start with
  `import 'server-only'` (`lib/server/layering.test.ts` enforces it); response
  types shared by `app/api/**/route.ts` and `lib/api.ts` live in `lib/dto/`.
- Before non-trivial frontend work (new component, theming, semantic classes,
  composition patterns) re-read <https://ui.shadcn.com/llms.txt>; on demand:
  <https://ui.shadcn.com/docs/skills>, <https://ui.shadcn.com/docs/theming>,
  `https://ui.shadcn.com/docs/components/<name>`.

## 6. Repository-specific OpenSpec and Git requirements

These supplement `openspec/WORKFLOW.md` and take precedence over it. Before
implementation, read `openspec/config.yaml`, the relevant canonical specs and
the applicable active change artifacts; keep artifacts aligned with the code.

- Validate a proposal with `openspec validate <name> --type change` before
  committing it.
- Archive requires user authorization; automatic release does not authorize
  automatic archive.
- The exact subject `release: vMAJOR.MINOR.PATCH` is an exception to the
  commit-message format.
- OpenSpec tooling setup gets its own setup commit and triggers no version bump
  or deployment.

### 6.1 Testing

- During development, pick a small, change-relevant testlist yourself (files or
  cases covering affected behavior and plausible regressions); report the list
  and actual results. Never run the full suite routinely during development,
  release or deployment.
- Full and archive gates run the root `pnpm test`, which rebuilds the
  `@memon/core` and `@memon/backend` dist first; never report a gate from a bare
  `pnpm -r test`, whose suites may import a stale build.
- Shared test fixtures and helpers come from `@memon/test-utils`
  (`packages/test-utils`), and every package's `vitest.config.ts` extends
  `memonVitestPreset` from `packages/test-utils/src/vitest-preset.ts`; extend
  those instead of copying a helper into a test file. Web tests that need no
  DOM declare `// @vitest-environment node`.
- Before archiving (after the user confirms readiness), run the full unit-test
  suite locally; on failure, stop the archive, report and fix. If the user
  explicitly asks to archive directly, the full suite may be skipped — say so;
  never claim an unexecuted suite passed.
- Never run unit tests on remote clusters. A remote node is a CLI/skills
  installation only, maintained by `memon update` (fast-forward pull from its
  trusted remote, CLI build, managed-skill refresh; see `memon update --help`).
  No remote service is deployed or health-gated, and central releases never
  wait on nodes.

### 6.2 Local deployment

- Direct production build + hosting on the local machine (§4.2); never create or
  use systemd services for it.
- Reuse an existing build of the exact release; do not rebuild or re-test just
  to deploy.
- Start the prod host directly, leave it running after the session, check
  readiness. Stop the old host before replacing its build output (F5).
- "Deploy now without tests" skips extra test runs; it never turns unexecuted
  tests into passes.

### 6.3 tasks.md holds implementation work only

`tasks.md` is the apply-phase checklist: code edits, tests, docs, verification
commands. It must not contain user-triggered or downstream steps — no
"Run /opsx:archive", no "Commit + push" (post-archive convention), no "Open a
PR". If apply ends on such an item, fix `tasks.md` instead of leaving a fake
unchecked box.

### 6.4 Release version → commit → push

Changes and releases have independent lifecycles; one change may ship several
versions, and shipping never archives the change.

**Complete a verified release automatically.** When requested implementation is
complete and its release gates pass, don't stop to ask: commit the reviewed
in-scope implementation, advance the version, create the separate release
commit, push, deploy the central service when central artifacts changed, and
verify after deployment. Stop only for a breaking migration or unresolved
product choice, missing credentials/authority, a dirty-worktree change that
can't be isolated, or a failed validation/deployment/rollback check.

Version rules (`MAJOR.MINOR.PATCH`, canonical value `MEMON_RELEASE` in
`packages/core/src/version.ts`):
- `MAJOR` equals `FS_CONVENTION_VERSION`; changing it needs the matching
  reviewed filesystem migration and starts at `.0.0`.
- Any distributed-artifact change (`memon` CLI or bundled skills): `MINOR + 1`,
  `PATCH = 0`. Nodes pick it up via `memon update`; releasing doesn't install it.
- Central Web/gateway-only change: `PATCH + 1`; no reinstall anywhere.
- The initial v6-aligned release was `6.0.0`; later boundaries follow the rules
  above.

Sequence: commit the implementation without a version bump; update the
version; validate with `node scripts/validate-release.mjs`
(`MEMON_CHANGED_SURFACES` ⊆ `central`/`cli`/`skills`/`filesystem`); create a
release commit containing only the version and required release
metadata/assertions, subject exactly `release: vMAJOR.MINOR.PATCH`; push it and
record its full 40-character SHA so central installs that exact revision, not a
moving `latest`. Node/domain/token/SSH values stay in ignored or machine-local
config.

### 6.5 Instruction file convention

`AGENTS.md` is canonical; `CLAUDE.md` must be a relative symlink to it. This
intentionally reverses an earlier Claude-first layout — never flip the link or
move content back into `CLAUDE.md` during installation, repair or tool updates.

### 6.6 Concurrency-safe Git workflow

Assume other agents work concurrently in the same tree.

- **Ownership.** At task start record the baseline status, the selected change
  and the exact paths the task owns; track every file you create, modify or
  delete. Already-modified unrelated paths are not yours; automatic
  apply/archive/commit/push never expands ownership. On a shared change, mark
  only tasks you completed and don't archive until all are done. If an owned
  file changes concurrently, re-read it and rerun verification. Never amend,
  rewrite or discard another agent's work.
- **Staging.** Stage exact paths with `git add -- <path>...`; never
  `git add -A`, `git add .` or `git add -u`. File-level staging is enough; a
  file also edited concurrently by another agent may be committed whole (report
  it as shared). Review the full staged diff before committing.
- **Branches.** "Main branch" is the repository's resolved primary integration
  branch (from config, repo requirements, user instructions; literal `main`
  only as fallback). Commit there unless an instruction authorizes another
  contribution branch. Never create or switch branches, or create/use Git
  worktrees, without explicit authorization for this task (commit/push
  authorization doesn't imply it). If the required branch isn't checked out,
  stop and report. Submodule policy must be documented in this section before
  submodule changes; if absent or ambiguous, ask.
- **Commit and push.** Confirm the branch and its upstream; confirm the staged
  diff is complete and unrelated-free; fetch and verify the branch is not
  behind/diverged. Never merge, rebase, reset, stash or rewrite history to
  recover from a race. Commit only after the applicable setup, implementation,
  validation, sync or archive steps succeed; push non-force to the configured
  upstream. If the remote advanced or rejected the push, fetch, report, and
  leave the local commit intact. Report branch/upstream, hash, subject, paths,
  push result, shared files and remaining uncommitted changes.

### 6.7 Commit messages

Conventional Commits (Angular style) for every commit:
`<type>(<scope>): <description>`, concise imperative subject, standard type
(`feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, …). Breaking
change: `!` before the colon plus a `BREAKING CHANGE:` footer. Pure OpenSpec
archive: `chore(openspec): archive <change-name>`. Example:
`feat(research): add automated experiment runner`.

### 6.8 Authoring an FS-convention migration guide

Before writing `packages/core/migrations/v<N>-to-v<N+1>.md` for a
`FS_CONVENTION_VERSION` bump, read `openspec/specs/fs-migration-guide-authoring/spec.md`
and follow its seven-section structure, verification standards, edge cases and
fixed commit format (`chore(memon): migrate FS convention v<N> -> v<N+1>`). Do
not improvise: the guide is the migrate-fs runtime's only contract.
