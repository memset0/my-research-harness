# memon skills

Eleven bundled agent skills compose memon's research workflow. They are synced
into a project's agent skill directories by:

```sh
memon --project-root . install-skills
```

Every project-aware skill passes `--project-root .` explicitly and runs the
shared FS-version protocol in `PREFLIGHT.md`. `memon-notify` is the only
project-independent skill; `memon-migrate-fs` is the only preflight-exempt and
user-invoked-only skill. The same shared file defines the CLI issue handoff used
by all eleven skills, including `memon-notify` and `memon-migrate-fs`.

## Skill index

| Goal | Skill | Write scope |
|---|---|---|
| Coordinate one Experiment end to end | `memon-drive` | Orchestrates other skills; Experiment writes go through the bundle writer |
| Create/update Experiment-level documentation | `memon-write-experiment-doc` | README + `implementation.yaml` + `investigation.yaml` + `results.yaml` |
| Author a portable launcher | `memon-write-script` | Launcher files only; returns provenance |
| Launch and monitor one Run | `memon-run-experiment` | Run README/artifacts; Results updates through the bundle writer |
| Append one cross-project event | `memon-append-journal` | One Journal event |
| Periodic integrity sweep and digest | `memon-digest-journal` | Digest + `last_digest_at`; semantic Experiment fixes through the writer |
| Write a theme Report | `memon-write-report` | Single Markdown by default; HTML bundle only on explicit request |
| Write a human code-review guide | `memon-write-code-review` | Project/Experiment code-review doc; optional Implementation link through writer |
| Brainstorm next research work | `memon-propose` | Read-only |
| Upgrade the FS convention | `memon-migrate-fs` | Staged migration + final FS marker; explicit user invocation only |
| Send a Telegram alert | `memon-notify` | External notification only |

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
├── *.html
├── data/*.json
└── assets/*.{js,css,png,...}
```

The single Markdown form is the default and existing files remain unchanged.
Only an explicit HTML/interactive request creates the directory form. Within a
bundle, `![label](./view.html)` embeds the HTML as an iframe; a normal Markdown
link remains a link.

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
  read/render/validate/lint surfaces, not CRUD gates.
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
```

## Files written by each skill

| Skill | Writes | Does not write |
|---|---|---|
| `memon-drive` | no direct bundle files | delegates all Experiment writes |
| `memon-write-experiment-doc` | one Experiment bundle | Run READMEs, Journal cursor, reports |
| `memon-write-script` | launcher/script files | READMEs/YAML unless delegating to writer |
| `memon-run-experiment` | Run README/artifacts | parent bundle directly |
| `memon-append-journal` | one Journal event | Experiment/Run docs |
| `memon-digest-journal` | digest + cursor | Reports; Experiment fixes are delegated |
| `memon-write-report` | one Report file or bundle | digests, cursor, Experiment docs |
| `memon-write-code-review` | one code-review doc | Experiment bundle directly |
| `memon-propose` | nothing | everything |
| `memon-migrate-fs` | guide-defined staged/final paths + marker | unrelated work |
| `memon-notify` | Telegram message | project tree |
