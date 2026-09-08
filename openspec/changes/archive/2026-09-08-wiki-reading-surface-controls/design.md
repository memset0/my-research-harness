## Context

The current reader paints the entire scroll surface with bg-card and caps both the outer column and nested body at 720px. See proposal.md for the requested refinement.

## Goals / Non-Goals

Keep the sticky outline, mobile outline hiding, editor, review signals, and centered grouping. Do not modify other active changes or introduce persisted preferences.

## Decisions

- Move bg-card onto the document column with modest padding, leaving the scroll surface and outline transparent over the existing page background. Use existing theme tokens rather than hard-coded white.
- Use local React state and a shadcn Button in the top toolbar with aria-pressed and a stable accessible name. Default to 800px; the button displays 800px or Full width.
- Pass the width mode into the shared document renderer so unrestricted mode removes both nested and outer caps. Side-wiki rendering defaults to 800px without adding an unrelated toolbar there.
- Allow the toolbar to wrap on narrow screens so the new control does not hide existing actions.

## Risks / Trade-offs

- A nested Markdown width limit could make the toggle ineffective → assert rendered geometry on a wide desktop viewport.
- White surfaces need visual breathing room → add document padding, without quote borders or rounded quote styling.
- Width choice resets when the reader unmounts; cross-session persistence is outside this request.

## Validation

Run only Wiki component tests, Web typecheck, production build and focused browser checks for colors, width toggling, and mobile fit. Reuse temporary browser tooling; no full suite.
