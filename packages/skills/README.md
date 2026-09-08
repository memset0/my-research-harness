# memon skills

Bundled agent skills compose memon's research workflow. They are synced into a
project's agent skill directories by:

```sh
memon --project-root . install-skills
```

Every skill passes `--project-root .` explicitly and follows `PREFLIGHT.md`,
which is the single home for the FS-version protocol, the lint-not-doctor rule,
deprecated-Run semantics, document trust, secrets, Journal rules, and the CLI
issue handoff. `memon-migrate-fs` is the only preflight-exempt and
user-invoked-only skill. A skill is a set of instructions, not a mandatory
delegation: following another skill's rules inline is always allowed.

## Skill index

| Goal | Skill | Write scope |
|---|---|---|
| Coordinate one Experiment end to end | `memon-drive` | Orchestrates other skills; Experiment writes go through the bundle writer |
| Read and filter structured Experiment results | `memon-read-results` | Read-only projection of `results.yaml` |
| Create/update Experiment-level documentation | `memon-write-experiment-doc` | README + `implementation.yaml` + `investigation.yaml` + `results.yaml` |
| Author a portable launcher | `memon-write-script` | Launcher files only; returns provenance |
| Launch, resume, or inspect one execution | `memon-run-experiment` | Minimal Run record/artifacts; Results updates through the bundle writer |
| Record durable project knowledge, roadmap, or a cross-project note | `memon-wiki` | Wiki pages under `docs/wiki/` via `memon wiki` plus direct Markdown edits |
| Write a theme Report | `memon-write-report` | Markdown by default; explicit HTML/interactive/dashboard requests use a static bundle, optionally with a delegated visualization/frontend skill |
| Author a registered fenced-block component | `memon-author-components` | Nothing of its own; it shapes blocks inside the calling skill's document |
| Write a human code-review guide | `memon-write-code-review` | Project/Experiment code-review doc; optional Implementation link through writer |
| Brainstorm next research work | `memon-propose` | Read-only, Experiment/Variant layer only |
| Upgrade the FS convention | `memon-migrate-fs` | Staged migration + final FS marker; explicit user invocation only |

`memon-append-warning`, `memon-append-journal`, `memon-digest-journal`,
`memon-update-journal`, `memon-doctor`, and `memon-notify` have been removed and
nothing replaces them. There is no periodic summary, no Journal-synthesis pass,
and no cursor for a skill to advance. The legacy warning CLI remains only as a
deprecated compatibility entry that prints a notice on every invocation;
official skills maintain `Warnings` through `memon-write-experiment-doc`.

`retired-skills.json` beside these directories records every `memon-*` name the
harness used to ship and no longer does, with the digest of each file tree
released under that name. `memon install-skills` deletes an installed directory
for a retired name only when its tree matches one of those digests; a locally
edited copy is preserved and reported as `kept-modified`, and a `memon-*`
directory the harness never shipped is preserved as `kept-unmanaged`. Use
`--dry-run --format json` to see the decision per directory.

## Layering

`memon-drive` coordinates; launcher/execution skills own execution;
`memon-write-experiment-doc` supplies the shared bundle-writing workflow.
Follow that workflow inline or delegate only when the work benefits.

Reading has layers too. `memon-propose` reads the Experiment/Variant layer only
— documents and eligibility-aware Results projections, never a Run record, log,
or artifact, and never a call that hydrates Runs for it. A gap at that layer is
reported upward for recovery, not filled by descending. `memon-drive` and
`memon-write-report` open a Run record only for a specific question, not as
routine context; `memon-run-experiment` is the skill that works at execution
level.

The canonical Experiment contract — layout, schemas, statuses, run-list
semantics, routing — lives in
`memon-write-experiment-doc/references/experiment-bundle.md`. Caller skills
invoke the writer instead of duplicating it.

## Run records

New Runs require only `id`, `status`, `created_at` and useful execution facts;
the body is optional and free-form. `run record` records an existing directory,
never launches or overwrites it. `experiment link` binds both sides; later
metadata edits use mtime/hash locks. Preserve rich legacy records without
restructuring their content.

`run deprecate` / `undeprecate` changes evidence eligibility, not Variant
membership, execution status or archive. Keep deprecated Runs associated with
their Variant; execution work may explicitly reuse their still-correct scripts
and setup to rerun it. Current research collections exclude them by default.
Results preserve old values and qualify withdrawn evidence. Historical
membership must not permanently invalidate genuinely new results; the current
projection's lineage limitation is documented in `PREFLIGHT.md`.

## Journal recording

CLI mutators record themselves. Submit direct managed-document edits once per
batch under the scope and failure rules in `PREFLIGHT.md`; never manipulate the
Journal or synthesize research from it.

## Report and wiki forms

```text
docs/reports/R0001-topic.md              docs/wiki/finding/W0001-topic.md

docs/reports/R0002-interactive-topic/    docs/wiki/showcase/W0006-interactive-topic/
├── README.md                            ├── README.md
├── data/*.json                          ├── data/*.json
└── views/<slug>/index.html + assets     └── views/<slug>/index.html + assets
```

Markdown is the default; explicit HTML/interactive requests use a static bundle.
The Report writer retains document/data ownership when delegating a view.
See `memon-write-report/references/html-report-bundle.md` for embedding,
security, responsive layout and verification requirements.

The wiki is the durable knowledge layer beside the Reports: one directory per
kind — `meeting`, `roadmap`, `finding`, `bottleneck`, `showcase`, `question`,
`decision`, `note`, `harness-feedback`. `memon wiki` allocates every id, path,
and slug; pages cite Experiments, Variants, and runs in `sources` so staleness
and backlinks derive themselves; `memon wiki commit` isolates each wiki change,
and a human — never an agent — records verification. A Report moves into the
wiki only when the user names one.

## Invocation policy

`memon-migrate-fs` carries `disable-model-invocation: true`; the user must
invoke it explicitly because it may rewrite the full project convention and
create a migration commit.

All other skills may be selected autonomously when their description matches,
and still obey their own confirmation boundaries. In particular, `memon-drive`
reads the user's tone to decide whether a proposed Variant table needs explicit
approval, but always writes Variants before launching Runs.

## Shared conventions

- Skill instructions are English; user-facing conversation is Chinese unless the
  user prefers another language.
- No filesystem watchers; use polling/recurring wakeups. ISO8601 timestamps with
  offsets.

Read `PREFLIGHT.md` for shared safety/lint/Journal protocols and the owning
skill's reference for exact document contracts. Use CLI help for command options
rather than treating this index as a second API reference.
