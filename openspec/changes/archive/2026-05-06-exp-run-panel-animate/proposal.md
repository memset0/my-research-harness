## Why

The run panels on the v3 exp detail page use a native `<details>` /
`<summary>` pair to gate their content. Native `<details>` snaps
between collapsed and expanded with no transition — on a long page
that contains the rich run panel (frontmatter, action bar, log
viewer, file tree), the snap is jarring and makes it hard to follow
which area changed.

The user wants a smooth expand/collapse animation so the eye can
track the change.

## What Changes

- `RunPanel` SHALL replace the `<details>` / `<summary>` pair with
  shadcn's `<Collapsible>` / `<CollapsibleTrigger>` /
  `<CollapsibleContent>` primitive (Radix-based).
- The `<CollapsibleContent>` SHALL animate its height between `0`
  and the natural content height on `data-state` transitions, using
  `tw-animate-css`'s `animate-collapsible-down` /
  `animate-collapsible-up` keyframes (already in the bundled
  `tw-animate.css`). The animation's overflow SHALL be clipped via
  `overflow-hidden` so the content doesn't bleed past the panel
  during the height transition.
- The existing `open` state machinery (controlled `useState`,
  localStorage persistence under `memon:exp-page:<exp>:<run>:open`,
  `?run=<this>` auto-expand) SHALL be preserved by wiring the
  Collapsible as controlled (`open` + `onOpenChange`).
- The trigger row SHALL keep its current visual: status pill +
  monospace run id + right-aligned `createdAt` and host. No new
  chevron is added — keeping visual continuity with the prior
  `<summary>` row.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `experiment-edit`: extend the run-panel requirement(s) with a
  scenario pinning the animated open/close transition, so a future
  refactor doesn't accidentally drop back to native `<details>`.

## Impact

- `apps/web/components/experiment-page.tsx` — small change inside
  `RunPanel`. Swap `<details>`/`<summary>` for
  `<Collapsible>`/`<CollapsibleTrigger asChild>`/`<CollapsibleContent>`
  with the animation classes. No data-flow change. No prop change.
- No new shadcn install — `components/ui/collapsible.tsx` is already
  in the repo, and `tw-animate-css` already provides the keyframes.
- No backend, API, or data shape changes.
