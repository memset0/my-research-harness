## Context

See proposal.md. The full wiki reader currently scrolls separately from an outline pinned to the far right. WikiDocumentView adds a whole-body quote treatment for UNVERIFIED pages and an inline mobile outline.

## Goals / Non-Goals

Keep the existing rail, editor, review data, actual Markdown blockquotes, and changed-line highlighting intact. No new primitives or theme tokens are needed.

## Decisions

- Place the document and outline in a centered flex group inside the reading scroll surface. Keep the outline sticky with bounded viewport height and its own overflow. Keep the editor outside this group.
- Use a shrinking document column capped at 720px plus the existing 240px outline and a small gap. Apply the document limit to the shared view so side-wiki content also stays readable.
- Remove whole-body visual decoration, not review semantics or the Markdown renderer's changed-block treatment.
- Interpret the user's final typo as mobile: remove inline navigation and keep desktop navigation hidden below md.

## Risks / Trade-offs

- Sticky behavior can regress when changing scroll ancestry → verify desktop scrolling and mobile visibility on the rendered page.
- Narrow desktop panes leave less room for prose → allow the document column to shrink with min-width zero; preserve mobile single-column behavior.

## Validation

Run only the wiki-shell component tests and Web typecheck, then inspect served rendering and generated CSS (prefer a browser screenshot when available). No full-suite run for this focused visual change, following the user's reduced-validation instruction.
