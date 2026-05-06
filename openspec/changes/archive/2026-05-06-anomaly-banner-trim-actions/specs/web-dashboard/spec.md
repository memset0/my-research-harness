## MODIFIED Requirements

### Requirement: Anomaly banner pinned at the top of the grid

The list page SHALL render a yellow-bordered card pinned **above** the
experiment-card grid whenever the project has at least one anomaly
(per `experiment-membership-anomalies`). The banner card:
- Header: `⚠ <count> issues need resolution` on the left; a single
  `Copy all` action button anchored to the top-right via shadcn's
  `CardAction` slot.
- Body: scrollable list of anomaly messages (`max-h-[40vh]
  overflow-y-auto`), one line per anomaly with the code, IDs, and
  message.
- `Copy all`: copies a text block with project name, ISO timestamp,
  and one line per anomaly formatted for paste into an agent.

The banner SHALL use the default shadcn Card and CardHeader rhythm —
no custom `py-*` overrides on the header and no `pt-0` on the
content. This keeps its vertical spacing consistent with every other
card on the project list page.

The banner SHALL NOT provide a `Hide` button. There is no
per-session dismissal of anomalies.

When the project has zero anomalies, the banner does not render.

#### Scenario: Banner appears with count
- **GIVEN** the project has 3 anomalies (1 ORPHAN_RUN, 1 PHANTOM_RUN_REF,
  1 MISMATCH_EXPERIMENT_REF)
- **WHEN** the user opens `/p/<project>`
- **THEN** the banner card is rendered above the grid with header text
  `⚠ 3 issues need resolution` and three lines in its body

#### Scenario: Copy all clipboard format
- **WHEN** the user clicks `Copy all` on the banner
- **THEN** the system clipboard contains text starting with `Anomalies
  from project <project> at <ISO time>:` followed by one bullet line
  per anomaly: `- <CODE>: <ids> — <message>`

#### Scenario: Default rhythm and right-anchored action
- **WHEN** the banner renders
- **THEN** its `CardHeader` does NOT carry a `py-3`, `flex-row`, or
  `space-y-0` override class, and its `CardContent` does NOT carry a
  `pt-0` override class
- **AND** the `Copy all` button carries `data-slot="card-action"` so
  the shadcn header grid lays it out in the top-right column
