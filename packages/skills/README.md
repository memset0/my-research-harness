# memon skills

Bundled agent skills compose memon's research workflow. They are synced
into a project's agent skill directories by:

```sh
memon --project-root . install-skills
```

Every skill passes `--project-root .` explicitly when invoking `memon` and runs
the shared FS-version protocol in `PREFLIGHT.md`; `memon-migrate-fs` is the only
preflight-exempt and user-invoked-only skill. The same shared file defines the
CLI issue handoff used by every bundled skill.

## Skill index

| Goal | Skill | Write scope |
|---|---|---|
| Coordinate one Experiment end to end | `memon-drive` | Orchestrates other skills; Experiment writes go through the bundle writer |
| Read and filter structured Experiment results | `memon-read-results` | Read-only projection of `results.yaml` |
| Create/update Experiment-level documentation | `memon-write-experiment-doc` | README + `implementation.yaml` + `investigation.yaml` + `results.yaml` |
| Author a portable launcher | `memon-write-script` | Launcher files only; returns provenance |
| Launch and monitor one Run | `memon-run-experiment` | Run README/artifacts; Results updates through the bundle writer |
| Append one cross-project event | `memon-append-journal` | One Journal event |
| Periodic integrity sweep and digest | `memon-digest-journal` | Digest + `last_digest_at`; semantic Experiment fixes through the writer |
| Write a theme Report | `memon-write-report` | Markdown by default; explicit HTML/interactive/dashboard requests use a static bundle, optionally with a delegated visualization/frontend skill |
| Record durable project knowledge in the wiki | `memon-wiki` | Wiki pages under `docs/wiki/` via `memon wiki` plus direct Markdown edits |
| Author a registered fenced-block component | `memon-author-components` | Nothing of its own; it shapes blocks inside the calling skill's document |
| Write a human code-review guide | `memon-write-code-review` | Project/Experiment code-review doc; optional Implementation link through writer |
| Brainstorm next research work | `memon-propose` | Read-only |
| Upgrade the FS convention | `memon-migrate-fs` | Staged migration + final FS marker; explicit user invocation only |

`memon-append-warning` has been removed. The legacy warning CLI remains
permanently available only as a deprecated compatibility entry and prints a
deprecation notice on every invocation. Official skills maintain `Warnings`
through `memon-write-experiment-doc`.

## Experiment coordination

```text
                             ┌────────────────────────────┐
                             │ memon-write-experiment-doc │
                             │ canonical bundle writer    │
                             └──────────────▲─────────────┘
                                            │ semantic writes
┌──────────────┐     ┌───────────────────────┼───────────────────────┐
│ memon-drive  │────▶│ memon-write-script   │ memon-run-experiment  │
│ coordinator  │     │ memon-write-code-review / journal / reports  │
└──────┬───────┘     └───────────────────────────────────────────────┘
       │
       └─ discusses Implementation, Investigation, and Variants with user
```

The canonical Experiment contract lives in
`memon-write-experiment-doc/references/experiment-bundle.md`. Caller skills
invoke the writer instead of duplicating the full schema.

Core boundaries:

- `Implementation` is structured engineering work.
- `Investigation` is structured research work.
- `Results` contains Variant facts and Run evidence.
- `Findings` interprets Results.
- `Conclusion` is the final user-approved answer.
- A Variant exists before launch and may bind zero Runs.
- Variant `runs` are selected evidence; `attempts` are failed, interrupted,
  invalid, or superseded executions.
- Run completion never automatically answers an Investigation.

## Report forms

```text
docs/reports/R0001-topic.md

docs/reports/R0002-interactive-topic/
├── README.md
├── data/*.json
└── views/<slug>/
    ├── index.html
    └── assets/*
```

The single Markdown form is the default and existing files remain unchanged.
Only an explicit HTML, interactive, or dashboard request creates the directory
form. It is a framework-agnostic static container that runs without a dev
server. The Report writer may delegate one isolated `views/<slug>/` to an
installed visualization/frontend skill, but retains ownership of README,
frontmatter, normalized data, embeds, and final validation. Within a bundle,
`![label](./views/topic/index.html)` embeds the HTML as an unsandboxed iframe; a
normal Markdown link remains a link. New views must be responsive and touch
usable at 390 px and desktop widths. Existing bundle layouts remain compatible;
there is no required manifest or iframe auto-height protocol.

## Wiki forms

```text
docs/wiki/finding/W0001-topic.md

docs/wiki/showcase/W0006-interactive-topic/
├── README.md
├── data/*.json
└── views/<slug>/
    ├── index.html
    └── assets/*
```

The wiki is the durable knowledge layer beside the Reports. One directory per
kind — `meeting`, `finding`, `bottleneck`, `showcase`, `question`, `decision`,
`note`, `harness-feedback` — each holding `W<NNNN>-<slug>.md` or the same
bundle container the Reports use, served through the wiki asset route. The
slug is the primary human address; `memon wiki` allocates every id, path, and
slug. Pages cite Experiments, Variants, and runs in `sources`, so the system
can derive staleness and backlinks; `memon wiki commit` isolates each wiki
change in its own commit, and a human — never an agent — records verification
against those commits. Reports stay where they are and move into the wiki only
when the user names one.

## Invocation policy

`memon-migrate-fs` carries `disable-model-invocation: true`; the user must
invoke it explicitly because it may rewrite the full project convention and
create a migration commit.

All other skills may be selected autonomously when their description matches.
They still obey their own confirmation boundaries. In particular, `memon-drive`
uses the user's tone to decide whether a proposed Variant table needs explicit
approval, but always writes Variants before launching Runs.

## Shared conventions

- Skill instructions are English; user-facing conversation is Chinese unless
  the user prefers another language.
- No filesystem watchers; use polling/recurring wakeups.
- Use ISO8601 timestamps with timezone offsets.
- Direct YAML editing is allowed and expected. CLI document commands provide
  read/render/validate/lint surfaces, not CRUD gates. The Results summary and
  focused annotation get/set commands are optional conveniences; they never
  make direct `results.yaml` editing invalid.
- Strict linting is tolerant reading: unsupported/duplicate sections and
  managed-section conflicts remain visible and preserved.
- Never silently upgrade a YAML `schema_version`; FS migration owns conversion.
- Preserve unrelated user edits and use optimistic concurrency for shared
  documents.
- After safely resolving the requested task, report suspected `memon` CLI
  crashes, valid-input rejections, malformed/inconsistent output, and required
  workarounds using the redacted handoff in `PREFLIGHT.md`; expected validation
  and domain-state failures are not automatically CLI bugs.

Canonical document commands:

```sh
memon --project-root . --format json experiment doc show <id> <implementation|investigation|results>
memon --project-root . --format human experiment doc render <id> <section>
memon --project-root . --format json experiment doc validate <id>
memon --project-root . --format json experiment doc lint <id>
memon --project-root . experiment results summary <id> --output json
memon --project-root . --format json experiment results annotation get <id> [--column <key>] [--value <value>]
```

## Files written by each skill

| Skill | Writes | Does not write |
|---|---|---|
| `memon-drive` | no direct bundle files | delegates all Experiment writes |
| `memon-read-results` | nothing | all Experiment and Run documents |
| `memon-write-experiment-doc` | one Experiment bundle | Run READMEs, Journal cursor, reports |
| `memon-write-script` | launcher/script files | READMEs/YAML unless delegating to writer |
| `memon-run-experiment` | Run README/artifacts | parent bundle directly |
| `memon-append-journal` | one Journal event | Experiment/Run docs |
| `memon-digest-journal` | digest + cursor | Reports; Experiment fixes are delegated |
| `memon-write-report` | one Report file or bundle | digests, cursor, Experiment docs |
| `memon-wiki` | wiki pages under `docs/wiki/` (via `memon wiki` and direct Markdown edits) | Experiment bundles, Run READMEs, digests, Reports, review marks (`.memon/wiki-review.csv`), the journal cursor |
| `memon-author-components` | no files of its own | every document; it only shapes blocks the calling skill writes |
| `memon-write-code-review` | one code-review doc | Experiment bundle directly |
| `memon-propose` | nothing | everything |
| `memon-migrate-fs` | guide-defined staged/final paths + marker | unrelated work |
