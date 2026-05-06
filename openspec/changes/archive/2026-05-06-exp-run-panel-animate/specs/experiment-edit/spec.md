## ADDED Requirements

### Requirement: Run panel expand/collapse is animated

The run panels on the v3 exp detail page SHALL animate their
height between collapsed and expanded states (instead of snapping
instantly). The animation SHALL be implemented via shadcn's
`<Collapsible>` (Radix-based) primitive paired with
`tw-animate-css`'s `animate-collapsible-down` and
`animate-collapsible-up` keyframes — keyed on the Radix-supplied
CSS variable `--radix-collapsible-content-height` so the
animation interpolates between `0` and the natural content height
(no fixed-height assumption).

The animating element SHALL carry `overflow-hidden` so the inner
content is clipped to the animating box during the height
transition (without it, the rich panel content — including the
LogViewer's sticky header and the file tree — visibly bleeds past
the panel during the transition).

The animation SHALL preserve all existing state plumbing:
- The controlled `open` state (`useState`).
- The localStorage persistence under
  `memon:exp-page:<expId>:<runId>:open` (writes on user click,
  reads on mount).
- The auto-expand behavior when the URL has
  `?run=<this-run-id>`.

The trigger element (the row containing the status pill, the
monospace run id, and the right-aligned timestamp / host) SHALL
keep its current visual layout and click-through behavior.

#### Scenario: Collapsed → expanded animates height
- **WHEN** the user clicks a collapsed run-panel trigger row
- **THEN** the panel's content area animates from height 0 to its
  natural height over the tw-animate-css `collapsible-down`
  keyframe duration (~200 ms by default)
- **AND** during the animation, content is clipped via
  `overflow-hidden` so it doesn't visually escape the panel box

#### Scenario: Expanded → collapsed animates height
- **WHEN** the user clicks an expanded run-panel trigger row
- **THEN** the panel's content area animates from its natural
  height back to 0 over the `collapsible-up` keyframe duration

#### Scenario: localStorage persistence is unchanged
- **GIVEN** a user previously expanded a panel for run
  `bar-260501-100000`
- **WHEN** the page reloads
- **THEN** the panel re-expands (animated) and the
  `memon:exp-page:<exp>:bar-260501-100000:open` localStorage entry
  is `1`

#### Scenario: ?run=<id> auto-expands the matching panel
- **GIVEN** the user navigates to
  `/p/<project>/e/<exp>?run=<some-run-id>`
- **WHEN** the page mounts
- **THEN** the panel for that run animates open (no longer starts
  open without animation)
