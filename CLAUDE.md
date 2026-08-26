# CLAUDE.md — repo conventions and hard-won lessons

This file is loaded into every Claude Code session for this repo. Read it
before doing UI work, before touching shadcn, and before claiming a task is
done.

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
- `Open Claude Code` — calls `POST /api/open-claude-code` and copies
  the suggested `cd <dir> && claude` command to clipboard. For
  `kind: 'exp'` the `cwd` is the experiment folder (`docs/experiments/
  E<NNNN>-<slug>/`), so the spawned agent lands inside the sanctioned
  scratch space alongside any local launchers / analysis utils.
  Component: `OpenClaudeCodeButton` in
  `apps/web/components/open-claude-code-button.tsx`. Distinct from
  `TerminalButton` (which spawns ttyd+tmux+claude in the browser via
  `/api/terminal/start`).

**CLI subcommands**:
- `memon experiment ls` — list exp docs in the project
- `memon experiment show <id-or-slug>` — print one exp doc
- `memon experiment create <slug> [--title T] [--from-run <run-dir>]` —
  allocate next E<NNNN>, create `docs/experiments/E<NNNN>-<slug>/`,
  and atomically create the README plus all three schema-v1 YAML documents
- `memon experiment doc {show,render,validate,lint} <id> [section]` —
  read/check the structured bundle; these commands do not provide YAML CRUD
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

**Web endpoints**:
- `GET /api/experiments[?project=…]` — exp doc list with effective times
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
- `POST /api/open-claude-code` — `{kind: 'exp'|'run', id, projectName}`
  → `{command, cwd, hint}`. For `kind: 'exp'` the `cwd` is the
  experiment folder. Returns a copy-paste command, does NOT spawn.
- `GET /api/anomalies?project=…` — membership anomalies (orphan runs,
  phantom refs, mismatch refs, slug-uniqueness violations).

**SSE wire topics**:
- `run-change` — fires on RUN edits (frontmatter / body / status).
  Payload carries `parentExperimentId` when the run is bound, so the
  client can invalidate the parent exp's detail cache too.
- `experiment-change` — fires on EXP-DOC edits/creates/deletes/binds.
  This topic name MEANS exp-doc events only.
- `anomaly` — `{project, count}` after `recomputeAnomalies(project)`.

**TanStack query keys** (matched to SSE topics for invalidation):
- Run-side: `['runs', project]`, `['run', id]`
- Exp-doc-side: `['experiments', project]`, `['experiment', id]`
- Anomalies: `['anomalies', project]`, `['anomalies']`

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

When the user says "重启一下 dev server" or similar, default to **rebuild +
prod start** unless they explicitly say "dev mode" or are mid-iteration on
UI code. Tell them the build is happening and roughly how long it takes
(~70s).

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
  Basic-auth dialog. API requests (paths starting with `/api/`) still get
  the raw 401 + `WWW-Authenticate: Basic` header.
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

## OpenSpec workflow

Changes are tracked under `openspec/changes/<name>/` with proposal.md / design.md / specs/ / tasks.md. Use the `/opsx:propose` and `/opsx:apply` slash commands. `openspec validate <name> --type change` must be clean before committing the proposal.

### Keep spec in sync during `apply`

After running `/opsx:apply`, if the user requests new functionality or
modifications mid-implementation, **update the change artifacts (proposal.md
/ design.md / specs/ / tasks.md) to reflect the new requirements before or
alongside the code edits**. Don't just patch the code and move on — that
leaves the spec stale and the eventual archive will silently bake the
mismatch into the canonical `openspec/specs/`.

Rule of thumb: if a change is significant enough to mention in a commit
message, it's significant enough to land in the spec. Tick / re-open tasks
in tasks.md as scope shifts.

### tasks.md scope: implementation work only

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
  post-archive convention (see "Archive → commit → push" below). It is
  not a tracked apply-phase deliverable.
- ❌ A `- [ ] Open a PR` task. Same reason.

If `apply` finishes and the last item in tasks.md was a user-triggered
action, that's a sign the proposer or applier got the boundary wrong —
fix the tasks.md, don't leave the box unchecked as a fake "remaining work"
signal.

### Release version → commit → push

OpenSpec changes and releases have independent lifecycles. One active change
may ship several versions while implementation, rollout, observation, and
refinements continue. Shipping a version does not archive its change.

Use the canonical memon `MAJOR.MINOR.PATCH` release with these project-wide
rules:

- `MAJOR` must equal `FS_CONVENTION_VERSION`; changing it requires the matching
  reviewed filesystem migration and starts at `.0.0`.
- Any Backend or CLI artifact change increments `MINOR` by one and resets
  `PATCH` to zero. Affected nodes must reinstall the exact release.
- A central Web/gateway-only change increments `PATCH` by one and does not
  reinstall Backend/CLI artifacts.
- The initial v6-aligned release is `6.0.0`. Later boundaries inside the same
  active change follow the normal rules (for example `6.0.1`, `6.1.0`,
  `6.1.1`).

Before every deployment boundary, commit the reviewed implementation changes
without a version bump. Then update the canonical version, validate the
changed-surface policy, and create a separate release commit containing only
the version and its required release metadata/assertions. Use a stable semantic
commit message in the exact form `release: vMAJOR.MINOR.PATCH` (for example,
`release: v2.8.0`). Push the release commit and record its exact 40-character
SHA. Central and every affected node must fetch and install that same revision;
never independently resolve a moving `latest`. Concrete node/domain/token/SSH
values remain in Git-ignored or machine-local configuration and must not enter
the release commit.

### Archive → commit → push

When the user asks to archive a change and `/opsx:archive` (or the archive
skill) reports success, **default to creating a git commit and pushing to
`origin` immediately afterward** — no extra confirmation needed for the
commit/push step itself once archive succeeded.

Critical: **only stage the files that belong to this change.** Multiple
agents may be editing the working tree concurrently in parallel sessions,
so `git add -A` / `git add .` will sweep up unrelated work and contaminate
the commit. Stage explicitly:

- the change folder being archived (`openspec/changes/<name>/` → moved into
  `openspec/changes/archive/`)
- the synced canonical spec files under `openspec/specs/...`
- the code/test/doc files this change actually touched (cross-check against
  tasks.md and the diff, not against `git status`)

If `git status` shows unrelated modified files from another session, leave
them alone — don't stash, don't reset, don't add. Just stage the precise
paths for this archive and commit.

### Authoring an FS-convention migration guide

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
