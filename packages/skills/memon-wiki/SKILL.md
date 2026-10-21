---
name: memon-wiki
description: Maintain current project knowledge and navigation as Markdown, HTML artifacts or live applications; use Reports for time-scoped analysis.
---

# Wiki

Read `../PREFLIGHT.md` and the shared [maintenance contract](references/maintenance.md).
Wiki explains what is current: protocols, ongoing comparisons, interpretations
and navigation. Revise when knowledge or direction changes, not after every Run.

Create a folder with `wiki create <category> <slug> --title "…"`, or author the
folder directly. Keep the prose as small as the question allows. No required
H2 template, inferred research status, duplicated narrative or review ledger.
Use `show <W-id>` to inspect. After authoring or editing a folder directly, run
`refresh` as described under Published index in the preflight.

Choose README Markdown, a freely built HTML artifact, or a live application.
Use the agent's own visual/web capabilities; components are optional conveniences.
For HTML/services read [html-bundle.md](references/html-bundle.md). memon serves
files or forwards a declared port; agents own generation and service lifecycle.

The user decides whether retired Wiki material becomes a Report or is deleted.
Before `wiki delete <W-id>`, repair inbound references and preserve useful assets.
The command refuses deletion while references remain and reports their locations;
fix them and retry. Do not add an alias or archive unless it serves the user's need.

Keep incorrect measurements distinct from limited precision, superseded methods
and retired directions. Check links and actual rendering; return the useful URL.
