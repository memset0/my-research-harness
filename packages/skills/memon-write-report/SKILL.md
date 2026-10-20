---
name: memon-write-report
description: Write a standalone research report when the user requests one, using Markdown, HTML or an interactive presentation appropriate to the question. Durable project explanations normally belong directly in the Wiki.
---

# Write the requested report

Read `../PREFLIGHT.md`. Start from the research question and evidence, then
choose an expression that makes the result understandable. Use original logs,
Run results, saved Variant tables and code as needed; there is no artificial
restriction on which evidence layer an agent can inspect. Separate measured
facts, interpretation and remaining uncertainty. Explain exclusions and limited
precision; a retired direction is not automatically invalid evidence.

For an existing report, preserve its path and useful references. New standalone
reports use `docs/reports/R<NNNN>-<slug>.md` or a same-named directory with
`README.md`, data and views. Allocate an unused ID. Use the repository's existing
frontmatter and timezone-bearing dates. For static HTML read
[references/html-report-bundle.md](references/html-report-bundle.md); the
container does not prescribe a framework, visual language or analytical method.
A saved report and a running monitor have different lifetimes; describe which
one is being delivered.

Keep a short contextual summary and link to evidence or an interactive view.
Do not duplicate complete result tables across reports and Wiki pages. When a
report is really the project's maintained explanation, put it directly in the
Wiki through `memon-wiki` unless the user asked for a standalone report.

Verify numerical claims against the actual source and inspect rendered output.
For interactive HTML, exercise the important controls and narrow-screen layout.
Keep source data, generation scripts and private information within the user's
authorized destination. No mandatory coordination roles, delegated agents or
human-review status are needed.
