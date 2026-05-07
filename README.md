# memon

Single-user, file-system-driven experiment monitor for ML/systems research.

## Why

Agent-driven experimentation produces dozens of experiment directories per
project. `squeue + grep + ls` doesn't scale; you need a single place to see
**what's running, what's done, what verified what hypothesis**, with edits
that flow back into the same files an agent can read.

`memon` is that single place. Everything lives as plain markdown on disk —
delete the tool and your data is still there, fully readable.

## 60-second quickstart

```bash
pnpm install
cp config.example.yml config.yml      # gitignored — point at your real logs
pnpm dev                               # http://localhost:3737
```

The `config.example.yml` ships pointing at `mock/project-a` and
`mock/project-b` so a fresh clone shows real data immediately.

## Stack

- **Monorepo** with pnpm workspaces — `packages/core`, `packages/cli`, `apps/web`
- **`@memon/core`** — schemas, parsers, polling, indexing, LineIndex
- **`@memon/cli`** — `memon` CLI with JSON-by-default output for agents
- **`apps/web`** — Next.js 15 App Router + Tailwind v4 + TanStack Query
- **No DB**, **no fs watcher** (cluster inotify-friendly polling instead)

## File formats memon expects

memon distinguishes two units on disk:

- **Experiment** (canonical): `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md`
  — the long-lived motivation / method / conclusion / caveats / warnings
  doc. One per investigation; can have many member runs.
- **Run**: a directory matching base-name regex `^.+-\d{6}-\d{6}$` (e.g.
  `foo-260503-082800`). Owns the per-attempt setup / result / artifacts.
  The parent directory name is irrelevant — `logs/`, `runs/`, anywhere works.

The two are bidirectionally bound: each run's frontmatter has
`experiment: E<NNNN>-<slug>` (or `null` when unbound), and each experiment
doc has a `runs: []` list. Membership-join surfaces six anomaly classes
in `memon doctor` and the web `/api/anomalies` endpoint when the two
sides disagree:

| code | meaning |
|---|---|
| `ORPHAN_RUN` | run exists with no `experiment:` and no exp claims it |
| `PHANTOM_RUN_REF` | exp's `runs[]` lists a run dir that doesn't exist |
| `MISMATCH_EXPERIMENT_REF` | run says exp X but X.runs[] disagrees |
| `DUPLICATE_EXPERIMENT_SLUG` | two exp docs share the same slug |
| `EXPERIMENT_SLUG_PREFIX_COLLISION` | one exp slug is a prefix of another |
| `RUN_SLUG_PREFIX_VIOLATION` | bound run slug doesn't start with its exp's slug |

Run slugs MAY repeat across timestamps within a project — only experiment
slugs are constrained to be unique.

### Per-experiment doc `docs/experiments/E<NNNN>-<slug>.md`

```yaml
---
id: E0001-fsdp-collective
slug: fsdp-collective
title: FSDP collective overlap study
runs: [fsdp-collective-260503-082800, fsdp-collective-260504-141200]
hypotheses: [H0007, H0012]
tags: [moe, fsdp2]
created_at: 2026-05-03T08:28:00+08:00
updated_at: 2026-05-04T14:12:00+08:00
---

## Motivation
## Method        # also lists scripts: `- \`scripts/foo/run.sh\` — <purpose>`
## Conclusion
## Caveats
## Warnings      # GFM table; see "Warnings" below
```

The `## Method` section is also where launcher scripts that drive this
experiment get registered (one bullet per script,
`- \`<rel-path>\` — <one-sentence purpose>`), so an agent reading the
exp doc later can find every script that contributes to it.

### Per-run `README.md`

```yaml
---
id: foo-260503-082800
name: foo
status: PENDING | RUNNING | FINISHED | FAILED | UNKNOWN
experiment: E0001-fsdp-collective   # parent exp doc id, or null when unbound
created_at: 2026-05-03T08:28:00+08:00
updated_at: 2026-05-03T08:28:00+08:00
finished_at: null
host: m2.cluster
pid: 12345
gpus: [0, 1, 2, 3]
entry: ./run.sh
command: bash run.sh --bs=8
wandb: https://...                  # optional
---

## Setup
## Result
## Artifacts
- `./checkpoints/` — model checkpoints
- `./outputs/loss.csv` — per-step loss
```

The run README is intentionally narrow — only `Setup` / `Result` /
`Artifacts`. The cross-run story (`Motivation`, `Method`, `Conclusion`,
`Caveats`, `Warnings`) lives on the parent experiment doc.

`status` enum is uppercase. Each value renders with an emoji in the UI:
📝 `PENDING` / 🟢 `RUNNING` / ✅ `FINISHED` / ❌ `FAILED` / ❓ `UNKNOWN`.

### Warnings

The exp doc's optional `## Warnings` section is a structured,
human-clearable surface where the agent can flag anomalies that need a
human to look at — loss spikes, config drift from a paper, baseline
mismatch, hardware blips. It's a single GFM table:

```
| Status | Created                    | Run                       | Category | Message            | Resolved | Note |
| OPEN   | 2026-05-03T11:30:00+08:00  | fsdp-collective-260503-…  | result   | spike at step 1500 | —        | —    |
```

Each row is addressed by a stable `rowId` embedded as an HTML comment.
Agents may only APPEND `[OPEN]` rows (via `memon experiment warning add`,
`memon run warning add`, or the web UI's Add form); state changes
(resolve / reopen) and deletion are **human-only acts** exposed through
the same CLI or the web UI's per-row controls. The doctor sweep
(`memon doctor`) reports a `WARN_UNRESOLVED` info finding for each
exp doc with at least one open warning.

### Per-project `docs/hypotheses.md`

Lives at `<projectRoot>/docs/hypotheses.md`. Each hypothesis is an
`## H<N>. <slug>` heading with labeled bullet items: `Statement`,
`Origin`, `Status`, `Experiments`, `Runs`, `Evidence`, `Caveats`,
`Last verified`. Status emojis: ✅ CONFIRMED / ❌ REFUTED / 🟡 PARTIAL /
🔵 OPEN / ⚪ DEFERRED.

`Experiments:` references parent exp docs by id (e.g.
`E0001-fsdp-collective`); `Runs:` references run dir names (e.g.
`fsdp-collective-260503-082800`) when a specific run is the relevant
evidence. The parser tolerates either ref shape under either field
and surfaces a `MIGRATE_HYPOTHESIS_REFS` warning when shapes are
swapped, so the disambiguation is gradual. See
[`mock/project-a/docs/hypotheses.md`](mock/project-a/docs/hypotheses.md)
for a full example.

### Per-project `docs/journal.md`

```markdown
---
last_digest_at: 2026-05-03T10:00:00+08:00
---

- 2026-05-03T08:28:00+08:00 [CREATE]      `foo-260503-082800` PENDING
- 2026-05-03T08:30:15+08:00 [STATUS]      `foo-260503-082800` PENDING → RUNNING
- 2026-05-03T09:00:00+08:00 [EXPERIMENT]  `E0001-fsdp-collective` op=create slug=fsdp-collective
- 2026-05-03T09:00:01+08:00 [BIND]        `E0001-fsdp-collective` op=link run=foo-260503-082800
- 2026-05-03T10:15:00+08:00 [NOTE]        `foo-260503-082800` converged faster than expected
- 2026-05-03T11:00:00+08:00 [REQUEST]     please summarize experiments related to H7
```

Append-only. Tags: `CREATE` / `STATUS` / `NOTE` / `REQUEST` / `ARCHIVE` /
`ERROR` / `WARNING` / `EXPERIMENT` / `BIND` / `RENAME`. STATUS / WARNING
are emitted only by the corresponding write commands; the others can be
appended manually via `memon journal append`. The `last_digest_at` field
is **owned by the digest agent** — ordinary writes never touch it.

## CLI

```
memon serve                            # start the web dashboard on port 3737
memon list [--project NAME]            # JSON list of runs (default: hide archived)
memon show <id>                        # full README content
memon search <query>                   # full-text search
memon new <name>                       # scaffold a new run dir + README
memon hypo list                        # list hypotheses
memon hypo show <H#>                   # show one hypothesis
memon mock seed                        # copy mock/ to mock-runtime/ (dev)

# Experiment-doc commands (docs/experiments/E<NNNN>-<slug>.md)
memon experiment ls                    # list exp docs
memon experiment show <id-or-slug>     # show one exp doc
memon experiment create <slug> [--title TXT] [--from-run <run-dir>]
memon experiment link <exp> <run>      # bind a run to an exp (writes both sides)
memon experiment unlink <exp> <run>    # release a run
memon experiment delete <exp> [--force]  # cascade-unlink + delete
memon experiment warning add <exp> --run <run-dir> --category C --message M
memon experiment warning {list,resolve,reopen,delete} <exp> [<rowId>]

# Run-side commands
memon run rename <run> <new-slug>      # preserves timestamp suffix
memon run status set <run> --to FINISHED --expected-mtime <ms>
cat new.md | memon run readme write <run> --expected-mtime <ms>
memon run archive <run>                # mark archived (.archived sidecar)
memon run unarchive <run>
memon run resolve-exp <run>            # print parent exp id (one line) for shell substitution
memon run warning add <run> --category C --message M    # convenience: resolves parent + dispatches

# Agent-shaped read commands (config-free)
memon scan [<project-root>]            # bulk read: experiments + hypotheses + journal
memon journal read [filters...]        # parsed JOURNAL events (--since / --tag / --experiment-id)
memon hypotheses read                  # parsed docs/hypotheses.md
memon doctor                           # scan for issues (anomalies, FINISHED w/o Result, stale RUNNING, ...)

# Agent-shaped write commands
memon journal append --tag NOTE --body "..." [--experiment-id ID]
memon journal digest-mark --at <ISO>   # only path that updates last_digest_at

memon install-skills [--project-root <p>] [--target <path>] [--agent <list>] [--dry-run]
memon fs-version check                 # report the project's .memon/version.json status
```

Default output is JSON (agent-friendly). `--format human` switches to
tabular display for direct terminal use.

The `memon experiment {status set, readme write, archive, unarchive,
warning *}` family also exists as a back-compat surface — it dispatches
to the corresponding `memon run …` command and prints a one-line
`[deprecation]` banner to stderr. New scripts should use `memon run …`
directly. Set `MEMON_QUIET_DEPRECATIONS=1` to silence the banner.

### Skill mode: `--project-root`

Skills (and any agent invocation) pass `--project-root <path>` on every
command. The path is treated as a single anonymous project root.
Mutually exclusive with `--project NAME`. When `--project-root` is
omitted, the CLI defaults to `process.cwd()` as the single project.

Non-`serve` CLI subcommands do **not** read `config.yml` at all. The
flag `--config <path>` exists only on `memon serve`, where it points
the spawned web stack at a multi-project config file.

### Exit codes (stable contract for skill branch logic)

| code | meaning |
|---|---|
| `0` | success |
| `1` | generic / unclassified failure (incl. `BAD_STATE`, e.g. orphan run) |
| `2` | usage / flag error (incl. `BAD_REQUEST`) |
| `4` | `NOT_FOUND` (experiment / run / project root missing) |
| `9` | `CONFLICT` — mtime / hash lock failed; skill SHOULD refresh and retry |
| `11` | `MEMON_TOO_OLD` — project was installed by a newer memon; upgrade memon |
| `13` | `FORBIDDEN` (path safety violation) |

### Archive

`memon run archive <run>` writes a 0-byte `.archived` sidecar inside
the run directory. `README.md` is **never** modified, so its mtime stays
stable and downstream caches (web index, LineIndex) keep working.

By default `list` / `scan` / `show` / `search` / `journal read` /
`hypotheses read` / `doctor` skip archived runs. Pass `--include-archived`
(or `--archived-only` for exclusively archived) to opt in. Archive /
unarchive each emit a JOURNAL audit entry (`[ARCHIVE]` / `[NOTE]`).

## Skills (`@memon/skills`)

memon ships agent skills as bundled `SKILL.md` files at
`packages/skills/memon-*/`. The same skill content works under Claude Code,
Codex, and opencode — each agent just reads from a different directory.
From a project root, run:

```sh
memon install-skills                              # syncs into all of:
                                                  #   ./.claude/skills/
                                                  #   ./.codex/skills/
                                                  #   ./.opencode/skills/
memon install-skills --agent claude               # only ./.claude/skills/
memon install-skills --agent claude,opencode      # subset
memon install-skills --project-root /repo         # same defaults under /repo
memon install-skills --target /custom/path        # one specific dir (no --agent)
```

The command **only manages directories whose name starts with `memon-`**
inside each target. Every existing `memon-*/` in a target is wiped and
replaced with the bundled version (including dirs from removed/renamed
skills — the goal is strict synchronisation). Non-`memon-*` skills (yours,
third-party, openspec, anything else) are left untouched.

After a successful (non-dry-run) install, if `<projectRoot>/CLAUDE.md`
exists but `<projectRoot>/AGENTS.md` does not, the command prompts you
(interactive TTY only) to symlink `AGENTS.md → CLAUDE.md` so non-Claude
agents pick up the same project guidance.

Run after each `memon` upgrade. Then invoke skills in your agent CLI of
choice via `/memon-<name>`:

| Skill | What it does |
|---|---|
| `memon-write-script` | Author or edit a launcher script. Identifies the parent experiment first (3 branches: existing exp / create new / standalone); when bound, registers the script's path in the exp doc's `## Method`. Templates only `mkdir` the run dir + tee the log; the README is the agent's job. |
| `memon-run-experiment` | Launch an existing script (with optional env-var overrides), capture `code.diff`, write the initial RUNNING README, periodically check in (every ~120 min), finalize on terminal state, post-run anomaly review (appends `[OPEN]` warnings to the exp doc), and iterate through fixes when the script doesn't run cleanly. |
| `memon-append-journal` | Manual / thin wrapper for `memon journal append` — append a single `NOTE` / `REQUEST` / `ERROR` / `EXPERIMENT` / `BIND` / `RENAME` event to docs/journal.md. (Organizing the journal is `memon-digest-journal`'s job.) |
| `memon-append-warning` | Manual / thin wrapper for `memon experiment warning add` (or `memon run warning add`). All warnings land on the parent exp doc's `## Warnings` table with the originating run named in the `Run` column. Refuses on orphan runs (prompts to bind via `memon experiment link` first). |
| `memon-digest-journal` | Run an integrity sweep, produce a date-keyed digest at `docs/digests/D<N>-<YYYY-MM-DD>.md` covering everything since the last cursor, and advance `last_digest_at`. The only skill allowed to update the cursor; race-safe. |
| `memon-write-report` | Author or update a theme-driven report at `docs/reports/R<N>-<slug>.md`. The report records its own selector (a re-runnable shell snippet) so re-running cheaply tells whether new events qualify. Doesn't touch the cursor. |
| `memon-propose` | Read-only — suggest 1-3 next experiments tied to open hypotheses. |
| `memon-migrate-fs` | Upgrade a project root's on-disk schema across `FS_CONVENTION_VERSION` bumps by reading the natural-language guides at `packages/core/migrations/v<N>-to-v<N+1>.md`. User-invoked only; never auto-fires. |

Each `SKILL.md` is plain markdown — `cat ~/.claude/skills/memon-*/SKILL.md`
or read the source under `packages/skills/` to see the exact agent
playbooks.

### Shell-script header convention

Every shell script in a run directory starts with a single-line functional
description right after the shebang (no multi-paragraph block):

```bash
#!/usr/bin/env bash
# Sweep batch size 4/8/16 with bf16, log per-step loss to log/.
set -euo pipefail
```

The script's purpose lives here; the experiment's motivation /
hypothesis-binding lives in the exp doc. Two layers, no duplication.

## Web dashboard

- **/p/[project]** — vertical-stack experiment-card grid (one card per
  exp doc), each card embedding its member runs as a compact table with
  status pills, plus a pinned anomaly banner at the top when the
  `/api/anomalies` endpoint reports any.
- **/p/[project]/e/[id]** — exp doc detail page: header (id + title +
  tags + hypotheses) + action bar (Edit markdown / Open Claude Code /
  in-browser terminal); Runs section with collapsible per-run panels
  (default folded, persisted in localStorage); Motivation / Method /
  Conclusion / Caveats sections; Warnings table; aggregated Artifacts.
- **/p/[project]/r/[id]** — legacy URL; redirects to the parent exp's
  detail page with `?run=<id>` so the corresponding run panel is
  auto-expanded.
- **/p/[project]/hypotheses** — summary table + per-entry cards with
  experiment cross-links.
- **/p/[project]/journal** — reverse-chronological timeline, filter by
  tag and experiment id, browser-tz timestamps.
- **/p/[project]/reports** + **/digests** — index pages for the
  `docs/reports/R<N>-*.md` and `docs/digests/D<N>-<date>.md` files.

The exp detail page's action bar exposes:

- **Edit markdown** — opens an in-page Monaco editor (or full-screen
  Dialog on narrow viewports) writing through `PUT
  /api/experiments/:id/readme` with `expectedMtime` + `expectedHash`
  optimistic locking. The server bumps `updated_at` on save and returns
  the canonical `finalContent` so the editor re-baselines its buffer.
  Same handshake for run READMEs via `PUT /api/runs/:id/readme`.
- **Open Claude Code** — calls `POST /api/open-claude-code` and copies
  a `cd <project-root> && claude` command to the clipboard so you can
  paste it into a local terminal. Distinct from the in-browser
  terminal below — that one runs Claude Code in a tmux session
  inside the page.
- **In-browser terminal** (per run panel) — see "Browser terminal" below.

Live updates flow over a single SSE connection at `/api/events`,
fanning out three topics: `run-change`, `experiment-change`, `anomaly`.
The frontend invalidates only the matching TanStack Query keys
(`['runs']` / `['run', id]` / `['experiments']` / `['experiment', id]` /
`['anomalies', project]`) so a remote edit propagates within ~1 second
without blanket refetching.

## Browser terminal (in-page Claude Code)

The exp detail page has an **Open in browser** button that opens a
right-side `<Sheet>` containing a live terminal running

```
tmux new-session -A -s memon-claude-<id> claude
```

The terminal is served by [`ttyd`](https://github.com/tsl0922/ttyd)
bound to `127.0.0.1:7682`. memon's process owns
`/api/terminal/proxy/*` directly — HTTP requests and the WebSocket
upgrade are auth-gated and proxied to ttyd inside the Next.js Node
entry (`apps/web/server.ts`), so deployments only need a single port
forward and no special Caddy configuration. Closing the sheet kills
`ttyd` but **leaves the tmux session detached** — so you can pick up
the same agent conversation from a real terminal:

```bash
tmux attach -t memon-claude-<id>
```

### One-time setup

1. **`tmux` is the only system dependency.** Most clusters already have it.
2. **`ttyd` is auto-managed** — no `apt`, no `brew`, no root. memon
   downloads the upstream prebuilt static binary on first use into
   `~/.cache/memon/bin/`. Click `Install ttyd (~5MB)` on the exp detail
   page once and you're done. (If you already have your own `ttyd`
   somewhere on `PATH`, memon's probe will pick it up automatically.)
   - macOS has no upstream prebuilt → fall back to `brew install ttyd`.
3. **Caddy snippet.** See [Production deployment](#production-deployment)
   below — the site block is a single `reverse_proxy localhost:3737`.

In dev (`pnpm dev`, no Caddy in front), the basic-auth dialog appears
automatically when you open `http://localhost:3737`.

### Self-check

```bash
curl http://localhost:3737/api/terminal/check
```

Returns one of three shapes:

```jsonc
// ttyd cached, ready
{"available":true,"version":"1.7.7","source":"cached","path":"~/.cache/memon/bin/ttyd-1.7.7-x86_64"}

// ttyd not yet installed but auto-fetchable (linux x64/arm64/...)
{"available":false,"downloadable":true,"suggestion":"POST /api/terminal/install"}

// macOS or unsupported arch
{"available":false,"downloadable":false,"suggestion":"brew install ttyd"}
```

The button reflects each state and offers one-click install when
`downloadable: true`.

## Production deployment

memon's HTTP server is single-user and protected by HTTP Basic auth.
There is **no signup flow, no /login page** — the browser's native
basic-auth dialog collects credentials, which means the browser caches
them per-origin and the in-page ttyd iframe inherits them automatically.
Three independent gates protect the writable terminal:

1. ttyd binds loopback only.
2. memon's custom Node entry (`apps/web/server.ts`) verifies HTTP Basic
   on every `/api/terminal/proxy/*` request **and** WebSocket upgrade
   before forwarding to ttyd.
3. Next.js middleware verifies HTTP Basic on every other dashboard route.

Caddy is only a TLS-terminating port forwarder — it does **not**
participate in auth.

### First run

Drop a `config.yml` next to `config.example.yml` (no `auth:` block needed),
then `memon serve`. The first boot generates a random 144-bit password
and persists it **plaintext** in `config.yml` under `auth.password`,
then prints it to stdout once. Plaintext on disk is intentional — the
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
real hostname). Auth and the ttyd WebSocket proxy both live inside
memon, so Caddy is just a single-port forwarder with TLS:

```caddyfile
<host> {
    reverse_proxy localhost:3737 {
        flush_interval -1
    }
}
```

That's the whole site block. No `basic_auth`, no `@terminal` matcher,
no `@sse` matcher, no `forward_auth`. The `reverse_proxy` above
forwards ordinary HTTP, SSE (`/api/events`, `/api/log/stream*`), and
the WebSocket upgrade for `/api/terminal/proxy/*/ws` — Caddy does not
need to know which is which. `flush_interval -1` disables Caddy's
response-body buffering so SSE events arrive in real time.

Apply with the usual:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Verification

From a different machine:

```bash
# Anonymous → 401 with WWW-Authenticate
curl -i https://<host>/

# Authenticated → 200
curl -i -u admin:<password> https://<host>/

# Anonymous shell access (the prior root-shell vector) → 401
curl -i -X POST https://<host>/api/terminal/start \
  -H 'content-type: application/json' \
  -d '{"runId":"x","projectName":"y"}'
```

If the first request returns 200 something is misconfigured (memon
should return 401 anonymously). Confirm `auth.password` is set in
`config.yml` and that `reverse_proxy localhost:3737` actually points
at memon.

### `.memon/version.json`

`memon install-skills` stamps a per-project marker at
`<projectRoot>/.memon/version.json`:

```json
{
  "fs_convention_version": 3,
  "installed_at": "2026-05-04T10:00:00+08:00",
  "last_migrated_at": null
}
```

The version is an integer, **independent from package semver**. Use
`memon fs-version check --project-root .` to inspect the state without
modifying anything; this is also what every skill calls in its
preflight to refuse running on a project the binary doesn't support.

The marker is **machine-managed** — don't edit it by hand.

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
