# memon

Single-user, file-system-driven experiment monitor for ML/systems research.

## Why

Agent-driven experimentation produces dozens of experiment directories per
project. `squeue + grep + ls` doesn't scale; you need a single place to see
**what's running, what's done, what verified what hypothesis**, with edits
that flow back into the same files an agent can read.

`memon` is that single place. Everything lives as plain Markdown, YAML, and
optional Report assets on disk — delete the tool and your data is still there,
fully readable.

## 60-second quickstart

```bash
pnpm install
cp config.example.yml config.yml      # gitignored — point at your real logs
pnpm dev                               # http://localhost:3737
```

The `config.example.yml` ships pointing at `mock/project-a` and
`mock/project-b` so a fresh clone shows real data immediately after copying it.
It is a source-controlled template maintained through intentional Agent or
human edits; memon runtime code never selects or writes it. Runtime-generated
values belong only in `config.yml` or another explicitly selected instance.

## Stack

- **Monorepo** with pnpm workspaces — `packages/core`, `packages/cli`, `apps/web`
- **`@memon/core`** — schemas, parsers, polling, indexing, LineIndex
- **`@memon/cli`** — `memon` CLI with JSON-by-default output for agents
- **`apps/web`** — Next.js 15 App Router + Tailwind v4 + TanStack Query
- **No DB**, **no fs watcher** (cluster inotify-friendly polling instead)

## File formats memon expects

memon distinguishes two units on disk:

- **Experiment** (canonical):
  `<projectRoot>/docs/experiments/E<NNNN>-<slug>/` — a long-lived README plus
  structured Implementation, Investigation, and Results YAML. One per
  investigation; can have many member Runs and Variants.
- **Run**: a directory matching base-name regex `^.+-\d{6}-\d{6}$` (e.g.
  `foo-260503-082800`). Records execution identity, state and execution-specific facts.
  The parent directory name is irrelevant — `logs/`, `runs/`, anywhere works.

The two are bidirectionally bound: each run's frontmatter has
`experiment: E<NNNN>-<slug>` (or `null` when unbound), and each experiment
doc has a `runs: []` list. Membership-join surfaces six anomaly classes
through the web `/api/anomalies` endpoint when the two sides disagree:

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

### Per-experiment bundle `docs/experiments/E<NNNN>-<slug>/`

```text
E0001-fsdp-collective/
├── README.md
├── implementation.yaml
├── investigation.yaml
└── results.yaml
```

`README.md` keeps the narrative and the three exact managed-section pointers:

```markdown
---
id: E0001-fsdp-collective
slug: fsdp-collective
title: FSDP collective overlap study
status: OPEN
archived: false
runs: [fsdp-collective-260503-082800, fsdp-collective-260504-141200]
hypotheses: [H0007, H0012]
tags: [moe, fsdp2]
created_at: 2026-05-03T08:28:00+08:00
updated_at: 2026-05-04T14:12:00+08:00
---

## Motivation
## Design
## Implementation
> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.
## Investigation
> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.
## Results
> Managed in [results.yaml](./results.yaml); read and update that file directly.
## Findings
## Limitations
## Conclusion
## Warnings      # GFM table; see "Warnings" below
```

`implementation.yaml` is the hierarchical engineering plan;
`investigation.yaml` tracks empirical questions and criteria; `results.yaml`
defines Variants before launch and keeps selected `runs` separate from failed,
interrupted, invalid, or superseded `attempts`. Agents edit these YAML files
directly. `memon experiment doc render` provides their shared human-readable
Markdown projection for the CLI and Web.

### Per-run `README.md`

```yaml
---
id: foo-260503-082800
status: FINISHED
created_at: 2026-05-03T08:28:00+08:00
experiment: E0001-fsdp-collective   # optional parent reference
---

```

New Runs need no narrative chapters. Keep shared design, parameters, metrics and
interpretation in the Experiment/Variant; record only execution-specific facts
or actual deviations here. Optional frontmatter includes `name`, `updated_at`,
`finished_at`, `host`, `pid`, `gpus`, `entry`, `command` and `wandb`.
The body is optional free-form Markdown. Existing rich READMEs remain readable
without migration or prompts to fill empty sections.

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
Current skills maintain this section through `memon-write-experiment-doc`.
The legacy `memon experiment warning ...` and `memon run warning add` CLI
surfaces remain functional indefinitely, but print a permanent deprecation
notice on every invocation. State changes
(resolve / reopen) and deletion are **human-only acts** exposed through
the same CLI or the web UI's per-row controls. Lint checks document structure;
it does not interpret an unresolved research warning as an execution defect.

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

### Diagnostic Journal and legacy `docs/journal.md`

Journal is a project-scoped tool invocation ledger, not research knowledge.
New records live in `.memon/activity/<invocation-id>.json`; project-scoped
non-readonly CLI/service calls record automatically, including failures,
conflicts, no-ops and incomplete calls. Reads, lint, validation, polling and
dry runs do not record. Machine-level hosting/update commands have no project
Journal. Rejected CLI syntax records the identified mutating command without
unparsed arguments when its project can be resolved.

Existing `docs/journal.md` bytes remain untouched. Historical digest documents
are converted only by the reviewed v7 migration. A legacy Journal can still look like this:

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

`memon journal read` explicitly queries preserved legacy lines and new
receipts, with origin/outcome, Experiment/Run and timezone-aware filters.
It is not part of normal `scan` or research handoff context. New receipt
diagnostics are owner-only; legacy read permissions remain unchanged.
The historical `last_digest_at` field is opaque metadata: no supported
command advances it, and the digest workflow has been retired.

After directly maintaining Experiment/Wiki documents, the owning skill runs
one `memon journal submit --files <project-relative-paths...>` for that batch.
The CLI validates managed paths and computes current fingerprints; the Agent
does not read or write Journal files or supply Journal prose. Native CLI
writes already record themselves and need no extra submission. New findings,
questions and decisions belong in Wiki, backed by Experiment/Run sources.

### Reports

Existing Markdown Reports stay in their single-file form. HTML/interactive
Reports are opt-in directory bundles:

```text
docs/reports/R0001-summary.md

docs/reports/R0002-interactive-summary/
├── README.md
├── data/metrics.json
└── views/
    └── training-curves/
        ├── index.html
        └── assets/*
```

An HTML bundle is a framework-independent static visualization container, so
the Report writer may coordinate with an installed visualization/frontend
skill to produce an individual `views/<slug>/` tree. Bundle HTML may fetch
Report-local JSON and load local or CDN JavaScript/CSS, but it must not depend
on a development server. In the bundle README,
`![Training curves](./views/training-curves/index.html)` embeds the local HTML as
a same-origin iframe, while `[Open curves](./views/training-curves/index.html)`
remains an ordinary link. Generated views should be responsive and usable on a
phone as well as a desktop. The first version intentionally does not sandbox
Agent-authored iframe content; local asset requests are nevertheless confined
to that Report bundle.

### Wiki

The wiki is the project's living knowledge base. Reports stay as they are;
new narrative content goes to `docs/wiki/`, one directory per kind:

```text
docs/wiki/finding/W0001-zero-snr-brightness.md        # single-file page
docs/wiki/showcase/W0006-edm2-precond-explorer/       # bundle page
├── README.md
├── data/fid.csv
└── views/explorer/index.html
```

| Kind | What it holds | `status` vocabulary |
|---|---|---|
| `meeting` | who met, what was decided, action items (`date:` required) | none |
| `roadmap` | a content-first research tree connecting goals, questions, directions, and inline evidence | none |
| `finding` | a claim with its evidence and limits (`sources:` required) | `TENTATIVE` / `VERIFIED` / `RETRACTED` |
| `bottleneck` | the current blocker, impact, candidates | `OPEN` / `MITIGATED` / `RESOLVED` |
| `showcase` | something presentable, how to reproduce it | `DRAFT` / `READY` / `OUTDATED` |
| `question` | an open question with context and eventual answer | `OPEN` / `ANSWERED` / `DROPPED` |
| `decision` | a decision, its rationale and consequences | `PROPOSED` / `ACCEPTED` / `SUPERSEDED` |
| `note` | anything else (migrated Reports land here with `legacy_id`) | none |
| `harness-feedback` | a proposal to improve this harness, filed by the agent | `PROPOSED` / `ACCEPTED` / `SHIPPED` / `REJECTED` |

Every page has YAML frontmatter (`id: W<NNNN>`, `kind`, `title`,
`description`, `created_at`, `updated_at`, plus kind-specific keys) and three
independent trust axes:

- **evidence** — `sources:` lists the Experiments / Variants (`E0017/V0068`) /
  Hypotheses / runs the page rests on; when one changes after `updated_at`
  the page is `stale`.
- **author judgement** — the kind's `status`, when that kind carries one.
- **human review** — humans verify *wiki commits* oldest to newest
  (`memon wiki review verify next`); the Web dashboard derives each page's
  `VERIFIED`, `CHANGED_SINCE_VERIFY` (with the exact unverified line ranges)
  or `UNVERIFIED` state. The CLI reports no per-page review state; it offers
  one whole-wiki diff (`memon wiki review diff`) from the last verified commit
  to `HEAD`. Agents never write review marks; they commit each wiki change
  separately with `memon wiki commit`.

Inside a body, `@W0001`, `@E0017`, `@E0017/V0068`, `@H0003` and
`@<run-dir>` are links. A fenced block declared `` ```<lang> <type>@<N> #<id> ``
renders as a component on every dashboard Markdown surface: `datatable@1`
(a table plus line/bar views), `figure@1` (a captioned image beside the
document), `embed@1` (HTML in an iframe) and `checklist@1` (a recursive list
with independent Agent and human flags). The payload language parses the body
into the one object the component receives — `yaml`/`json` to a mapping, any
other language to `{ data: "<body>" }`. A `yaml` payload carrying `script:` or
`code:` is executed on request by `memon components run` and its result is
cached in `<stem>__assets/<id>.json` beside the document. Unknown fences
degrade to plain code blocks.

```
memon wiki ls [--kind K] [--status S] [--source ARTIFACT]
memon wiki show|create|move|set|delete <page>
memon wiki lint [--strict]
memon wiki backlinks <artifact>
memon wiki review log|diff|verify <sha|next>|unverify <sha>   # diff: whole docs/wiki/ since last verified commit
memon wiki commit [-m SUMMARY]                  # stages only docs/wiki/
memon wiki migrate-report <R-id> <kind> [<slug>]
memon wiki kinds ls --format human
memon wiki kinds show initiative --format json

memon components run <document> [--id ID]...    # recompute executable component blocks
```

The CLI validates source syntax and filters declared source tokens; only Web
resolves Markdown source targets, computes staleness, and derives per-page
review state. `wiki backlinks` matches pages' declared `sources`, not
references scanned from Markdown bodies.

Migration is editorial and one Report at a time (`migrate-report`); a
migrated page keeps `legacy_id: R<NNNN>` so old `R` links keep resolving.

Wiki kinds, policies and bilingual guidance are configured in
`packages/core/src/wiki/kinds.json`. The Wiki help button displays “Wiki 类型指南”.
See [Wiki kind registry](docs/wiki-kind-registry.md) for schema fields,
deterministic skill generation, drift checks, explicit package/skill refresh,
and safe migration boundaries. Editing the registry does not update deployed
instances or move existing pages automatically.

## CLI

```
memon serve                            # start the web dashboard on port 3737
memon list [--project NAME]            # JSON runs; excludes archived/deprecated by default
memon show <id>                        # full README content
memon search <query>                   # full-text search
memon hypo list                        # list hypotheses
memon hypo show <H#>                   # show one hypothesis
memon mock seed                        # copy mock/ to mock-runtime/ (dev)

# Experiment-bundle commands (docs/experiments/E<NNNN>-<slug>/)
memon experiment ls                    # list exp docs
memon experiment show <id-or-slug>     # show one exp doc
memon experiment create <slug> [--title TXT] [--from-run <run-dir>]
memon experiment doc show <id> <implementation|investigation|results>
memon --format human experiment doc render <id> <implementation|investigation|results>
memon experiment doc lint <id>         # syntax, schema and document structure only
memon experiment link <exp> <run>      # bind a run to an exp (writes both sides)
memon experiment unlink <exp> <run>    # release a run
memon experiment delete <exp> [--force]  # cascade-unlink + delete
memon experiment warning add <exp> --run <run-dir> --category C --message M
memon experiment warning {list,resolve,reopen,delete} <exp> [<rowId>]

# Run-side commands
memon run rename <run> <new-slug>      # preserves timestamp suffix
memon run record <run> --status RUNNING # minimal README for an existing execution directory
memon run status set <run> --to FINISHED --expected-mtime <ms>
cat new.md | memon run readme write <run> --expected-mtime <ms>
memon run archive <run>                # archive visibility; independent of research eligibility
memon run unarchive <run>
memon run lint <run>                   # schema/structure; no required body chapters
memon run deprecate <run>              # exclude from research without changing execution status
memon run undeprecate <run>            # restore research eligibility
memon run resolve-exp <run>            # print parent exp id (one line) for shell substitution
memon run warning add <run> --category C --message M    # convenience: resolves parent + dispatches

# Agent-shaped read commands (config-free)
memon scan [<project-root>]            # research snapshot; no Journal reads
memon journal read [filters...]        # explicit diagnostic history query
memon hypotheses read                  # parsed docs/hypotheses.md

# Finalize direct Experiment/Wiki document maintenance (no Journal prose)
memon journal submit --files docs/experiments/E0001-example/README.md

memon install-skills [--project-root <p>] [--target <path>] [--agent <list>] [--dry-run]
memon fs-version check                 # report the project's .memon/version.json status

# Installation maintenance
memon update [--source <checkout>] [--remote <name>] [--branch <name>]
             [--skills-root <p>]... [--no-skills] [--dry-run]
```

Default output is JSON (agent-friendly). `--format human` switches to
tabular display for direct terminal use.

Legacy run-shaped aliases in the `memon experiment {status set, readme write,
archive, unarchive}` family print a one-line `[deprecation]` banner; new scripts
should use `memon run …` directly. `MEMON_QUIET_DEPRECATIONS=1` may silence
those v2-alias banners. It never silences the permanent warning-CLI banner:
every `memon experiment warning ...` or `memon run warning add ...` invocation
continues to work and reports that Warnings should now be maintained through
`memon-write-experiment-doc`.

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

### Archive and research eligibility

Archiving and deprecation are independent. `memon run deprecate <run>` sets the
reversible frontmatter boolean `deprecated: true`; absence means false.
`undeprecate` removes it. Neither command changes execution status, stops a
process, deletes artifacts, or rewrites stored measurements. Both accept
`--expected-mtime` for optimistic concurrency.

Run collections (`list`, `search`, `scan`) exclude deprecated Runs by default,
but deprecation does not remove their Variant association. Use
`--include-deprecated`, `--deprecated-only`, or an explicit Run id to inspect
history, including scripts, commands, environment and recovery logs useful for
a rerun. Correct the known problem before reusing that setup; the old Run's
metrics remain excluded from current analysis. Archive flags remain separate.

Results projections expose per-Variant `metricsValidity` (`valid`, `partial`,
`unavailable`) and the affected Run references. A stored aggregate that depended
on deprecated Runs is not silently reused as valid evidence or recomputed from
insufficient data. Original values remain in `results.yaml`; human-readable
views mark their validity. Lint does not report research eligibility as a defect.

For a user-requested redo of an Experiment's Variants, retain the Variant
definitions and historical associations, deprecate the old Runs in the agreed
scope, and create fresh Runs for the same conditions after checking the old
execution setup. Changing the comparison conditions still requires declaring
them before launch. Write back verified new metrics and their actual source
Runs in a coherent batch, without erasing the old evidence.

The intended distinction is historical membership versus the evidence used for
current metrics: valid replacement results must not be permanently penalized
by a deprecated historical Run. **Current limitation:** the projection checks
all `Variant.runs`, without separate current-measurement lineage, so it can
still report `partial` after a rerun. This documentation clarification does not
implement that separation or automatic result writeback. Do not delete history
or undeprecate rejected evidence to work around the limitation.

Archive and deprecation mutations are recorded by the invocation ledger, not
by authored Journal prose. `memon doctor` and `experiment doc validate` are
retired; use `run lint` or `experiment doc lint` for structural checks.

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

Currently shipped `memon-*` skills are replaced from the bundled source.
Retired skills are removed only when their entire file tree matches a known
shipped version. Customized, extended, symlinked and unknown directories are
preserved and reported; unrelated custom skills remain untouched. Use
`--dry-run` to inspect the planned synchronization.

After a successful (non-dry-run) install, if `<projectRoot>/CLAUDE.md`
exists but `<projectRoot>/AGENTS.md` does not, the command prompts you
(interactive TTY only) to symlink `AGENTS.md → CLAUDE.md` so non-Claude
agents pick up the same project guidance.

Run after each `memon` upgrade. Then invoke skills in your agent CLI of
choice via `/memon-<name>`:

| Skill | What it does |
|---|---|
| `memon-drive` | Coordinate an Experiment and batch meaningful Experiment/Variant updates; user approval still controls research resolution. |
| `memon-write-experiment-doc` | Apply the shared writing workflow to README/YAML sources, preserve unsupported content, and lint the changed bundle. No mandatory subagent handoff. |
| `memon-write-script` | Author a portable launcher and return entry/recipe/env provenance without creating an Implementation item just because a script exists. |
| `memon-run-experiment` | Launch/resume a predeclared Variant, maintain a minimal execution record, and monitor to the requested completion boundary. |
| `memon-write-report` | Write a single Markdown Report by default, or an HTML-capable directory bundle only when the user explicitly requests HTML/interactive presentation. |
| `memon-write-code-review` | Write a project- or Experiment-scoped human review guide and optionally link it to an Implementation item through the writer. |
| `memon-propose` | Rank next Experiments/Variants using Experiment documents and Variant-level results only; report gaps rather than reading Run bodies, Attempts or logs. |
| `memon-migrate-fs` | User-invoked staged FS-convention migration with review before production publish. |

`memon-append-journal` and `memon-digest-journal` are retired. Skills do not
author Journal history or use it as research input.

The former `memon-append-warning` skill is intentionally absent. Reinstalling
skills removes its unmodified shipped directory. Its CLI commands remain as the
permanently deprecated compatibility surface described above.

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
  tags + hypotheses) + Edit markdown action; Runs section with collapsible
  per-run panels (default folded, persisted in localStorage); all canonical v6
  sections in README order; YAML-rendered Implementation / Investigation /
  Results; compatibility diagnostics that keep unknown/duplicate/conflicting
  content visible; Warnings and aggregated Artifacts.
- **/p/[project]/r/[id]** — legacy URL; redirects to the parent exp's
  detail page with `?run=<id>` so the corresponding run panel is
  auto-expanded.
- **/p/[project]/hypotheses** — summary table + per-entry cards with
  experiment cross-links.
- **/p/[project]/journal** — reverse-chronological timeline, filter by
  tag and experiment id, browser-tz timestamps.
- **/p/[project]/reports** — index pages for single-file or directory-bundle
  Reports. Historical Digests move to Wiki's `digest` kind through the reviewed
  v7 migration; standalone Digest routes are retired. Local `.html` image references render
  as unsandboxed iframes; normal links remain links.

The exp detail page's action bar exposes:

- **Edit markdown** — opens an in-page Monaco editor (or full-screen
  Dialog on narrow viewports) writing through `PUT
  /api/experiments/:id/readme` with `expectedMtime` + `expectedHash`
  optimistic locking. The server bumps `updated_at` on save and returns
  the canonical `finalContent` so the editor re-baselines its buffer.
  Same handshake for run READMEs via `PUT /api/runs/:id/readme`.

Live updates flow over a single SSE connection at `/api/events`,
fanning out three topics: `run-change`, `experiment-change`, `anomaly`.
The frontend invalidates only the matching TanStack Query keys
(`['runs']` / `['run', id]` / `['experiments']` / `['experiment', id]` /
`['anomalies', project]`) so a remote edit propagates within ~1 second
without blanket refetching.


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

To let a collaborator look at ONE project's runs / experiments / reports
without giving them owner credentials, issue a per-project share link:

```bash
# In the project directory (or pass --project-root):
memon share create project-a --label "Reviewer Alice" --expires 30d \
  --url-base https://memon.example.com
# → prints: https://memon.example.com/share/project-a/<token>
```

What the link does when opened:

1. Validates the token against `<projectRoot>/.memon/shares.json` (created
   atomically; gitignored).
2. Sets a signed `memon-shares` cookie scoped to that project on the
   visitor's browser, HttpOnly + SameSite=Lax + Max-Age=90 days.
3. Redirects to `/p/<project>` — viewer mode.

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

To revoke a share, run `memon share revoke <id-prefix>` (or use the "Share"
button on the project page header). The cookie holder silently loses
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
never the Web app's dependencies); build `@memon/core` and `@memon/cli`; run
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
  "fs_convention_version": 6,
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
Use
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
