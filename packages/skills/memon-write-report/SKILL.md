---
name: memon-write-report
description: Author or update a theme-driven memon Report from Experiment Results/Findings, hypotheses, wiki knowledge, and other current project evidence. Default to a single Markdown file; only when the user explicitly requests HTML, an interactive presentation, or a dashboard, create a framework-agnostic static Report bundle and optionally coordinate an installed visualization or frontend skill.
---

# memon-write-report

Write an on-demand narrative Report. Reports are theme-keyed and may cover
overlapping or discontinuous evidence. A Report exists because a user asked for
one — never on a schedule, a periodic trigger, or an automatic synthesis pass.

## Preflight

Follow `../PREFLIGHT.md` — FS-version check, deprecated Runs, document trust,
secrets, Journal, CLI issue handoff.

## Choose the representation

```text
docs/reports/R0001-theme.md             # ordinary Markdown Report

docs/reports/R0002-interactive-theme/   # static HTML-capable bundle
├── README.md
├── data/metrics.json
└── views/training-curves/
    ├── index.html
    └── assets/
```

- Default to the single `.md` form.
- Use a directory bundle only when the user explicitly asks for HTML, an
  interactive presentation/visualization, or a dashboard.
- Keep an existing Report in its current form: never migrate a `.md` Report
  implicitly, never force an old HTML bundle into the new layout.
- One skill owns both forms.

IDs are global across files and directories. Scan `R<NNNN>-*`, allocate the next
zero-padded ID, and use a lowercase kebab-case slug.

Before creating or changing an HTML bundle, read
[references/html-report-bundle.md](references/html-report-bundle.md) in full —
the ownership, delegation, runtime, responsive-design, and validation contract.

## Evidence and frontmatter

Work from Experiment-level evidence: Experiment README prose, the bundle YAML
files, `experiment.json` and the generated Results table
(`memon experiment results table`), hypotheses, wiki pages when that surface
exists, existing Reports, and code-review docs. Cite stable Experiment,
Investigation, Variant, and Run IDs, and distinguish a Variant's evidence `runs`
from its other Runs (`attempts` in the table output).

Open a Run record, log, or artifact only when the theme is genuinely about that
execution and the Experiment documents do not carry the fact. Routine scraping
of Run documents to assemble a narrative is not this skill's job — an
Experiment-level gap is reported, not backfilled from logs.

Never present withdrawn evidence as current: a deprecated Run is not a source,
its values never reach the Results table, and frozen, mixed or plan-differing
cells are reported with their label (`../PREFLIGHT.md`). Read results through
the table, never from a Run's `result.csv` or the generated summaries under
`.memon/index/`. Journal history is not evidence.

The `.md` file or bundle `README.md` carries:

```yaml
---
id: R0002
title: BF16 convergence analysis
created_at: 2026-08-10T10:00:00+00:00
updated_at: 2026-08-10T10:00:00+00:00
selector: |
  memon --project-root . experiment results table E0007-bf16-numerics \
    --output json
---
```

Use `selector` when a rerunnable query over current documents helps a reader
reproduce the evidence set; it may be broader than the cited sources. An
existing Report whose `selector` is an old `journal read` query keeps that text
verbatim as provenance — do not execute it and do not write a new Journal
selector. Preserve `created_at`; bump `updated_at`.

## Markdown workflow

1. Agree on theme and scope.
2. Gather evidence; verify IDs and links.
3. Draft a clear narrative, normally 200–500 words unless the user wants depth,
   separating facts, interpretation, and uncertainty.
4. Show the draft when collaborating, then write
   `docs/reports/R<NNNN>-<slug>.md`.
5. On later updates, stay coherent with prior claims or explain the correction,
   and bump `updated_at`.

## HTML bundle workflow

Only after the user explicitly chose an HTML-capable form:

1. Allocate the Report directory and each unique `views/<slug>/`.
2. Own frontmatter, narrative `README.md`, evidence extraction, normalized JSON
   under `data/`, iframe embeds, and final verification.
3. Author the view directly or invoke an installed visualization/frontend skill
   when useful.
4. Give a delegated skill exactly one writable `views/<slug>/` and read-only
   data inputs — never root `README.md`, frontmatter, `data/`, or another view.
   Inspect its output before integration.
5. Require a service-ready static entry point, normally
   `views/<slug>/index.html`. A framework is fine; a dev server is not a runtime
   dependency.
6. Add the embed and record framework/library, delegated skill (or `none`), data
   inputs, and the essential regeneration command in the root `README.md`.
7. Validate through the web app's Report asset route at 390 px and a
   representative desktop width, then deliver.

If a preferred external skill is unavailable or fails, choose another tool or
author plain static HTML/CSS/JS. An explicit HTML request ends in an HTML bundle
or a clear blocker — never a silent downgrade to Markdown.

## Embedding and trust

In bundle `README.md`, an image-form local `.html` reference embeds an iframe;
a normal Markdown link stays a link:

```markdown
![Training curves](./views/training-curves/index.html)
```

Agent-authored Report HTML is trusted, same-origin content: the iframe is not
sandboxed and JavaScript/CDN access is allowed, so do not claim isolation.
Enforce Report-directory containment, exclude secrets, and review third-party
dependencies. Do not introduce a bundle manifest or an iframe auto-height
protocol.

## Validation

For both forms: parse frontmatter, check ID/path consistency, rerun a
document-based `selector` when one exists, verify cited IDs and local links, and
check timestamps. For HTML bundles, additionally apply the reference checklist —
static serving, relative URLs and JSON loading, MIME/error states, per-view
write containment, provenance notes, iframe embedding, responsive layout and
touch operation at 390 px and desktop.

## Guardrails

- Never choose HTML based only on Agent or delegated-skill preference, and never
  let delegation move Report-level ownership off this writer.
- Never read, write, or summarize a Journal file; no such workflow exists.
- Never run `journal submit` for a Report path — `docs/reports/**` is outside
  its scope and would fail the batch.
- Never copy a large Results matrix into prose when stable IDs or structured
  data can be cited or loaded.
- Never cite a deprecated Run, or a `partial`/`unavailable` metric, as current
  evidence.
- Never inline secrets or private environment values, and never let a local
  path escape the Report bundle.
