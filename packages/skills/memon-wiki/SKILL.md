---
name: memon-wiki
description: Maintain human-readable project knowledge and HTML artifacts when findings, explanations or research direction change.
---

# Wiki

Read `../PREFLIGHT.md` and the page's standing instructions. Update the current
explanation when understanding changes; routine Run completion does not require
a Wiki edit. Keep a contextual summary, evidence links and meaningful limits.
Do not duplicate full result tables or turn execution history into prose.

Use `memon --project-root . wiki --help` for creation and editing, and
`wiki kinds show <kind>` for the selected kind's fields. Preserve existing
language and scope; new pages follow the user's preference, otherwise English.
Standing maintenance rules belong in their existing compact section.

Choose Markdown, diagrams, components or HTML to suit the explanation.
For HTML/assets read [html-bundle.md](references/html-bundle.md); use
`memon-components` only for its component syntax. Reports can live directly in
Wiki; no separate deliverable registry or mandatory template is needed.

Replace outdated main text. Retain important historical turns with a collapsed
callout when useful:

```markdown
> [!DEPRECATED]- Previous interpretation
> Why it changed, with a link to the evidence.
```

Distinguish incorrect measurements, limited precision and superseded methods;
retired evidence may remain useful. Preserve historical citations. Check changed
links, syntax and rendered output. Wiki has no Git/human-review gate or ledger.
