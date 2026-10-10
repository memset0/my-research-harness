## Why

Markdown currently exposes Obsidian callout markers as plain quotations, so readers cannot fold archived details or distinguish deprecated material. Support callouts in the shared renderer while retaining ordinary Markdown behavior.

## What Changes

- Render standard Obsidian callout types and aliases, case-insensitive identifiers, optional Markdown titles, nested content, and unknown-type fallback.
- Honor `-` as initially collapsed, `+` as initially expanded and foldable, and no suffix as non-foldable.
- Add a distinct custom `DEPRECATED` callout; recommend `> [!DEPRECATED]-` for folded historical content without changing existing documents.
- Keep wiki deprecation detection compatible with folding suffixes and existing reason/date semantics.
- Verify rendering, keyboard disclosure, Markdown regressions, and production styling.

## Capabilities

### New Capabilities
- `markdown-callouts`: Shared Markdown callout presentation and folding behavior.

### Modified Capabilities
- `wiki-store`: Recognize foldable deprecation markers without treating their suffix as a reason.

## Impact

Shared Web Markdown rendering, scoped callout styling, core wiki deprecation parsing, and focused regression tests. No storage migration, new dependency, research-document rewrite, or primitive fork.
