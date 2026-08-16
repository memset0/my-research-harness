---
name: memon-write-report
description: Author or update a theme-driven memon Report from Journal, Experiment Results/Findings, Runs, digests, and other project evidence. Default to a single Markdown file; only when the user explicitly requests HTML, an interactive presentation, or a dashboard, create a framework-agnostic static Report bundle and optionally coordinate an installed visualization or frontend skill.
---

# memon-write-report

Write an on-demand narrative Report. Reports are cursor-independent and may
cover overlapping or discontinuous evidence. `memon-digest-journal` remains the
only cursor-advancing periodic summary.

## Preflight

Run `memon --project-root . --format json fs-version check` first. Continue only
for `match`; otherwise follow `../PREFLIGHT.md`.

## Memon CLI issue handoff

For every `memon` command used by this skill, follow the CLI issue handoff in
`../PREFLIGHT.md`. After safely finishing the requested task, report any CLI
crash, valid-input rejection, malformed/inconsistent output, or required CLI
workaround; if it blocks completion, report it in the blocked handoff. Do not
mislabel an expected validation or domain-state rejection as a CLI bug.

## Choose the representation

Two forms coexist:

```text
docs/reports/R0001-theme.md             # ordinary Markdown Report

docs/reports/R0002-interactive-theme/   # static HTML-capable bundle
├── README.md
├── data/
│   └── metrics.json
└── views/
    └── training-curves/
        ├── index.html
        └── assets/
```

- Default to the single `.md` form.
- Use a directory bundle only when the user explicitly asks for HTML,
  interactive presentation/visualization, or a dashboard.
- Keep an existing Report in its current form. Never migrate a `.md` Report
  implicitly, and never force an old HTML bundle into the new layout.
- Keep one `memon-write-report` skill responsible for both forms.

IDs are global across files and directories. Scan `R<NNNN>-*`, allocate the
next zero-padded numeric ID, and use a lowercase kebab-case slug.

Before creating or changing an HTML bundle, read
[references/html-report-bundle.md](references/html-report-bundle.md) in full.
It is the detailed ownership, delegation, runtime, responsive-design, and
validation contract.

## Evidence and frontmatter

Read whatever supports the user's theme: Journal events, Experiment sections,
selected Run READMEs, W&B metadata and artifacts, hypotheses, digests, existing
Reports, and code-review docs. Distinguish selected Variant `runs` from
failed/superseded `attempts`; cite stable Experiment, Investigation, Variant,
and Run IDs.

The `.md` file or bundle `README.md` carries:

```yaml
---
id: R0002
title: BF16 convergence analysis
created_at: 2026-08-10T10:00:00+00:00
updated_at: 2026-08-10T10:00:00+00:00
selector: |
  memon --project-root . journal read --limit 1000 \
    | jq '.events[] | select(.body | contains("bf16"))'
---
```

Use `selector` when a rerunnable Journal query is relevant. It may be broader
than the cited structured sources. Preserve `created_at`, update `updated_at`,
and never advance `last_digest_at`.

## Markdown workflow

1. Agree on the theme and scope.
2. Gather evidence and verify IDs and links.
3. Draft a clear narrative, normally 200–500 words unless the user requests
   depth. Separate facts, interpretation, and uncertainty.
4. Show the draft when collaborating, then write
   `docs/reports/R<NNNN>-<slug>.md`.
5. Update later additions coherently, preserve prior claims or explain
   corrections, and bump `updated_at`.

## HTML bundle workflow

Use this workflow only after the user explicitly selected an HTML-capable form.

1. Allocate the Report directory and each unique `views/<slug>/` directory.
2. Own the Report frontmatter, narrative `README.md`, evidence extraction,
   normalized JSON under `data/`, iframe embeds, and final verification.
3. Choose the most suitable implementation. Author the view directly or
   autonomously invoke an installed visualization/frontend skill when useful.
4. Give a delegated skill only one writable `views/<slug>/` directory and
   read-only data inputs. It must not edit root `README.md`, frontmatter,
   `data/`, or another view. Inspect its output before integration.
5. Require a service-ready static entry point, normally
   `views/<slug>/index.html`. A framework is allowed, but a dev server is not a
   runtime dependency.
6. Add the embed and record the framework/library, delegated skill (or `none`),
   data inputs, and essential regeneration command in the root `README.md`.
7. Validate the bundle through the web app's Report asset route at 390 px and a
   representative desktop width, then deliver it.

If a preferred external skill is unavailable or fails, choose another suitable
tool or author plain static HTML/CSS/JavaScript. An explicit HTML request must
still produce an HTML bundle or end with a clear blocker; never silently
downgrade it to Markdown-only.

## Embedding and trust

In bundle `README.md`, an image-form local `.html` reference embeds an iframe:

```markdown
![Training curves](./views/training-curves/index.html)
```

A normal Markdown link to the same file remains a link. Existing bundle-relative
HTML locations continue to work.

Agent-authored Report HTML remains trusted, same-origin content. The iframe is
not sandboxed, and JavaScript/CDN access remains allowed; do not claim security
isolation. Enforce Report-directory containment, exclude credentials and secret
data, and review third-party dependencies carefully. Do not introduce a bundle
manifest or an iframe auto-height protocol.

## Validation

For both forms, parse frontmatter, check ID/path consistency, rerun relevant
selectors, verify cited IDs/local links, and check timestamps.

For HTML bundles, additionally apply the complete checklist in the reference:
static serving without a dev server, relative URLs and JSON loading, MIME/error
states, per-view write containment, provenance/regeneration notes, iframe
embedding, responsive layout, touch operation, and 390 px plus desktop checks.

## Guardrails

- Never choose HTML based only on Agent or delegated-skill preference.
- Never let delegation transfer Report-level ownership away from this writer.
- Never touch the digest cursor.
- Never copy a large Results matrix into prose when stable IDs/structured data
  can be cited or loaded.
- Never inline secrets or private environment values in Report files.
- Never let a local path escape its Report bundle.
