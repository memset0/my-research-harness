---
name: memon-wiki
description: Maintain current project knowledge, ongoing comparisons and navigation in Markdown or HTML; use Reports for time-scoped analyses and history.
---

# Wiki

Read `../PREFLIGHT.md`, the page's standing instructions and the shared
[maintenance contract](references/maintenance.md). Wiki is maintained current
knowledge: protocols, ongoing ablations, current interpretations and navigation.
Revise relevant views when evidence or direction changes; completing a Run alone
requires no Wiki edit. Readers should understand the current answer and its limits.

Use `memon --project-root . wiki create --help` for allocation; read the selected
kind in [page-kinds.md](references/page-kinds.md). Edit Markdown/frontmatter
directly, inspect with `show <W-id>`, and publish with `refresh`. Preserve existing
language and scope; new pages follow the user's preference, otherwise English.
Standing maintenance rules belong in their existing compact section.

Choose Markdown, full HTML artifacts or a service view to suit the explanation.
Use the agent's own website-building capabilities; no fixed layout, component
conversion or duplicate Markdown report. Components are optional conveniences.
New pages are bundles; for static HTML read [html-bundle.md](references/html-bundle.md).
Agents own regeneration and service startup; memon supplies access, not scheduling.

Move time-scoped analyses and retired narratives into Reports within the agreed
scope, preserving references and leaving a useful Wiki link. A brief historical
turn may remain as a collapsed callout; do not grow a second archive in the Wiki:

```markdown
> [!DEPRECATED]- Previous interpretation
> Why it changed, with a link to the evidence.
```

Distinguish incorrect measurements, limited precision and superseded methods;
retired evidence may remain useful. Preserve historical citations. Check changed
links, syntax and rendered output. Wiki has no Git/human-review gate or ledger.
