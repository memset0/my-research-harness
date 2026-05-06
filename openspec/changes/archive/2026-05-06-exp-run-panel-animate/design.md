## Context

`RunPanel` in `experiment-page.tsx` wraps each run inside a
`<details open={open} onToggle={…}>` with a `<summary>` row and
`<RunBody>` underneath. Native `<details>` browsers do not animate
the height transition — Chrome's `interpolate-size: allow-keywords`
helps but isn't universal and Tailwind v4 doesn't have a
two-line utility for it.

The shadcn primitives this project already ships with include
`<Collapsible>` (Radix-based), and `tw-animate-css` (already
imported in `globals.css`) ships the canonical
`animate-collapsible-down` / `animate-collapsible-up` utilities
keyed on Radix's `--radix-collapsible-content-height` CSS variable.

So the implementation is purely structural: swap the host element,
add two utility classes on the content, keep all state plumbing.

## Goals / Non-Goals

**Goals:**
- A smooth height animation on open/close (~200 ms, the
  tw-animate-css default for this keyframe family).
- No regression on:
  - The localStorage-persisted open state.
  - The auto-expand-on-`?run=<this-id>` behavior.
  - The trigger-row visual identity.

**Non-Goals:**
- Don't add a chevron icon — the run row is already visually busy
  (status pill, mono id, timestamp, host) and a chevron's affordance
  is implicit (the whole row is the click target).
- Don't extract a shared "AnimatedDetails" wrapper. The native
  `<details>` is only used in this one place in v3 land; a wrapper
  would be premature.
- Don't animate `opacity` or transform alongside height. Height is
  the dominant change; layering opacity on a panel that already has
  a sticky-header LogViewer can introduce flicker.

## Decisions

**D1. Use the existing `<Collapsible>` primitive, not write a
custom solution.** The shadcn collapsible.tsx is a thin wrapper over
Radix `Root` / `Trigger` / `Content`; Radix handles `aria-expanded`
+ keyboard (Space/Enter) automatically. Custom replacements for any
of these would re-implement what's already there.

**D2. Make the trigger `asChild` over a `<div role="button">`.** The
existing summary row has nested elements (`StatusPill`, spans). The
default Trigger is a `<button>`, which would forbid nested
interactive elements like the StatusPill (button-in-button). Using
`asChild` makes Radix forward the trigger props to a non-button
host while still wiring up keyboard + aria semantics.

**D3. Animation duration uses the tw-animate-css default
(~200 ms).** No custom `animation-duration-NNN` override. The
default is the same value used elsewhere in the dashboard's
shadcn-defaults (Dialog, Sheet, etc.).

**D4. Initial-mount transition.** The first mount syncs `open` to
localStorage via a `useEffect`. If the stored value is `1` (open),
the controlled state flips false→true on mount and the panel
animates open. That's a minor cost; users land on the page and one
panel briefly animating is OK. Suppressing the first transition
with a "ready" flag adds complexity for marginal benefit; defer
unless it causes complaints.

## Risks / Trade-offs

- [Risk] Inside the animating panel, the `LogViewer`'s own scroll /
  layout could glitch during the height transition. → Mitigation:
  `overflow-hidden` on the CollapsibleContent clips visually
  during the keyframe, but the inner LogViewer's box is unaffected
  once the animation completes (height resolves to `auto` after
  `animate-collapsible-down` because Radix updates
  `--radix-collapsible-content-height` to `auto` once measured).
- [Risk] Auto-expand on `?run=…` now animates instead of starting
  expanded. → Mitigation: the auto-expand IS the user's intent;
  seeing the panel open in 200 ms is fine signal that the URL
  parameter took effect.

## Migration Plan

Code-only edit. Restart picks it up.

## Open Questions

None.
