# memon

A file-based frontend for agent-managed research. Agents write code, run experiments
and analyze native outputs; memon provides stable identities, execution records,
published results and convenient browsing.

## Quickstart

```sh
pnpm install
pnpm --filter '@memon/cli...' build
# Optional: expose memon on PATH.
pnpm --dir packages/cli link --global
```

In a research project:

```sh
memon experiment create study --title "A research question"
memon run create --experiment E0001 --params '{"rate":0.1}'
# Use the returned directory for native configuration, scripts and outputs.
memon run update logs/E0001/V0001/<run-id> --status RUNNING
# Write useful measurements to that Run's result.csv.
memon run update logs/E0001/V0001/<run-id> --status FINISHED
memon show E0001 --results
```

First Experiment creation initializes a new research project. Existing unmarked
research requires an explicit filesystem migration; creation never silently
converts old data. CLI operations default to cwd; use `--project-root <path>` to
select another project. The CLI does not need a running website.

For the dashboard, copy `config.example.yml` to a private instance configuration,
build the Web app, then use `memon serve --config <path>`. See deployment below.

## Research files

```text
docs/experiments/E0001-study/
  README.md             # research question, useful evidence and current interpretation
  experiment.json       # lightweight format and desired result columns
  results.csv           # published Variant table; tracked in Git
  aggregate_variant.py  # optional custom multi-Run aggregation
  details/              # optional independent supporting analyses
logs/E0001/
  V0001/<run-id>/
    run.json            # identity, status, active flag, times and optional metadata
    result.csv          # useful parameters, measurements and requested Run fields
    ...                 # native configs, logs, checkpoints and scripts
  smoke/<run-id>/        # program/environment checks; excluded from formal evidence
docs/wiki/<kind>/
  W0001-summary/README.md # free-form knowledge; HTML/service folders use manifest.json
```

No Run README is needed. Directory placement determines Experiment and Variant
membership; no duplicate binding list or Variant draft registry is required.
`run create` allocates the next ordinary V ID when `--variant` is omitted.
Use `--variant V0001` for another execution of the same condition, or
`--variant smoke` for a smoke Run. READY Runs can hold partial planned parameters
before execution. Display names are optional Run metadata.

Run execution state and evidence selection are independent. States include
`READY`, `QUEUED`, `RUNNING`, `FINISHED`, `INTERRUPTED`, `FAILED`, `RESUME_READY`
and `UNKNOWN`; `PENDING` remains readable for ambiguous historical records.
The first Run is active by default; another Run preserves that selection unless
`--activate` explicitly replaces it. `--active false` withdraws a Run from current
aggregation without deleting it or claiming that its measurements are wrong.
Optional assessments distinguish `INVALID`, `LIMITED`, `SUPERSEDED` and `OTHER`,
with a reason. Preserve those qualifications when referring to old evidence.

Experiment lifecycle is `ACTIVE`, `PAUSED`, `ARCHIVED` or `RETIRED`. Lifecycle
changes remain human-directed; agents can edit the authorized metadata directly.
`RUNNING` and `COMPLETED` are display projections, not stored lifecycle states.
Retirement removes work from the current research view while preserving its files
and references. Explicit `show` targets remain readable; use `--include-history`
for historical inventory. A fundamentally redone experiment gets a new E ID;
new lightweight experiments do not maintain research epochs.

### Publication

The export chain is `run.json → result.csv → results.csv → inventory`. Creation
and Run updates publish automatically. After direct edits, use `memon refresh E0001`;
plain `memon refresh` rebuilds inventory, including Wiki edits, without aggregating
all experiments. Failed publication returns failure and identifies the repair
needed instead of treating a stale table as current evidence.

Each Run CSV uses `path,stat,value`; the experiment CSV adds only `variant`.
Requested `run.*` fields and `params.*` are exported from metadata, so READY Runs
already have a CSV. Empty useful metrics are allowed; extract additional native
outputs only when needed. Default aggregation accepts at most one active Run per
ordinary Variant. Multiple active Runs require `aggregate_variant.py`; the
[FS11 migration guide](packages/core/migrations/v10-to-v11.md) documents its contract.
The website reads the saved table instead of executing analysis scripts on view.

Generated timestamps use ISO8601 with the writer's local offset. Git checkout
mtimes are not research timestamps. CLI mutations use shared writer locks;
README/document writers retain mtime-plus-hash conflict detection. Agents should
reread conflicts and preserve unrelated edits.

Implementation/investigation ledgers, Reports and Code Reviews are optional.
Create them only when explicitly requested. Update research prose when understanding
changes, rather than appending a bullet for every execution. Wiki pages have no
Git-backed human-review workflow; use normal project Git conventions.

Wiki and Reports share small folder bundles. Wiki stays current; Reports record an
`as_of` evidence cutoff and `source_commits`. Markdown uses README.md frontmatter;
static HTML and running applications use manifest.json (`type: html|service`,
`title`, optional category/freshness and explicit-offset timestamps). HTML defaults
to index.html; a service declares its source loopback port. Agents own rendering,
regeneration and application lifecycle. memon only displays/proxies content.

The document viewer filters category, CURRENT/STALE and presentation, and checks
service reachability on demand. Native, SSHFS (configured SSH target) and separately
granted File Agent forwarding support HTTP and WebSockets. Dynamic applications
are owner-only and use the displayed base URL / X-Forwarded-Prefix; no arbitrary
application code rewriting occurs. Static content retains project sharing.

For user-authorized retirement, repair inbound references and then use
`memon wiki delete W0001`. Blocking references are reported with locations; there
is no force bypass or automatic Report conversion. IDs are not recycled.

## CLI

Daily research uses **six routine commands**. The single `memon` binary retains
20 command leaves in total; there are no hidden retired aliases:

| Command | Purpose |
|---|---|
| `experiment create <slug>` | Allocate the Experiment and initialize fresh research as needed. |
| `run create [id] --experiment E0001` | Allocate a Run directory and, by default, a new Variant. |
| `run update <path>` | Record execution state/activity and publish derived data. |
| `refresh [E0001 …]` | Publish file edits; without targets rebuild inventory only. |
| `show [target]` | Read published inventory or one Experiment, Run or Wiki page. |
| `install-skills` | Install/update the existing bundled Skills. |

```sh
memon show                             # published summaries, no recursive Run hydration
memon show --kind experiment --include-history
memon show E0001                       # Experiment document and diagnostics
memon show E0001 --results --column metrics --output csv
memon show E0001 --shape               # declared columns and Variant identities
memon show E0001 --section investigation
memon show logs/E0001/V0001/<run-id> --results
memon show W0001                       # declared Wiki content; no source-target scanning
memon show study --kind experiment     # disambiguate a slug
```

JSON is the default; `--format human` provides readable output. Result tables also
support `--variant`, `--status`, `--column`, `--group` and `--output`. An absent or
invalid inventory reports `memon refresh` instead of silently walking every Run.
Direct edits are not automatically observed until publication.

### Optional commands and migrations

The single `memon` binary also retains 14 optional leaves: `serve`, `update`,
`share create/list/revoke`, `wiki create/move/delete`, `components run`, `mock seed`,
`journal read`, `experiment archive/unarchive` and `run record`.
Independent operational entrypoints remain deferred.

Migration is handled by the concise `memon-migrate-fs` Skill and the guides and
executors under [packages/core/migrations](packages/core/migrations/README.md).
The 11 old version/schema/binding/Variant/Run-rename/Run-archive leaves and the
two migration leaves are removed, bringing the original 90 commands to 19 retained leaves; guarded Wiki deletion adds one new leaf.
Historical readers remain available; old data does not require retaining its
old write workflow. Scripts preserve selected scope, native evidence, historical
timestamps and recovery records. No migration runs as a deployment side effect.

| Removed commands | Replacement |
|---|---|
| `list`, `scan`, entity `ls/show`, result table/summary/get | `show`, optionally `--results`, `--shape`, `--section` or `--kind` |
| `experiment variant create` | `run create --experiment …` |
| Run status/deprecation setters | `run update` with execution state or independent activity |
| Result setters, annotations, warning/metadata/README setters | Edit the source file, then `refresh` |
| Index maintenance, result rebuild, manual journal submission | `refresh`; no manual receipt |
| Project initialization and lint commands | First creation; diagnostics during supported reads/publication |
| Legacy experiment version/schema/link/Variant operations and Run rename/archive | Migration guides/scripts for conversion; ordinary new research uses directory ownership and Run metadata |
| Experiment/Report migration commands | `memon-migrate-fs` with the migration directory executors |
| Wiki commit, search, hypothesis read, obsolete delete/rename wrappers | Ordinary Git/file tools; preserve references when moving files |

Exit codes remain 0 success, 1 failed/invalid state, 2 usage, 4 missing target,
9 conflict, 11 unsupported older CLI and 13 forbidden path. Removed commands fail
before touching files. This CLI change does not migrate project data.

## Skills

`memon install-skills` synchronizes bundled skills into the research project's
Claude/Codex/opencode directories. `--agent`, `--target` and `--dry-run` remain
available; the memon harness itself is refused. Customized retired directories
and unrelated skills are preserved. `AGENTS.md` is canonical; `CLAUDE.md` is its
relative symlink.

The existing seven entrypoints remain separate: `memon-research`, `memon-wiki`,
`memon-components`, `memon-structured-work`, `memon-write-report`,
`memon-write-code-review` and `memon-migrate-fs`. Their consolidation is deferred. The migration Skill routes conversion to versioned
scripts rather than public legacy commands.
For older command examples, use the replacement table above; the registered CLI
surface and `--help` define supported invocations.

## Web dashboard

Hypotheses is retired: no dedicated page, API, CLI option, background read or
automatic reference maintenance. Existing project documents remain untouched;
choose any migration separately for each project.

Every project page lives under `/<host>/<project>`; numbers are written
without leading zeros or slugs, and older `/h/<host>/p/<project>/…` links
redirect to the same page.

- **`/<host>/<project>`** (also `/experiments`) — vertical-stack
  experiment-card grid (one card per exp doc), plus a pinned anomaly banner at
  the top when the `/api/anomalies` endpoint reports any.
- **`/<host>/<project>/e/<n>`** — exp doc detail page for
  `E<NNNN>-<slug>`: header (id + title + tags) + Edit markdown action; Runs
  section with collapsible per-run panels (`?run=<run-dir>` expands one); all
  canonical v6 sections in README order; YAML-rendered Implementation /
  Investigation / Results; compatibility diagnostics that keep
  unknown/duplicate/conflicting content visible; Warnings and aggregated
  Artifacts.
- **`/<host>/<project>/journal`** — reverse-chronological timeline,
  filter by tag and experiment id, browser-tz timestamps.
- **`/<host>/<project>/reports`** and **`/r/<n>`** — single-file or
  directory-bundle Reports. Historical Digests move to Wiki's `digest` kind
  through the reviewed v7 migration; standalone Digest routes are retired.
  Local `.html` image references render as unsandboxed iframes; normal links
  remain links.
- **`/<host>/<project>/wiki`** and **`/w/<n>`** — the project wiki.
- **`/<host>/<project>/code-review`**, **`/cr/<date>-<slug>`**
  and **`/e/<n>/cr/<date>-<slug>`** — code reviews.

The exp detail page's action bar exposes:

- **Edit markdown** — opens an in-page Monaco editor (or full-screen
  Dialog on narrow viewports) writing through `PUT
  /api/experiments/:id/readme` with `expectedMtime` + `expectedHash`
  optimistic locking. The server bumps `updated_at` on save and returns
  the canonical `finalContent` so the editor re-baselines its buffer.
  Same handshake for run READMEs via `PUT /api/runs/:id/readme`.

Browser lists use TanStack Query freshness and explicit invalidation after writes.
Log viewing has a dedicated stream. Source refresh uses polling without watchers.

Owner-only, opt-in Chinese body translation for Experiments, Wiki pages, and reports
is documented in [Body translation](docs/body-translation.md). It uses the serving
instance's local Codex Spark login and never modifies English source documents.

## Production deployment

memon's HTTP server is single-user. Browsers authenticate through the
`/login` form and an HTTP-only owner session cookie. HTTP Basic remains a
preemptive compatibility mode for CLI/curl automation, but 401 responses do
not advertise a Basic challenge and therefore do not open the browser's native
credential dialog.
Next.js middleware resolves owner session, preemptive Basic, or read-only
viewer-share identity on every protected dashboard route.

Caddy is only a TLS-terminating port forwarder — it does **not**
participate in auth.

### First run

Copy `config.example.yml` to an instance `config.yml` (no `auth:` block needed),
then run `memon serve`. The example remains an Agent/human-maintained template:
memon never selects it as the live configuration and never writes generated
state into it. The first boot generates a random 144-bit password and persists
it **plaintext** only in the selected instance under `auth.password`, then
prints it to stdout once. Plaintext on disk is intentional — the
threat model is "single user, host fs trust = auth trust" (same as
`~/.ssh/id_*`), and the single canonical source means dev agents and
curl-based automation can read the password from one place without a
separate secret store.

```text
*** memon: generated initial password ***
  username: admin
  password: <24-char base64url>
Persisted in /path/to/config.yml as plaintext (auth.password).
```

To rotate later: edit `auth.password` in `config.yml` to any new value
and restart `memon serve`. To regenerate: delete the `auth` block
entirely. **No Caddy reload is needed for password changes** — memon
owns the only copy of the credential.

### Caddyfile

Replace your `<host>` site block with the following (substituting your
real hostname). Authentication lives inside memon, so Caddy is just a
single-port forwarder with TLS:

```caddyfile
<host> {
    reverse_proxy localhost:3737 {
        flush_interval -1
    }
}
```

That's the whole site block. No `basic_auth`, no `@sse` matcher, and no
`forward_auth`. The `reverse_proxy` above forwards ordinary HTTP and SSE
(`/api/events`, `/api/log/stream*`). `flush_interval -1` disables Caddy's
response-body buffering so SSE events arrive in real time.

Apply with the usual:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Verification

From a different machine:

```bash
# Anonymous page navigation → 302 to the login form
curl -i https://<host>/

# Anonymous API → 401 without a browser Basic challenge
curl -i -H 'Accept: application/json' https://<host>/api/projects

# Preemptive Basic automation → 200
curl -i -u admin:<password> https://<host>/

```

If the first request returns 200 something is misconfigured (memon
should return 401 anonymously). Confirm `auth.password` is set in
`config.yml` and that `reverse_proxy localhost:3737` actually points
at memon.

### Sharing a project read-only

To let a collaborator look at ONE project (or one Experiment, Report or Wiki
page) without giving them owner credentials, open the "Share" dialog in the
project page header and copy a link. A link is the page URL with
`?share=<token>` appended; tokens live in the central share registry
(`shares.json` beside the instance config, owner-only permissions).

What the link does when opened:

1. Validates the token against the central share registry.
2. Sets a signed `memon-shares` cookie scoped to that project on the
   visitor's browser, HttpOnly + SameSite=Lax + Max-Age=90 days.
3. Redirects to the same page without the token — viewer mode.

In viewer mode the dashboard:

- Lists ONLY the scoped project(s) in the sidebar and project switcher.
- Renders every mutating control (Edit, Status, …) visible-but-`disabled`
  with a "Viewer mode — action disabled" tooltip.
- Filters SSE / project-list responses to the scope set so other projects'
  names never leak across the wire.

A single browser can accumulate share cookies for multiple projects (one
entry per project; the cookie is a signed list). Viewers can also click
"Log in as owner" on the banner to elevate to owner mode for the rest of
the session.

To revoke a share, delete it in the "Share" dialog (or `DELETE
/api/shares/<id>` with owner credentials). The cookie holder silently loses
access on their next request; no error message reveals the revocation.

Rotate `auth.session_secret` in `config.yml` to invalidate every open
browser session AND every outstanding share-cookie in one shot.

### Updating an installation

A workstation or cluster login node runs the CLI and the bundled skills —
nothing else. `memon update` maintains that installation from its own
checkout:

```sh
memon update                       # update this installation, refresh skills under cwd
memon update --dry-run             # report the selected revision and planned actions
memon update --skills-root /repo   # refresh managed skills under another project root
memon update --no-skills           # CLI only
```

What it does, in order: refuse unless the checkout is clean and on a branch
with a configured upstream; `git fetch` that configured remote (a remote
**name** only — never a URL supplied on the command line); refuse a diverged
branch instead of rewriting history; `git merge --ff-only`; `pnpm install
--frozen-lockfile --filter @memon/cli...` (the CLI's dependency closure only,
never the Web app's dependencies); build the lightweight `@memon/file-protocol`,
`@memon/core` and `@memon/cli`; run
the new `memon --version` as a self-check; then refresh managed skills through
`memon install-skills`, which leaves every non-`memon-*` skill and every
locally modified managed one alone.

What it deliberately does not do: build the web app, run tests / lint /
typecheck, start any service, or compare its revision with the central
deployment. Untracked files are reported and preserved.

If dependency install, the build, or the self-check fails, the command rolls
back: it moves the ref with `git reset --keep` (never `--hard`) only while
`HEAD` is still exactly the revision this run installed, restores the
previously built `dist/` trees, reinstalls the previous revision's
dependencies, and confirms the restored `memon` runs before reporting
`rolled_back`. A file edited while the build was running is never discarded to
make that possible: if the reset would overwrite it, nothing is moved and the
command reports `failed` / `rollback_failed` with the retained copy of the
previous build (`backup`) so the installation can be repaired by hand.

### `.memon/version.json`

`memon install-skills` stamps a per-project marker at
`<projectRoot>/.memon/version.json`:

```json
{
  "fs_convention_version": 11,
  "installed_at": "2026-05-04T10:00:00+08:00",
  "last_migrated_at": null
}
```

The marker is separate per-Project state, but its supported value is aligned
with memon's release Major (`MAJOR === FS_CONVENTION_VERSION`). Minor releases
identify CLI/skills reinstall boundaries; Patch releases are central-only.
One active OpenSpec change may span several such releases. A central
deployment installs the exact pushed release commit; CLI nodes update
independently with `memon update` and are never pinned to central's revision.
Inspect `.memon/version.json` directly; creation and publication validate their inputs.

The marker is **machine-managed** — don't edit it by hand.

### `.memon/index/` and `.memon/project.yml`

FS11 publishes `experiments.json`, `wiki.json` and `reports.json` under
`.memon/index/`. These readable catalogs hold summaries and canonical entry paths,
not document bodies. Lists and detail lookup share them without directory discovery.
The directory ignores itself; source documents remain authoritative. `memon refresh`
publishes direct edits and repairs missing/invalid catalogs. Run lifecycle commands
republish Experiment summaries. Existing snapshot/events retain Run compatibility.
After upgrading to 11.13, run `memon refresh` at each existing FS11 source before
opening it with the new website. Website reads never rebuild catalogs.

`.memon/project.yml` is an optional, git-tracked declaration of the project
layout — where Run directories live and what discovery skips — shared by
central and every CLI node:

```yaml
schema_version: 1
run_dirs:            # where Run directories live
  - logs/*
  - outputs/*/*
exclude: [scratch]   # added to the built-in excludes (.git, node_modules, …)
include: []          # optional globs a discovered Run path must match
github:              # GitHub permalink previews: owner/repo -> path in this repo
  - { owner: acme, repo: project-a, path: . }
```

Central supports direct native files, optional native/NFS memory caching, SSHFS
and the [authenticated file agent](packages/file-agent/README.md). Cached reads
share bounded on-demand memory observations for at most 30 seconds; manual refresh
revalidates. Restart starts empty: no project-file dump is read or written. Legacy
`memory-disk` and `file_cache` configurations remain accepted but do not enable
persistence. Old dump files are unused and may be removed by the operator.

Transport, source budgets and command execution remain separate. Set `access.source`
(or legacy `storage_group`) to share a physical-source budget; unrelated authorities
remain isolated. Agent projects select a configured connection/project and exact
source identity. `host` is a namespace, not a transport. Browser HTTP asset caches
and local user-preference storage are independent of research-file observations.

The domain backend stays in the central Web process. The agent provides only
versioned file primitives, uses mTLS project grants, and has an independent build
and upgrade lifecycle. `memon update` builds only the JavaScript protocol dependency
and CLI; it never installs or restarts the native agent, and CLI nodes do not need
Go. Source writes require an explicit operator acknowledgement that their memon
writers use the shared lock protocol. Writers that bypass that lock remain outside
the optimistic-lock guarantee.

Conditional file/list reads return bytes and a content version, unchanged with no
body, or confirmed missing. Metadata alone does not prove byte equality. Central
logical subscriptions share checks and reuse deadlines; successful unchanged checks
back off, while failures preserve the last successful observation time. Manual
revalidation can bypass reuse, but shares source concurrency, operation and byte
budgets with ordinary checks, writes and ranges. No filesystem watchers are used.

Central `config.yml` keeps only the project path and deployment facts
(`name`, `root`, `host`, `storage`, `storage_group`, `persistent_cache`,
`read_only`, `access`, `execution`), plus protected `file_agents` connection settings. Each layout key resolves on its own: `--run-dir`
(CLI, `run_dirs` only) > a layout key still in the central entry (deprecated:
it keeps winning and logs `CENTRAL_LAYOUT_DEPRECATED`) > `.memon/project.yml` >
the default (`logs/*`, `outputs/*`, `experiments/*`; no extra excludes). Move existing layout keys into `.memon/project.yml` deliberately, commit that
file in the project, then remove those keys from `config.yml`. Refresh validates
the declaration; an invalid file fails closed instead of falling back to defaults.

## Architecture

- **Polling, not fs watch**: each tracked directory has its own
  exponentially-backed-off poll interval (1s → 5min × 2). User-attention
  events (opening a detail page) reset to the minimum interval.
- **mtime + content-hash optimistic lock** on README writes: front-end
  carries `expectedMtime` + optional `expectedHash`; backend returns
  409 + current content on conflict. Writers always bump `updated_at`
  server-side and return the canonical `finalContent` so editors
  re-baseline cleanly.
- **LineIndex** with sparse byte-offset anchors makes random-line
  access in multi-GB log files O(log n) after a one-pass build, with
  optional disk persistence at `~/.cache/memon/lineindex/`.
- **No client bundle pollution**: `apps/web` client components import
  only types from `@memon/core` (Node-only fast-glob never enters the
  browser).

## Spec

Capability specs live under [`openspec/specs/`](openspec/specs/) — each
directory is one capability (`experiment-readme`, `run-readme`,
`live-updates`, `experiment-edit`, `experiment-membership-anomalies`,
`memon-cli`, `memon-skills`, `web-dashboard`, etc.). Active proposals
under [`openspec/changes/`](openspec/changes/); archived changes under
[`openspec/changes/archive/`](openspec/changes/archive/).
