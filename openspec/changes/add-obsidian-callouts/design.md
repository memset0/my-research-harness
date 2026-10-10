## Context

The shared ReactMarkdown pipeline supports GFM, math, raw HTML, artifact links, component fences, translation segmentation, and source-line review tint. Core wiki parsing already recognizes deprecated markers but mistakes folding suffixes for reasons.

## Goals / Non-Goals

**Goals:** Extend the existing tree pipeline without source rewriting or new dependencies. Preserve local offsets and ordinary document behavior.

**Non-Goals:** Obsidian vault links/embeds, user-defined CSS snippets, research-document conversion, and unrelated legacy section-decoration gaps.

## Decisions

- Transform only Markdown blockquotes beginning with a literal callout marker. Keep inline title/body nodes instead of constructing HTML strings; code and escaped examples stay untouched.
- Use native details/summary for disclosure and a div for static callouts. Native keyboard behavior avoids bespoke interaction state or a primitive fork. Scope visual styles to callouts and use existing theme tokens.
- Apply the same transform before client/server translation segmentation so generated title/body positions yield matching segment IDs. Existing downstream link and component renderers handle descendants.
- Extend core marker recognition only for case-insensitive names and optional folding suffixes. Retain reason/date and section association semantics.
- Validate through focused renderer/core/translation tests and an isolated neutral preview with real browser disclosure checks, light/dark and narrow layouts.

## Risks / Trade-offs

- Tree changes can affect source highlighting and translation identity → preserve source positions and verify both pipelines.
- Native disclosure hides descendants including headings → keep the title visible and verify quoted boundaries; no document content is rewritten.
- Production output may be in use → build a separate release directory and switch only after verification; retain the prior host for rollback.

## Migration Plan

No filesystem migration. Publish the verified central release under the repository release rules; keep this change active. Roll back by restoring the prior release launcher if post-deployment validation fails.
