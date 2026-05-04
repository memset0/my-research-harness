# memon

Single-user, file-system-driven experiment monitor for ML/systems research.
Live demo: <https://memon-vultr.dev.mem.ac/>.

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

memon discovers experiment directories by **base-name regex**
`^.+-\d{6}-\d{6}$` (e.g. `foo-260503-082800` = May 3 2026 at 08:28:00 local).
The parent directory name is irrelevant — `logs/`, `runs/`, anywhere works.

### Per-experiment `README.md`

```yaml
---
id: foo-260503-082800
name: foo
project: project-a
status: PENDING | RUNNING | FINISHED | FAILED | UNKNOWN
created_at: 2026-05-03T08:28:00+08:00
finished_at: null
host: m2.cluster
pid: 12345
gpus: [0, 1, 2, 3]
entry: ./run.sh
command: bash run.sh --bs=8        # full command actually invoked
wandb: https://...                  # optional
hypotheses: [H1, H3]                # related — no judgment
tags: [moe, fsdp2]
---

## Motivation
## Setup
## Method
## Result
## Conclusion
## Caveats
## Artifacts
- `./checkpoints/` — model checkpoints
- `./outputs/loss.csv` — per-step loss
## New Hypotheses                   # optional, signals digest agent
```

`status` enum is uppercase. Each value renders with an emoji in the UI:
📝 `PENDING` / 🟢 `RUNNING` / ✅ `FINISHED` / ❌ `FAILED` / ❓ `UNKNOWN`.

### Per-project `HYPOTHESES.md`

Lives at the project root. Each hypothesis is an `## H<N>. <slug>` heading
with labeled bullet items: `Statement`, `Origin`, `Status`, `Experiments`,
`Evidence`, `Caveats`, `Last verified`. Status emojis: ✅ CONFIRMED / ❌
REFUTED / 🟡 PARTIAL / 🔵 OPEN / ⚪ DEFERRED. Experiments are referenced
by directory name (no E1/E2 ad-hoc IDs). See
[`mock/project-a/HYPOTHESES.md`](mock/project-a/HYPOTHESES.md) for a full
example.

### Per-project `JOURNAL.md`

```markdown
---
last_digest_at: 2026-05-03T10:00:00+08:00
---

- 2026-05-03T08:28:00+08:00 [CREATE]   `foo-260503-082800` PENDING
- 2026-05-03T08:30:15+08:00 [STATUS]   `foo-260503-082800` PENDING → RUNNING
- 2026-05-03T10:15:00+08:00 [NOTE]     `foo-260503-082800` converged faster than expected
- 2026-05-03T11:00:00+08:00 [REQUEST]  please summarize experiments related to H7
```

Append-only. Tags: `CREATE` / `STATUS` / `NOTE` / `REQUEST` / `ARCHIVE` /
`ERROR`. The `last_digest_at` field is **owned by the digest agent** —
ordinary writes (`memon new`, status edits, notes) never touch it.

## CLI

```
memon serve                            # start the web dashboard on port 3737
memon list [--project NAME]            # JSON list of experiments (default: hide archived)
memon show <id>                        # full README content
memon search <query>                   # full-text search
memon new <name>                       # scaffold a new experiment dir + README
memon hypo list                        # list hypotheses
memon hypo show <H#>                   # show one hypothesis
memon mock seed                        # copy mock/ to mock-runtime/ (dev)

# agent-shaped read commands (config-free)
memon scan [<project-root>]            # bulk read: experiments + hypotheses + journal
memon journal read [filters...]        # parsed JOURNAL events (--since / --tag / --experiment-id)
memon hypotheses read                  # parsed HYPOTHESES.md (mirrors /api/hypotheses)
memon doctor                           # scan for issues (FINISHED w/o Result, stale RUNNING, ...)

# agent-shaped write commands
memon journal append --tag NOTE --body "..." [--experiment-id ID]
memon journal digest-mark --at <ISO>   # only path that updates last_digest_at
memon experiment status set <id> --to FINISHED --expected-mtime <ms>
cat new.md | memon experiment readme write <id> --expected-mtime <ms>
memon experiment archive <id>          # mark as archived (.archived sidecar)
memon experiment unarchive <id>

memon install-skills [--project-root <p>] [--target <path>] [--dry-run]
```

Default output is JSON (agent-friendly). `--format human` switches to
tabular display for direct terminal use.

### Skill mode: `--project-root`

Skills (and any config-free agent invocation) pass `--project-root <path>`
on every command. This **bypasses `config.yml` entirely** — the path is
treated as a single anonymous project root. Mutually exclusive with
`--config` and `--project NAME`.

### Exit codes (stable contract for skill branch logic)

| code | meaning |
|---|---|
| `0` | success |
| `1` | generic / unclassified failure |
| `2` | usage / flag error (incl. `BAD_REQUEST`) |
| `4` | `NOT_FOUND` (experiment / project root missing) |
| `9` | `CONFLICT` — mtime / hash lock failed; skill SHOULD refresh and retry |
| `13` | `FORBIDDEN` (path safety violation) |

### Archive

`memon experiment archive <id>` writes a 0-byte `.archived` sidecar inside
the run directory. README.md is **never** modified, so its mtime stays
stable and downstream caches (web index, LineIndex) keep working.

By default `list` / `scan` / `show` / `search` / `journal read` /
`hypotheses read` / `doctor` skip archived runs. Pass `--include-archived`
(or `--archived-only` for exclusively archived) to opt in. Archive /
unarchive each emit a JOURNAL audit entry (`[ARCHIVE]` / `[NOTE]`).

## Skills (`@memon/skills`)

memon ships 6 Claude Code skills as bundled `SKILL.md` files at
`packages/skills/memon-*/`. From a project root, run:

```sh
memon install-skills                        # syncs into ./.claude/skills/
memon install-skills --project-root /repo   # syncs into /repo/.claude/skills/
```

The command **only manages directories whose name starts with `memon-`**.
Every existing `memon-*/` in the target is wiped and replaced with the
bundled version (including dirs from removed/renamed skills — the goal is
strict synchronisation). Non-`memon-*` skills (yours, third-party,
openspec, anything else) are left untouched.

Run after each `memon` upgrade. Then invoke skills in Claude Code via
`/memon-<name>`:

| Skill | What it does |
|---|---|
| `memon-write-script` | Author or edit a launcher script (`scripts/<area>/run_*.sh`) following memon's `RUN_NAME` / `RUN_DIR` / one-line-header conventions. Scripts only `mkdir` the run dir + tee the log; the README is the agent's job. |
| `memon-run-experiment` | Launch an existing script (with optional env-var overrides), capture `code.diff`, write the initial RUNNING README + Motivation/Setup/Method, periodically check in (every ~120 min), finalize on terminal state, and iterate through fixes when the script doesn't run cleanly. |
| `memon-append-journal` | Manual / thin wrapper for `memon journal append` — append a single NOTE / REQUEST / ERROR event to JOURNAL.md. (Organizing the journal is `memon-digest-journal`'s job.) |
| `memon-digest-journal` | Run an integrity sweep (the former `memon-doctor` checks fold in here), produce a date-keyed digest at `docs/digests/D<N>-<YYYY-MM-DD>.md` covering everything since the last cursor, and advance `last_digest_at`. The only skill allowed to update the cursor; race-safe. |
| `memon-write-report` | Author or update a theme-driven report at `docs/reports/R<N>-<slug>.md`. The report records its own selector (a re-runnable shell snippet) so re-running cheaply tells whether new events qualify. Doesn't touch the cursor. |
| `memon-propose` | Read-only — suggest 1-3 next experiments tied to open hypotheses. |

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
hypothesis-binding lives in `README.md`. Two layers, no duplication.

## Web dashboard

- **/p/[project]** — experiment list with status emoji, free-text search,
  status filter, stale RUNNING ⚠ indicator
- **/p/[project]/experiments/[id]** — full detail with all 8 README
  sections rendered, hypothesis cross-links, artifact list, log viewer
  (line-numbered tail, follow toggle, ↑ load earlier, infinite scroll up)
- **/p/[project]/hypotheses** — summary table + per-entry cards with
  experiment cross-links
- **/p/[project]/journal** — reverse-chronological timeline, filter by tag
  and experiment id, browser-tz timestamps

## Browser terminal (in-page Claude Code)

The experiment detail page has an **Open in browser** button that opens a
right-side `<Sheet>` containing a live terminal running

```
tmux new-session -A -s memon-claude-<expid> claude
```

The terminal is served by [`ttyd`](https://github.com/tsl0922/ttyd) bound to
`127.0.0.1:7682`. memon's process owns `/api/terminal/proxy/*` directly —
HTTP requests and the WebSocket upgrade are auth-gated and proxied to ttyd
inside the Next.js Node entry (`apps/web/server.ts`), so deployments only
need a single port forward and no special Caddy configuration. Closing the
sheet kills `ttyd` but **leaves the tmux session detached** — so you can
pick up the same agent conversation from a real terminal:

```bash
tmux attach -t memon-claude-<expid>
```

### One-time setup

1. **`tmux` is the only system dependency.** Most clusters already have it.
2. **`ttyd` is auto-managed** — no `apt`, no `brew`, no root. memon downloads
   the upstream prebuilt static binary on first use into
   `~/.cache/memon/bin/`. Click `Install ttyd (~5MB)` on the experiment
   detail page once and you're done. (If you already have your own `ttyd`
   somewhere on `PATH`, memon's probe will pick it up automatically — the
   install step is only for hosts where ttyd is completely absent.)
   - macOS has no upstream prebuilt → fall back to `brew install ttyd`.
3. **Caddy snippet.** See [Production deployment](#production-deployment)
   below — the site block is a single `reverse_proxy localhost:3737`. memon
   owns the auth gate (HTTP + WebSocket) and the ttyd proxy in process, so
   no `basic_auth`, no `forward_auth`, and no extra path matchers are
   required.

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

memon's HTTP server is single-user and protected by HTTP Basic auth. There is
**no signup flow, no /login page** — the browser's native basic-auth dialog
collects credentials, which means the browser caches them per-origin and the
in-page ttyd iframe inherits them automatically. Three independent gates
protect the writable terminal: (1) ttyd binds loopback only, (2) memon's
custom Node entry (`apps/web/server.ts`) verifies HTTP Basic on every
`/api/terminal/proxy/*` request **and** WebSocket upgrade before forwarding
to ttyd, (3) Next.js middleware verifies HTTP Basic on every other dashboard
route. Caddy is only a TLS-terminating port forwarder — it does **not**
participate in auth.

### First run

Drop a `config.yml` next to `config.example.yml` (no `auth:` block needed),
then `memon serve`. The first boot generates a random 144-bit password and
persists it **plaintext** in `config.yml` under `auth.password`, then prints
it to stdout once. Plaintext on disk is intentional — the threat model is
"single user, host fs trust = auth trust" (same as `~/.ssh/id_*`), and the
single canonical source means dev agents and curl-based automation can read
the password from one place without a separate secret store.

```text
*** memon: generated initial password ***
  username: admin
  password: <24-char base64url>
Persisted in /path/to/config.yml as plaintext (auth.password).
```

To rotate later: edit `auth.password` in `config.yml` to any new value and
restart `memon serve`. To regenerate: delete the `auth` block entirely.
**No Caddy reload is needed for password changes** — memon owns the only
copy of the credential.

### Caddyfile

Replace your `<host>` site block with the following (substituting your real
hostname). Auth and the ttyd WebSocket proxy both live inside memon, so
Caddy is just a single-port forwarder with TLS:

```caddyfile
<host> {
    reverse_proxy localhost:3737 {
        flush_interval -1
    }
}
```

That's the whole site block. No `basic_auth`, no `@terminal` matcher, no
`@sse` matcher, no `forward_auth`. The `reverse_proxy` above forwards
ordinary HTTP, SSE (`/api/events`, `/api/log/stream*`), and the WebSocket
upgrade for `/api/terminal/proxy/*/ws` — Caddy does not need to know which
is which. `flush_interval -1` disables Caddy's response-body buffering so
SSE events arrive in real time (harmless for everything else).

Apply with the usual:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

**To rotate the password**:

1. Edit `config.yml`'s `auth.password` to any new plaintext value.
2. Restart memon. (Caddy is not part of the rotation flow.)

> ℹ️ **Upgrading from the older Caddyfile.** If your existing site block
> contains `basic_auth { ... }` and an `@terminal path /api/terminal/proxy/*`
> matcher, it will keep working — memon now also gates those paths in
> process. After confirming the upgrade, you can trim back to the
> single-line snippet above; `caddy hash-password` is no longer needed.

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
  -d '{"experimentId":"x","projectName":"y"}'
```

If the first request returns 200 something is misconfigured (memon should
return 401 anonymously). Confirm `auth.password` is set in `config.yml`
and that `reverse_proxy localhost:3737` actually points at memon.

## Architecture

- **Polling, not fs watch**: each tracked directory has its own
  exponentially-backed-off poll interval (1s → 5min × 2). User-attention
  events (opening a detail page) reset to the minimum interval.
- **mtime optimistic lock** on README writes: front-end carries
  `expectedMtime`; backend returns 409 + current content on conflict.
- **LineIndex** with sparse byte-offset anchors makes random-line access
  in multi-GB log files O(log n) after a one-pass build, with optional
  disk persistence at `~/.cache/memon/lineindex/`.
- **No client bundle pollution**: `apps/web` client components import only
  types from `@memon/core` (Node-only fast-glob never enters the browser).

## Status

MVP scope: **read-only** dashboard with all read paths plus mock data,
end-to-end verified live at <https://memon-vultr.dev.mem.ac/>.

Deferred for follow-up:
- README inline editor with mtime-conflict diff resolution
- localStorage draft recovery
- Status edit control (atomic README + JOURNAL write — backend already
  supports it)
- Claude Skill packaging (`memon-propose`, `memon-summarize`,
  `memon-append-journal`, `memon-digest-journal`)
- GPU/disk monitoring under the existing `resources` hook
- WandB iframe embed (only links for now)

## Spec

The full proposal, design, capability specs, and implementation tasks live
at [`openspec/changes/add-memon-mvp/`](openspec/changes/add-memon-mvp/).
