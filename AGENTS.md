# Project instructions — repo conventions and hard-won lessons

These instructions apply to every coding agent working in this repository.
Read them before doing UI work, before touching shadcn, and before claiming
a task is done.

## Failure modes I've already paid for (don't repeat)

### F1. Claiming UI work is done without looking at the rendered output

**What I did wrong:** I used `pnpm typecheck` passing + `curl -o /dev/null -w "%{http_code}"` returning 200 as proof a feature worked. I committed and reported "shipped" multiple times for pages that were actually unrenderable in a browser.

**Hard rule:** A UI change is not done until I have BOTH:

1. Fetched the served HTML (`curl http://localhost:3737/...`) and confirmed the **markup contains the components I claim to have added** (search for class names, data-slot attributes, the actual text).
2. Fetched the compiled CSS (`curl http://localhost:3737/_next/static/css/app/layout.css?...`) and confirmed the **Tailwind classes I'm using have rules generated** AND **any CSS variables they reference are actually defined in `:root`**. Specifically, search the CSS for `--background:`, `--foreground:`, `--card:`, etc. — if those tokens aren't there, every `bg-card` / `text-foreground` in the page silently falls back to inherit/transparent, and the page looks blank-but-still-200-OK.

If a screenshot/preview tool is available, prefer that over curl. Otherwise the two-curl check is the minimum bar.

`200 OK` proves nothing. The Next.js dev server returns 200 on completely broken renders.

### F2. Hand-rolling shadcn config to bypass interactive init

**What I did wrong:** `pnpm dlx shadcn@latest init` has interactive prompts (component library, preset, base color). I couldn't pipe answers cleanly so I hand-wrote a minimal `components.json` and ran `shadcn add <name>` directly. This *partially* worked but only injected per-component CSS variables (e.g. `shadcn add sidebar` added `--sidebar*` only). The base theme tokens (`--background`, `--foreground`, `--card`, `--muted`, `--primary`, `--secondary`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`) were never written. Every semantic class I subsequently added rendered as broken CSS.

**Hard rule:** When the project needs shadcn or a similar tool with interactive setup:

1. **Ask the user to run `init` themselves.** Tell them which answers to pick. Don't try to bypass it.
2. After init, use `pnpm dlx shadcn@latest add <names...> --yes` for components — this works non-interactively once `components.json` exists from a real init.
3. **Never hand-write theme token blocks in `globals.css`** — that's the canonical output of `shadcn init`, not something to fabricate.

### F3. Forking shadcn components instead of composing

**What I did wrong:** Added `success` and `warning` variants to `components/ui/badge.tsx` directly. This breaks the contract that the file is CLI-overwritten by `shadcn add`, and makes future updates dangerous.

**Hard rule from the [shadcn skills doc](https://ui.shadcn.com/docs/skills):** **NEVER fork shadcn primitives.** If you need a domain-specific variant, create a wrapper component that uses the shadcn primitive underneath with `cn(... , className)` overrides. Example: see `apps/web/components/colored-badge.tsx` for `WarningBadge` / `SuccessBadge` wrapping `Badge`.

### F4. Trusting semantic Tailwind classes without verifying the token

**What I did wrong:** Wrote `bg-card` / `text-foreground` / `border-border` etc. across many files and assumed they'd render because the Tailwind v4 docs say so. They only render if the corresponding CSS variable is defined AND `@theme inline` exposes it as `--color-card: var(--card)`.

**Hard rule:** When introducing or changing a `bg-*-foreground` / `text-*-foreground` / `border-*` semantic class, grep `apps/web/app/globals.css` for the matching `--<token>` variable. If it isn't there, **stop and fix the install (F2)** before touching more components.

## Repo-specific conventions

### Local deployment info lives in LOCAL.md (gitignored)

This repo is public-facing code for a generic tool. **Nothing about the
operator's actual research projects or the concrete deployment may enter
git**: no real project names, dataset/experiment keywords, hostnames,
domains, IPs, mesh addresses, SSH targets, cluster/node names, absolute
paths on real machines, usernames, or secret values. That includes
commits, commit messages, PR text, OpenSpec `proposal.md`/`design.md`/
`specs/`/`tasks.md`, test fixtures, mock data, and code comments. Tracked
examples use the neutral placeholders already in the repo (`project-a`,
`project-b`, `./mock/`, `localhost:3737`).

All of that machine/operator-specific information goes in **`LOCAL.md` at
the project root**, which is listed in `.gitignore`. Rules:

1. **Read `LOCAL.md` at the start of any session that touches deployment,
   release, CLI nodes, Caddy, systemd, or the central instance.** It
   is the only place the real hostnames, ports, paths, and config-file
   locations are recorded.
2. **Write new deployment facts to `LOCAL.md`, never to AGENTS.md, CLAUDE.md, README,
   or OpenSpec.** If you learn something local while working (a new host,
   a moved config path, a changed port), update `LOCAL.md` in the same
   turn and bump its `Last verified:` line.
3. **`LOCAL.md` holds pointers to secrets, not secrets.** Passwords,
   session secrets, and service tokens stay in `config.yml` /
   `~/.config/memon/*.yml`; `LOCAL.md` only records which file holds what.
4. Before committing, if the diff mentions anything that belongs in
   `LOCAL.md`, move it there and scrub the tracked file. `git diff
   --cached | grep -iE '<a real host/project name>'` is a cheap last check.
5. `LOCAL.md` missing on a fresh clone is expected; recreate it from the
   structure above (Operator / central node / CLI nodes / dev server /
   where secrets live) rather than inlining the facts elsewhere.

### Stack

- pnpm monorepo: `packages/core` (TypeScript types, parsers, polling, indexing, LineIndex), `packages/cli` (memon CLI), `apps/web` (Next.js 15 App Router + Tailwind v4 + shadcn/ui)
- Node.js ≥ 20.19 required; pnpm 10.x
- No external DB, no fs watcher (cluster-safe polling with exponential backoff)
- **File model** (`FS_CONVENTION_VERSION === 6`):
  - **Experiment bundle** = `<projectRoot>/docs/experiments/E<NNNN>-<slug>/`
    containing `README.md`, `implementation.yaml`, `investigation.yaml`, and
    `results.yaml` (all three YAML files declare `schema_version: 1`).
    The enclosing folder `E<NNNN>-<slug>/` is a sanctioned scratch
    space for experiment-local artifacts (smoke-run scripts, sbatch
    templates, multi-launch helpers, ad-hoc analysis utils tied to
    one experiment). Other sibling files and sub-directories are opaque user
    content; `code-review/` is optional.
    The canonical README H2 order is Motivation, Design, Implementation,
    Investigation, Results, Findings, Limitations, Conclusion, Warnings.
    Implementation, Investigation, and Results contain exact one-line pointers
    to their YAML sources; section render/fetch projects those YAML files as
    human-readable Markdown. Unknown or duplicate H2 sections are lint errors
    but remain losslessly readable. Frontmatter: `id`, `slug`,
    `title`, `status` (`OPEN` / `RESOLVED` / `ABANDONED`, human-only
    write), `archived` (bool), `runs[]`, `hypotheses[]`, `tags[]`,
    `created_at`, `updated_at`.
  - **Run** = `<projectRoot>/<…>/<slug>-<YYMMDD>-<HHMMSS>/README.md`.
    Owns four H2 sections: `Motivation` (optional, rendered when
    populated), `Setup` (required), `Result` (required), `Artifacts`
    (required). `## Method`, `## Conclusion`, `## Caveats` are
    **forbidden** on the run side — the parser surfaces
    `RUN_HAS_METHOD` / `RUN_HAS_CONCLUSION` / `RUN_HAS_CAVEATS`
    warnings. Per-run methodology folds into `## Setup`; per-run
    findings into `## Result`; cross-run interpretation and evidence limits
    live in the parent Experiment's Findings and Limitations. Frontmatter carries
    `experiment: E<NNNN>-<slug>` (or null/absent for orphans),
    `status` (`PENDING`/`RUNNING`/`FINISHED`/`INTERRUPTED`/`FAILED`/`UNKNOWN`),
    `archived` (bool), `updated_at`, plus the existing
    host/pid/gpus/entry/command/wandb fields. The `entry:` field
    SHALL be relative to the project root (e.g. `scripts/erdos/run.sh`),
    so `bash <entry>` from project root re-runs the script.
  - Both parsers emit a `UNKNOWN_H2_SECTION` parse warning when an
    H2 heading falls outside the canonical list — content is
    preserved verbatim, the warning surfaces in `parse_warnings` for
    user adjudication.
  - Hypotheses live in `docs/hypotheses.md`; per-H entries can
    reference experiments (`Experiments:` field listing E IDs) and/or
    specific runs (`Runs:` field listing run dir base names).
  - **Wiki** = `<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>.md` or
    `…/W<NNNN>-<slug>/README.md` (bundle). Kinds: `meeting`, `finding`,
    `bottleneck`, `showcase`, `question`, `decision`, `note`,
    `harness-feedback` (unknown kind dirs tolerated, `WIKI_UNKNOWN_KIND`).
    Frontmatter `id`, `kind`, `title`, `description`, `status` (per-kind
    vocabulary), `date` (meeting), `sources[]` (finding required),
    `tags[]`, `legacy_id`, `entry`, `deprecated{at,reason,superseded_by}`,
    `created_at`, `updated_at`. Derived, never written, and **Web/backend
    only**: `stale` / `staleSources` (from `sources`) and `review` (from git:
    marks in `.memon/wiki-review.csv`, commit-ordered; `VERIFIED` /
    `CHANGED_SINCE_VERIFY` / `UNVERIFIED` with `unverifiedRanges`). The CLI
    derives neither — page commands run no git at all.
    Body components are fenced blocks `memon-data@1` / `html-embed@1`;
    the registry lives ONLY in `apps/web/lib/wiki-components/` (central),
    the CLI treats them as opaque code. Reports remain; the old
    commit-marks system is deprecated in favour of wiki review.
  - TS internal naming: `Run` = run dir record; `Experiment` = exp
    doc record. `discoverRuns` / `RunIndex` / `archiveRun` are
    run-side; `discoverExperiments` / `parseExperimentReadme` /
    `serializeExperimentReadme` / `computeMembership` are exp-side.
    `EXPERIMENT_DIR_REGEX` matches the canonical `E<NNNN>-<slug>`
    folder name.

### Web / CLI / SSE surfaces

Listed here so a fresh session can wire up new code without re-discovering
the layout.

**Web action bars** (rendered at the top of every exp-doc detail page,
plus inline at the top of each expanded run panel):
- `Edit markdown` — opens `ReadmeEditor` in a Dialog with an
  id-addressed `target = { kind: 'exp', id }` (or `'run'`). The
  underlying call hits `PUT /api/experiments/:id/readme` or
  `PUT /api/runs/:id/readme`. Component: `EditMarkdownButton` in
  `apps/web/components/edit-markdown-button.tsx`.

**CLI subcommands**:
- `memon experiment ls` — list exp docs in the project
- `memon experiment show <id-or-slug>` — print one exp doc
- `memon experiment create <slug> [--title T] [--from-run <run-dir>]` —
  allocate next E<NNNN>, create `docs/experiments/E<NNNN>-<slug>/`,
  and atomically create the README plus all three schema-v1 YAML documents
- `memon experiment doc {show,render,validate,lint} <id> [section]` —
  read/check the structured bundle; these commands do not provide YAML CRUD
- `memon experiment results summary <id>` — show declared Result columns and
  Variant row identities without parameter/metric cell values or execution details
- `memon experiment results annotation {get,set} ...` — optional focused
  read/upsert helpers for sparse Markdown `column_annotations`; direct
  `results.yaml` editing remains supported
- `memon experiment link|unlink <exp> <run>` — bidirectional bind
- `memon experiment delete <exp> [--force]` — cascade-unlink + delete
  the experiment folder. Default ignores the four canonical bundle files but
  refuses other scratch content; `--force` removes the whole folder
- `memon experiment warning add <exp-id-or-run-dir> [--run <r>] --category C --message M` —
  permanently supported compatibility entry that writes to the Experiment's
  `## Warnings`; every warning CLI invocation prints exactly one
  non-suppressible `[deprecated]` notice directing Agents to
  `memon-write-experiment-doc`. The run-dir-id form is
  supported and writes through to the parent exp doc (with `--run`
  disallowed in that form)
- `memon run rename <run> <new-slug>` — rename preserving timestamp suffix
- `memon experiment {status set,readme write,archive,unarchive}` —
  legacy aliases. Each emits a one-line `[deprecation]` banner to
  stderr. Use `memon run {status set,readme write,archive,unarchive}`
  in new code. Set `MEMON_QUIET_DEPRECATIONS=1` to silence the banner.
- `memon wiki ls|show|create|move|set|delete|lint|stale|backlinks|migrate-report`
  — page lifecycle (see `openspec/specs/wiki-cli`). Exit 2 bad request,
  4 not found, 9 conflict, 1 `lint --strict` failure
- `memon wiki review log|diff|verify <sha|next>|unverify <sha>` — human
  verification of wiki commits. `diff` takes no page argument: one
  `git diff <last verified commit | empty tree> HEAD -- docs/wiki` for the
  whole wiki, uncommitted work excluded; `verify`/`unverify` are human-only.
  Page-lifecycle subcommands run no git and report no review state
- `memon wiki commit [-m S]` — stages only `docs/wiki/`, subject `wiki: S`;
  it uses git for staging/commit safety but derives no review state and marks
  nothing verified
- `memon wiki components ls|show|migrate --central <url>` — registry lives
  on central; `MEMON_CENTRAL_URL` / `MEMON_CENTRAL_TOKEN` also accepted
- `memon update [--source <checkout>] [--remote <name>] [--branch <name>]
  [--skills-root <p>]… [--no-skills] [--dry-run]` — maintain this
  installation: fast-forward-only pull from the checkout's configured trusted
  remote (remote **name** only, never a URL), `pnpm install
  --frozen-lockfile --filter @memon/cli...` (CLI closure only, no Web deps),
  build `@memon/core` + `@memon/cli`, self-check the new binary, then refresh
  managed skills through `install-skills`. Refuses a dirty or divergent
  checkout instead of resetting/stashing. On install/build/self-check failure
  it rolls back with `git reset --keep` (never `--hard`, and only while HEAD is
  still the revision it installed), restores the previous `dist/` trees,
  reinstalls the previous dependencies and verifies the restored binary runs
  (`rolled_back`); if a concurrently edited file blocks that, nothing is moved
  and it reports `failed` / `rollback_failed` with the retained `backup` path.
  Never builds the Web app, runs tests/lint/typecheck, starts a service, or
  compares revisions with central

**Web endpoints**:
- `GET /api/experiments[?project=…]` — exp doc list; each row is one exp doc
  with its own effective times and no `memberRuns[]` (the list never walks Runs)
- `GET /api/experiments/:id` — exp doc detail incl. `memberRuns[]` and
  `effectiveCreatedAt` / `effectiveUpdatedAt`, ordered raw sections, managed
  documents/projections, diagnostics, and separate bundle/readme mtimes
- `POST /api/experiments` — create (web equivalent of CLI create)
- `DELETE /api/experiments/:id[?force=true]` — cascade-unlink + delete
- `POST /api/experiments/:id/link` / `:id/unlink` — bind / release
- `PUT /api/experiments/:id/readme` — write exp doc body with mtime+hash lock
- `GET|POST|PATCH|DELETE /api/experiments/:id/warnings[/:rowId]` —
  deprecated-compatible Warnings table API (with `Run` column and per-row
  `run` attribution); official Agent writes route through the bundle writer
- `PUT /api/runs/:id/readme` — id-addressed write for run README;
  bumps `updated_at` server-side and returns `finalContent` so the
  editor re-baselines its buffer
- `GET /api/anomalies?project=…` — membership anomalies (orphan runs,
  phantom refs, mismatch refs, slug-uniqueness violations).
- `GET /api/wiki?project=…` — `{ pages: WikiSummary[] }` (kind order,
  deprecated last, `updatedAt` desc); `GET|PUT /api/wiki/:id` — page with
  `components[]` + diagnostics (PUT: `{content, expectedMtime,
  expectedHash}`, 409 on mismatch, 400 on id/kind change)
- `GET /api/wiki/review`, `POST|DELETE /api/wiki/review/:sha` — wiki
  review marks (owner-only, sequential, 409 `REVIEW_ORDER`)
- `GET /api/wiki/backlinks/:artifact`, `GET /api/wiki/components[/:name]`,
  `POST /api/wiki/components/lint|migrate`
- `GET|HEAD /api/wiki-assets/:project/:id/*` — bundle assets

**SSE wire topics**:
- `run-change` — fires on RUN edits (frontmatter / body / status).
  Payload carries `parentExperimentId` when the run is bound, so the
  client can invalidate the parent exp's detail cache too.
- `experiment-change` — fires on EXP-DOC edits/creates/deletes/binds.
  This topic name MEANS exp-doc events only.
- `anomaly` — `{project, count}` after `recomputeAnomalies(project)`.
- `wiki-change` — `{project, id?}` on wiki page add/edit/delete.
- `wiki-review-change` — `{project}` after a review mark changes.

**TanStack query keys** (matched to SSE topics for invalidation):
- Run-side: `['runs', project]`, `['run', id]`
- Exp-doc-side: `['experiments', project]`, `['experiment', id]`
- Anomalies: `['anomalies', project]`, `['anomalies']`
- Wiki: `['wiki', project]`, `['wiki-page', id]`, `['wiki-review', project]`
  (`experiment-change` and `reports-change` also invalidate `['wiki', project]`)

### Hard rules baked into the spec

- **No `fs.watch` / `chokidar` / inotify-based watchers** anywhere. Polling with exponential backoff (default 1s → 5min, factor 2). The user runs on shared clusters with hard inotify limits.
- **All timestamps ISO8601 with timezone offset** (`2026-05-03T08:28:00+08:00`). Never write UTC-converted timestamps to disk.
- **Status enum is uppercase** (`PENDING`/`RUNNING`/`FINISHED`/`FAILED`/`UNKNOWN`). Hypothesis status enum is `CONFIRMED`/`REFUTED`/`PARTIAL`/`OPEN`/`DEFERRED`.
- **Skills (`.claude/skills/*.md`)**: write in **English**. Conversational dialogue with the user is in **Chinese**.
- **Path safety:** any backend route accepting a path parameter MUST go through `assertWithinProjectRoots()` before touching the filesystem.
- **mtime optimistic locking** for README writes; client carries `expectedMtime` (and optional `expectedHash` for low-resolution-mtime safety on NFS).

### Web app conventions (`apps/web`)

- Use shadcn primitives via `@/components/ui/*`. The shim at `components/ui.tsx` re-exports common ones for backward-compat (`Button`, `Card`, `Badge`, `StatusPill`).
- Use the `cn()` helper from `@/lib/utils` — never concatenate Tailwind class strings manually except for tiny inline cases.
- Client components must NOT pull `@memon/core` JS at runtime (transitively imports `fast-glob` → `fs`). Use `import type { ... }` only for client files; runtime symbols like `STATUS_EMOJI` are inlined in `status-pill.tsx`.
- Modals: use shadcn `<Dialog>`, never hand-roll backdrop divs.
- Forms: shadcn `Input` / `Select` / `Textarea` / `Label`, never native `<input>` / `<select>` / `<textarea>` for visible UI.
- Toasts: `sonner`, mounted globally in `app/layout.tsx`.

### Reference docs to consult before changing UI

**First stop — always: <https://ui.shadcn.com/llms.txt>**

This is the LLM-targeted distillation of shadcn's docs. Before any
non-trivial frontend change (new component install, theming, semantic
class change, primitive composition pattern), `WebFetch` this URL and
re-anchor on it. It's the single source of truth for "the shadcn way";
treating it as authoritative will avoid F2 / F3 / F4 above.

Other references (read on demand):

- shadcn skills (AI-targeted rules): <https://ui.shadcn.com/docs/skills>
- shadcn theming: <https://ui.shadcn.com/docs/theming>
- Component-specific: <https://ui.shadcn.com/docs/components/<name>>

## Dev: prefer prod build for the dashboard

Local deployment and unit-test scheduling follow `AGENTS.md`: direct
production build + hosting, no local systemd service, no remote-cluster unit
tests. During development run an agent-selected, change-relevant testlist;
reserve the full local suite for user-confirmed archive, aborting archive
on failure. An explicit request to archive directly may skip that full suite.
Reuse an exact-release build already completed instead of rebuilding it.

For everyday use of the dashboard (looking at runs/experiments, hitting the
API), **prefer the production build over `pnpm dev`**. Reason: Next.js dev
mode lazy-compiles each route on first request — every route the user
visits or that gets hit programmatically takes 22–60s to compile (each route
pulls in ~2200 modules). The user clicks around, sees pages stuck on
"Loading…", and assumes things are broken. With a prod build the same
routes return in 5–70 ms first-hit.

```bash
# One-off prod start (≈70s build, then long-running):
pnpm --filter @memon/core build              # if @memon/core changed
pnpm --filter @memon/web build               # ~70s
cd apps/web && pnpm start > /tmp/memon-prod.log 2>&1 &
# Same port (3737), same auth, same caddy reverse-proxy URL.
```

Trade-off: any source change in `apps/web/**` or `packages/core/**` requires
rebuild + restart (no HMR). For active UI iteration, dev mode is still
correct; for "user is poking the dashboard to see results", prod is
strictly better.

When the user says "重启一下 dev server" or similar, default to **prod start**
unless they explicitly say "dev mode" or are mid-iteration on UI code. Reuse
an already completed build of the exact release when available; otherwise
stop the old host before rebuilding and explain that a build is needed.

Hard rule when restarting: kill the OLD process **before** clearing
`.next/`. Deleting `.next/` while a server is running silently corrupts the
build manifest of the running process — subsequent requests then fail with
`ENOENT: build-manifest.json` or `routes-manifest.json` and you'll spend
10 minutes wondering why every API returns 500. Sequence:

```bash
PID=$(ss -ltnp 2>/dev/null | grep 3737 | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
[ -n "$PID" ] && kill "$PID"
sleep 2  # wait for socket to free
ss -ltnp 2>/dev/null | grep 3737 || echo "port free"
# (only now safe to)
rm -rf apps/web/.next  # if a clean rebuild is needed; otherwise skip
pnpm --filter @memon/web build
cd apps/web && pnpm start > /tmp/memon-prod.log 2>&1 &
```

Note: `pkill -f "tsx server.ts"` does NOT match the actual server process,
because it runs as `node --require tsx/preflight server.ts` after tsx forks
its loader. Match by listening port (`ss -ltnp | grep 3737`) instead.

## Dev: HTTP API auth — curl with credentials from `config.yml`

The dashboard accepts three auth modes (see `openspec/specs/auth-system/`):

1. **Owner session cookie** (`memon-session`) — set by the `/login` page or
   `POST /api/auth/login`. Used by the browser. Refreshed on every
   authenticated request (rolling 30-day TTL).
2. **Owner HTTP Basic** (`Authorization: Basic ...`) — the CLI / curl
   automation fallback. Same plaintext credentials in `config.yml`.
3. **Viewer share cookie** (`memon-shares`) — set by visiting a
   `/share/<project>/<token>` URL. Read-only access scoped to the project
   the share was issued for. Only evaluated on `read`-class routes; shell
   + mutating routes never decode this cookie.

Modes are evaluated lazily in that order; the first passing one wins.

**For curl/CLI automation: use Basic.** It's unchanged. Read credentials at
the start of any session:

```bash
MEMON_USER=$(grep -E '^\s*username:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
MEMON_PASS=$(grep -E '^\s*password:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
# now use:
curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/api/projects
```

If `auth.password` isn't in `config.yml` yet, `memon serve` hasn't been run
once — start it (`cd apps/web && pnpm dev`) and the first request triggers
first-run, which writes a random plaintext password AND a `session_secret`
into `config.yml` and prints the password to stdout once. After that, both
values persist in `config.yml` forever (until you rotate by editing).

**Inspecting viewer mode via curl** (rare — usually you click the share URL
in a browser): use a `-c cookies.txt -L` pair to follow the share-landing
redirect and capture the `memon-shares` cookie, then reuse the jar:

```bash
# 1. Issue a share via the CLI
SHARE_URL=$(memon share create project-a --label dev --format human)
# 2. Open the share URL with curl → 302 → /p/project-a; captures cookie.
curl -sS -c viewer.txt -L "$SHARE_URL" -o /dev/null
# 3. Now hit /p/project-a as the viewer.
curl -sS -b viewer.txt http://localhost:3737/p/project-a | head
```

**Anti-patterns**:

- Don't read from `~/.cache/memon/initial-password.txt` — that path was
  removed; the canonical source is `config.yml`.
- Don't omit `-u` (or `-b cookies.txt`) and treat 401 as "the server is
  down" — first read the config and add credentials.
- Don't paste `auth.password` or `auth.session_secret` into commit
  messages, PR descriptions, or slash commands. Plaintext on disk by
  design (single-user threat model), but that doesn't make it OK to leak.
- For HTML page navigation, 401 is rewritten to `302 → /login?next=...` so
  the browser lands on the login form instead of triggering the native
  Basic-auth dialog. API requests (paths starting with `/api/`) get a raw
  401 without `WWW-Authenticate`; CLI/curl must send Basic credentials
  preemptively with `-u`.
- The ONLY place 403 appears is when a logged-in viewer requests a `read`
  route for a project that is NOT in their share scope. Every other deny
  is 401 (or its HTML 302 rewrite). If you see a 403 in CI / automation,
  you're probably running with a viewer cookie when you wanted owner Basic.

## Verification protocol for UI changes

Run these in order before claiming done:

```bash
# 0. Read credentials once per session.
MEMON_USER=$(grep -E '^\s*username:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
MEMON_PASS=$(grep -E '^\s*password:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)

# 1. typecheck
pnpm --filter @memon/web typecheck

# 2. dev server is up (else start it: cd apps/web && pnpm dev)
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/

# 3. Fetch a real page and grep for the markup I just added
curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/p/project-a \
  | grep -oE '<class names | data-slot patterns | text I expect>'

# 4. Fetch the compiled CSS and confirm the tokens I rely on are defined.
#    Static assets bypass auth, so no -u needed here.
curl -sS "http://localhost:3737/_next/static/css/app/layout.css?v=$(date +%s)" \
  | grep -E "^  --background:|^  --foreground:|^  --card:|^  --muted:|^  --primary:"
# Each grep must match a single line with an oklch() value.

# 5. (Mobile-sensitive changes) curl with a small viewport-related class search
```

Only after all 5 steps pass do I report "done". `200 OK` is necessary but not sufficient.

## OpenSpec and Git Workflow

- Use the repository's generated OpenSpec workflows.
- Before implementation, read `openspec/config.yaml`, the relevant canonical specs under `openspec/specs/`, and the applicable active change artifacts.
- Keep OpenSpec artifacts aligned with the implementation and validate completed work before archiving.

### Core workflow routing

- The core workflows are `explore`, `propose`, `update`, `apply`, `sync`, and `archive`. Select them from the user's intent and the current change state.
- Use `explore` for discussion, investigation, and requirement clarification without implementation.
- Use `propose` when development work has no matching active change. Create and validate every planning artifact required before implementation. The propose phase itself MUST NOT edit implementation files.
- Use `update` to revise existing planning artifacts and keep them coherent. It MUST NOT edit implementation files or create missing artifacts.
- Use `apply` to implement a ready change. Follow its dynamic instructions and read every returned context file before editing implementation files.
- Use `sync` to merge delta specs into canonical specs without archiving, or when invoked as part of archive.
- Use `archive` to finalize a completed and validated change. Sync delta specs by default unless the user explicitly requests otherwise.

### Expanded workflow routing

- The additional workflows are `new`, `ff`, `bulk-archive`, and `onboard`. Their availability is not permission to invoke them implicitly.
- Use `new` only when the user explicitly requests a change scaffold without the remaining planning artifacts. Stop after creating the scaffold unless the user explicitly requests another planning action.
- Use `ff` only when the user explicitly requests generation of all remaining planning artifacts for a scaffolded or partial change.
- Use `bulk-archive` only when the user explicitly requests archiving multiple eligible changes together.
- Use `onboard` only when the user explicitly requests interactive OpenSpec onboarding. State first that it performs real repository work, follow every generated pause, and require its ready-to-implement confirmation before editing implementation files.
- Do not substitute agent judgment about complexity, simplicity, parallelism, or educational value for the explicit user intent required by these additional workflows.

### Lifecycle orchestration

#### Transition policy

- Treat `propose`, `apply`, and `archive` as separate workflow phases. Complete the current phase and satisfy its requirements before starting the next one.
- Resolve apply and archive continuation independently. The current user request takes precedence, followed by the latest still-applicable user preference, then repository-specific defaults. Without authorization from those sources, stop for review. A later user instruction replaces an earlier preference.
- An explicit request for proposal-only, no apply, or no archive blocks the corresponding transition regardless of any automatic repository default.
- A standing user preference for automatic apply or archive remains effective across turns until the user revokes or replaces it. Do not require the user to repeat an applicable authorization.
- These rules govern orchestration between generated workflows. They supersede only a generated workflow's requirement for an additional user turn before starting the next phase; they never bypass workflow steps, validation, readiness checks, tests, ambiguity handling, ownership boundaries, or failure handling.

#### Propose phase

- Create and validate every planning artifact required for implementation.
- Do not edit implementation files within the propose phase.
- Start `apply` in the same turn when the user requested implementation or apply, or when automatic apply is enabled.
- Otherwise, present the completed planning artifacts and leave the change ready for review.

#### Apply phase

- Start `apply` only when the target change is unambiguous, all required planning artifacts exist, planning validation succeeds, and the generated apply instructions report a ready state.
- Follow the generated dynamic instructions and read `openspec/config.yaml`, relevant canonical specs, every returned context file, and the applicable active change artifacts before editing implementation files.
- Keep the active change artifacts aligned with implementation. Fold small implementation refinements into the proposal, delta specs, design, and tasks as applicable.
- Pause when implementation requires materially different or additional scope instead of silently narrowing, deferring, or simplifying the specified behavior.
- Mark a task complete only after its full behavior and proportionate verification succeed.
- Before leaving apply, ensure the planning artifacts describe what was actually implemented.
- After apply and all required verification pass, start `archive` when the user requested it or automatic archive is enabled.
- Otherwise, leave the change active, present the implementation and test results for acceptance, and explicitly ask whether it should be archived.

#### Archive phase

- Start automatic archive only after all implementation tasks are complete, required tests pass, the artifacts match the implementation, and OpenSpec validation succeeds.
- An explicitly requested archive must still follow the generated workflow's completion checks, warnings, and required confirmations.
- Sync delta specs into canonical specs by default. Skip sync only when the user explicitly requests archive without syncing.
- If no delta specs exist, report that there was nothing to sync.
- After sync, verify every affected canonical spec before moving the change.
- After archive, verify the archived change and report its final state.
- After every successful archive, automatically commit only the current task's work and push it following the concurrency-safe Git workflow below.
- Present the completed result for user acceptance after archive, commit, and push finish.
- If archive or required spec sync fails, leave recoverable state intact and do not commit or push.

### Development entry gate

- Treat every request to implement, fix, refactor, add or change tests, change configuration, or change behavior documentation as development work.
- Before editing any implementation file, the agent MUST inspect the OpenSpec configuration, canonical specs, and active changes, then MUST select the applicable generated OpenSpec workflow instead of reconstructing it from memory.
- If no active change matches and no explicitly requested `new` or `onboard` entry action applies, the agent MUST use the generated propose workflow. Continue or stop afterward according to the lifecycle orchestration rules above.
- If exactly one active change matches and the user requests implementation, the agent MUST use the generated apply workflow. If several changes could match, list them and obtain the user's selection first.
- Outside an explicitly requested `onboard` workflow after its own ready-to-implement confirmation, the agent MUST NOT edit implementation files while apply is blocked, before apply reports a ready state, or before all required context files have been read.
- Read-only explanation, investigation, status reporting, and OpenSpec tooling installation or repair are not development work. If such work turns into a request to edit project behavior, apply this gate before the first edit.

### Instruction file convention

- `AGENTS.md` is the canonical root instruction file for this repository.
- `CLAUDE.md` must be a relative symbolic link to `AGENTS.md`.
- This direction is an intentional project convention that reverses an earlier Claude-first layout. Do not flip the link or move the canonical content back into `CLAUDE.md` during installation, repair, or tool updates.

### Installation and updates

- After every successful OpenSpec installation, reinstallation, repair, or update, create a separate Git commit containing only the repository files that operation modified or created.
- Stage the exact affected paths explicitly. Do not mix application changes, archive changes, or unrelated work into the OpenSpec setup commit.
- Create the commit on the resolved main branch and follow the Git commit-message rules below. Prefer `chore(openspec): install OpenSpec tooling`, `chore(openspec): reinstall OpenSpec tooling`, or `chore(openspec): update OpenSpec tooling`, as applicable.
- Do not create an empty commit when the operation changed no repository files. Do not commit when the installation or update failed.
- Keep this setup commit separate from the automatic archive commit. After the setup commit succeeds, automatically push it following the concurrency-safe Git workflow below. Do not push if setup or commit creation failed.

### Concurrency-safe Git workflow

#### Task ownership

- Assume multiple agents may be working concurrently in the same repository or working tree.
- At the start of the task, record the baseline status, the selected OpenSpec change, and the exact paths owned by the current task.
- Track every file created, modified, or deleted by the current task. Do not take ownership of unrelated paths merely because they are already modified.
- Automatic apply, archive, commit, or push does not expand the current task's file ownership.
- When multiple agents work on the same OpenSpec change, mark only tasks this agent actually completed. Do not archive until all tasks and required verification are complete.
- If a task-owned file or OpenSpec artifact changes concurrently, re-read it and rerun the relevant verification before continuing.
- Do not amend, rewrite, or discard another agent's work.

#### Staging and shared files

- Stage only the exact paths modified by the current task with `git add -- <path>...`.
- Never use `git add -A`, `git add .`, or `git add -u`; these commands may include another agent's work.
- File-level staging is sufficient; line-level or hunk-level staging is not required.
- If a file was modified by both this change and another agent concurrently, it is acceptable to commit the whole file because the on-disk state is the state that runs. Confirm the final file list before committing and explicitly report any such shared file afterward.
- Review the complete staged diff and confirm that every staged path belongs to the current task before committing.

#### Branches and worktrees

- In this section, "main branch" means the repository's designated primary integration branch, not necessarily a branch literally named `main`.
- Resolve the main branch and its configured upstream from repository configuration, repository-specific requirements, and applicable user instructions. Default to the literal `main` branch only when none of those sources identifies a different primary integration branch. A repository may use `master` or another branch, and an applicable instruction may designate a task-specific contribution branch instead.
- Create commits on the resolved main branch unless an applicable user instruction or repository-specific requirement authorizes another contribution branch for the current task.
- Do not create or switch branches unless the user explicitly authorizes it for the current task.
- Do not create, enable, switch, manage, or move work into a Git worktree unless the user explicitly authorizes it for the current task.
- Authorization to commit or push to a branch does not by itself authorize creating or switching branches or moving work into a worktree.
- If the required branch is not checked out, stop and report instead of switching branches automatically.
- When submodules are present, document their scope, ownership boundaries, target branches and upstreams, commit order, and push policy under `Repository-specific OpenSpec and Git Workflow Requirements`. Do not infer these rules from the parent repository. If the required policy is absent or ambiguous, ask the user before modifying, committing, or pushing submodule changes.

#### Commit and push

- Before committing, confirm that the checked-out branch and its configured upstream match the resolved branch for the current task.
- Confirm that the staged diff contains the complete current-task change and no unrelated paths.
- Fetch the matching upstream and verify that the local branch is not behind or diverged before committing.
- Do not merge, rebase, reset, stash, rewrite history, or alter another agent's working-tree changes automatically to recover from a race.
- Create the commit only after the applicable setup, implementation, validation, sync, or archive steps succeed.
- Push the committed branch to its matching configured upstream with a normal non-force push.
- If the remote advances or rejects the push, fetch and report the race. Leave the local commit and working tree intact for an explicit integration decision.
- Report the resolved branch and upstream, commit hash, subject, committed paths, push result, shared files, and remaining uncommitted changes.

### Git Commit messages

- Use Conventional Commits, following the Angular-style format, for every commit: `<type>(<scope>): <description>`.
- Use an appropriate standard type such as `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, or `chore`.
- Keep the subject concise and imperative.
- For a breaking change, add `!` before the colon and include a `BREAKING CHANGE:` footer.
- Example: `feat(research): add automated experiment runner`.
- For a pure OpenSpec archive, prefer `chore(openspec): archive <change-name>`.
- When implementation files are included, choose the conventional type and scope that best describe the change.

### Repository-specific OpenSpec and Git Workflow Requirements

These repository-specific requirements supplement the canonical workflow.
The testing and deployment requirements below take precedence over older
examples elsewhere in this document. Archive requires user authorization;
automatic release does not authorize automatic archive.

- Validate a proposal with `openspec validate <name> --type change` before committing it.
- The exact release subject `release: vMAJOR.MINOR.PATCH` is a repository-specific exception to the canonical commit-message format.
- OpenSpec tooling setup has its own setup commit; it does not trigger an application version bump or deployment.

#### Development and archive testing

- During development, choose a small, change-relevant, cherry-picked testlist yourself. Run those test files or cases rather than the full unit-test suite. Cover affected behavior and plausible regressions; report the selected list and actual results.
- Do not run the full unit-test suite routinely during development, release, or deployment.
- Once implementation is complete and the user confirms it is ready to archive, run the full unit-test suite locally before archiving. If it fails, interrupt the archive workflow, report the failures, and resolve them before proceeding; do not archive a failing change.
- If the user explicitly asks to archive directly, the pre-archive full unit-test suite may be skipped. State that it was skipped; never claim an unexecuted suite passed.
- Never run unit tests on remote clusters. A remote node is a CLI/skills installation only: `memon update` pulls its configured trusted remote fast-forward-only, builds and installs the CLI, and refreshes the managed skills. No remote service is deployed, started, or health-gated, and central releases never wait on remote nodes.

#### Local deployment

- Use direct production build + hosting on the local machine. Do not create or use systemd services for local memon deployment.
- Reuse an already completed build of the exact release when available; do not rebuild or repeat tests merely to deploy it.
- Start the production host directly, keep it running after the agent session, and check service readiness. Stop the old host before replacing its build output.
- An explicit user instruction to deploy immediately without further tests skips additional test runs; it does not turn unexecuted tests into passing results.

#### tasks.md scope: implementation work only

`tasks.md` is the apply-phase checklist. It SHALL contain only the
implementation work the agent (or a human pairing with the agent) actually
does during `/opsx:apply` — code edits, tests, docs, verification commands.

It SHALL NOT contain user-triggered actions or downstream workflow steps.
The most common mistake to avoid:

- ❌ A `- [ ] Run /opsx:archive <name>` task. Archive is a separate
  user-triggered phase, not part of apply. The apply phase ends when the
  change is implemented and verified; the human decides when (and whether)
  to archive.
- ❌ A `- [ ] Commit + push` task. That happens automatically as the
  post-archive convention (see the canonical archive workflow). It is
  not a tracked apply-phase deliverable.
- ❌ A `- [ ] Open a PR` task. Same reason.

If `apply` finishes and the last item in tasks.md was a user-triggered
action, that's a sign the proposer or applier got the boundary wrong —
fix the tasks.md, don't leave the box unchecked as a fake "remaining work"
signal.

#### Release version → commit → push

OpenSpec changes and releases have independent lifecycles. One active change
may ship several versions while implementation, rollout, observation, and
refinements continue. Shipping a version does not archive its change.

**Default to completing a verified release automatically.** Once an
implementation requested by the user is complete and its applicable release
gates pass, do not stop merely to ask whether to release. Commit only the
reviewed in-scope implementation, advance the canonical version according to
the surface rules below, create the separate release commit, push it, deploy
the configured central service when central artifacts changed, and run
post-deployment verification. Stop for user input only when
the release needs a breaking migration or unresolved product choice, required
credentials/authority are unavailable, another dirty-worktree change cannot
be safely isolated, or a validation/deployment/rollback check fails.

Use the canonical memon `MAJOR.MINOR.PATCH` release with these project-wide
rules:

- `MAJOR` must equal `FS_CONVENTION_VERSION`; changing it requires the matching
  reviewed filesystem migration and starts at `.0.0`.
- Any distributed-artifact change — the `memon` CLI or the bundled managed
  skills — increments `MINOR` by one and resets `PATCH` to zero. Nodes pick it
  up through `memon update`; the release does not install it for them.
- A central Web/gateway-only change increments `PATCH` by one and requires no
  CLI/skills reinstall anywhere.
- The initial v6-aligned release is `6.0.0`. Later boundaries inside the same
  active change follow the normal rules (for example `6.0.1`, `6.1.0`,
  `6.1.1`).

Before every deployment boundary, commit the reviewed implementation changes
without a version bump. Then update the canonical version, validate the
changed-surface policy (`node scripts/validate-release.mjs`, with
`MEMON_CHANGED_SURFACES` drawn from `central` / `cli` / `skills` /
`filesystem`), and create a separate release commit containing only
the version and its required release metadata/assertions. Use a stable semantic
commit message in the exact form `release: vMAJOR.MINOR.PATCH` (for example,
`release: v2.8.0`). Push the release commit and record its exact 40-character
SHA so central installs that exact revision instead of a moving `latest`.
Concrete node/domain/token/SSH
values remain in Git-ignored or machine-local configuration and must not enter
the release commit.

#### Authoring an FS-convention migration guide

When a future change introduces a breaking on-disk schema change and bumps
`FS_CONVENTION_VERSION`, **before writing the migration guide at**
`packages/core/migrations/v<N>-to-v<N+1>.md`, read
`openspec/specs/fs-migration-guide-authoring/spec.md`. That meta-spec
defines the required seven-section structure, verification command
standards, the fixed commit-message format
(`chore(memon): migrate FS convention v<N> -> v<N+1>`, ASCII arrow), and
the four canonical edge cases every guide must address.

Do NOT improvise the structure. Past iterations of "ad-hoc structure for
agent-targeted markdown" in this repo (see F2 / F3 above) showed how
quickly improvised conventions silently break agent execution. The guide
is the only contract the migrate-fs runtime has — get it wrong and the
migration runs incorrectly without warning.
