---
name: memon-write-report
description: Author or update a theme-driven memon Report from Journal, Experiment Results/Findings, Runs, digests, and other project evidence. Default to a single Markdown file; only when the user explicitly requests HTML or interactive presentation, create a directory Report bundle with README.md plus local HTML, JSON, JavaScript, CSS, and image assets.
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
docs/reports/R0001-theme.md             # ordinary Markdown report

docs/reports/R0002-interactive-theme/   # HTML-capable bundle
├── README.md
├── charts.html
├── data/
│   └── metrics.json
└── assets/
    ├── charts.js
    ├── report.css
    └── figure.png
```

Rules:

- Default to the single `.md` form.
- Create a directory bundle only when the user explicitly asks for HTML,
  interactive visualization, or an HTML report.
- Updating an existing directory bundle keeps its form; no repeated request is
  needed.
- Never migrate an existing `.md` Report merely because bundle support exists.
- Keep one `memon-write-report` skill for both forms.

IDs are global across both files and directories. Scan `R<NNNN>-*`, take the
maximum numeric ID, and allocate the next zero-padded value. Use lowercase
kebab-case slugs.

## Evidence sources

Read whatever supports the user's theme:

- Journal events and open requests;
- Experiment Motivation/Design/Investigation/Results/Findings/Limitations;
- selected Run READMEs, W&B metadata, and artifacts;
- hypotheses, digests, existing Reports, and code-review docs.

Results are not limited to Journal events. Distinguish selected Variant `runs`
from failed/superseded `attempts`, and cite stable Experiment, Investigation,
Variant, and Run IDs.

## Common frontmatter

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

`selector` is a rerunnable evidence query when Journal selection is relevant.
It may be broader than the final source set; the body cites structured
Experiment/Run sources separately. Preserve `created_at`; update `updated_at`.
Do not advance `last_digest_at`.

## Markdown Report workflow

1. Agree on the theme and scope.
2. Gather evidence and verify IDs/links.
3. Draft a clear narrative, normally 200–500 words unless the user requests
   depth. Separate facts from interpretation and uncertainty.
4. Show the draft when collaborating, then write
   `docs/reports/R<NNNN>-<slug>.md`.
5. For later additions, append/update coherently and bump `updated_at`; preserve
   prior claims or explicitly explain corrections.

## HTML bundle workflow

Use this workflow only under the representation rule above.

1. Put narrative and composition in `README.md`.
2. Put structured display data in JSON rather than embedding large literals in
   HTML/JavaScript.
3. Let HTML fetch bundle-relative JSON and load bundle-relative JS/CSS/images.
4. Local code may use third-party HTTPS CDN scripts/styles when useful.
5. Keep every local path inside the Report directory. Never use `../` to read
   arbitrary project/server files.
6. Make the HTML independently understandable: title, source attribution,
   loading/error states, and readable fallback text.

Example:

```html
<link rel="stylesheet" href="./assets/report.css">
<div id="chart"></div>
<script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
<script type="module">
  const metrics = await fetch('./data/metrics.json').then((r) => r.json())
  // render metrics
</script>
```

### Embed convention

In bundle `README.md`, an image-form Markdown reference whose local target ends
in `.html` is an iframe embed:

```markdown
![Training curves](./charts.html)
```

A normal link remains a link:

```markdown
[Open training curves](./charts.html)
```

Images and other assets keep their ordinary Markdown behavior.

The first version intentionally treats Agent-authored Report HTML as trusted:
the iframe is not sandboxed and JavaScript/CDN access is allowed. Do not claim
security isolation. Still enforce bundle path containment and never include
credentials or secret data. Because same-origin code may access memon APIs and
browser state, generate HTML only on the user's explicit request and review
third-party dependencies carefully.

## Validation

For both forms:

- parse frontmatter and check ID/path consistency;
- rerun selectors where present;
- verify cited Experiment/Variant/Run IDs and local links;
- ensure `created_at` is stable and `updated_at` is current.

For bundles also:

- serve/open each HTML entry through the same Report asset route used by the
  web app, not `file://`;
- verify `fetch()` paths and MIME types;
- test loading without silently depending on a developer's absolute path;
- ensure README uses the `.html` image embed syntax intentionally.

## Guardrails

- Never create an HTML bundle based only on Agent preference.
- Never convert or relocate an existing single Markdown Report implicitly.
- Never touch the digest cursor.
- Never copy a large Results matrix into prose when stable IDs/structured data
  can be cited or loaded.
- Never inline secrets, auth tokens, or private environment values in HTML,
  JSON, JS, CSS, or Markdown.
- Never let a local asset path escape its Report bundle.
