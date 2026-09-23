## Why

Standing requirements the owner gives agents about a page (how to maintain it, and what agents working through it must or must not do) end up scattered through prose, mixed with dated history, and partly scoped to one agent (for example rules that only bind the Oh My Pi coordinator). Agents miss them, restate them inconsistently, and nothing tells the owner when a requirement was recorded or dropped.

## What Changes

- A page may carry one section with a fixed name, `## Maintenance rules` (Chinese pages: `## 维护规则`), as its last H2. It holds only list items: one dated requirement per item; agent-specific requirements nest under a scope item worded `- Only for <agent>:`.
- Core lint warns `WIKI_MAINTENANCE_RULES_INVALID` when that section contains anything but list items, or when a page has more than one such section.
- The `memon-wiki` skill: every agent reads and follows a page's rules before editing it; the owner can put the agent into maintenance mode for a page, in which every long-term requirement the owner states is recorded automatically (edited or removed when replaced or withdrawn), and after each change the agent tells the owner exactly which items were added, removed or changed.
- Distributed artifacts (CLI lint via core, skills) and central change -> MINOR release together with `wiki-page-language` and `wiki-commit-push`. Moving an existing page's agent-directed prose into the section is project content work, not part of this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-store`: maintenance-rules section name, format, and diagnostic.
- `memon-wiki-skill`: maintenance mode and automatic rule recording with change reports.

## Impact

- `packages/core/src/wiki/{lint,types}.ts` (+ tests); `packages/skills/memon-wiki/SKILL.md`.
