---
name: memon-components
description: Author optional memon Markdown components for tables, figures, HTML embeds or checklists.
---

# Components

Read `../PREFLIGHT.md` once. Use components when they help the reader; plain
Markdown and standalone HTML remain valid choices. Read the needed type's
[fields and example](references/catalog.md), not the whole catalog.

Declare a fence as `<language> <type>@<version> [#id]`. Pin the version; IDs use
letters, digits or underscores and are unique within the document. Put options
in the payload, never in the fence header. YAML/JSON payloads are objects;
other languages supply `{data: <body>}`, as in `html embed@1`.

For Python-generated payloads, read [execution.md](references/execution.md).
A cached result is not a live monitor. Do not invent component types or change
the harness from a research project; use an HTML embed when it fits better.

Figures reference local project images/videos with captions. Preserve supplied
media unless modification is requested, and describe its actual content.
Checklist flags are independent: set `agent_completed` for work actually done;
change `human_acknowledged` or `human_reviewed` only with explicit authorization.

Validate relevant syntax and inspect the rendered result, including important
interactions and narrow-screen layout. No mandatory feedback page or draft
approval is needed.
