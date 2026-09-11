## Why

Ordinary Markdown task lists cannot distinguish Agent completion from human awareness and human review, and long item descriptions obscure the checklist. A registered recursive YAML checklist will make those independent states visible without letting Agent completion imply human approval.

## What Changes

- Add `checklist@1` with titled recursive items, optional content and children, and independent `agent_completed`, `human_acknowledged`, and `human_reviewed` booleans, defaulting to false.
- Show bold hierarchical numbering and keep each item's content collapsed until the reader expands it. Child items remain visible independently of content expansion.
- Let an authenticated owner toggle individual states on Wiki reading surfaces using the existing optimistic-locked page write; other Markdown surfaces remain read-only unless they have a document write context.
- Preserve the human boundary: Agents may change completion after finishing work, but may change either human state only on explicit user instruction. Human flags do not mark Wiki commits reviewed and no state cascades to another flag or item.
- Publish authoritative authoring instructions, examples, and invalid examples through the existing component registry; provide neutral rendered fixtures and focused verification.

## Capabilities

### New Capabilities

- `wiki-checklist-component`: Recursive YAML checklist syntax, independent state semantics, rendering, safe Wiki interaction, and authoring authority.

### Modified Capabilities

None. Existing component registration, shared Markdown rendering, and Wiki optimistic locking are reused without changing their contracts.

## Impact

- Central Web component descriptor/renderer registry and shared Markdown source metadata.
- Wiki full-page and side-pane document rendering, reusing `putWikiPage` and query invalidation; no new storage or API endpoint.
- Component fixtures and focused parser, rewrite, rendering, and write-conflict checks.
- No filesystem convention, CLI artifact, managed skill, or page-level review format changes. Component-specific Agent instructions live in the authoritative registry manual.
