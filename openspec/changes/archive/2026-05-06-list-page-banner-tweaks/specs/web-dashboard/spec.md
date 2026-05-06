## ADDED Requirements

### Requirement: List-page section ordering

The project list page SHALL render its top-level sections in this
fixed top-to-bottom order:

1. The page heading (`<h2>Experiments (<count>)</h2>`).
2. The anomaly banner (when at least one anomaly exists; otherwise
   absent).
3. The experiment-card grid (or its empty-state message).

The heading text and level SHALL NOT change based on whether
anomalies are present — it always reads `Experiments (<count>)` and
always sits at the top.

#### Scenario: Heading sits above the banner
- **GIVEN** a project with at least one anomaly
- **WHEN** the user opens `/p/<project>`
- **THEN** the rendered DOM order under the page wrapper is:
  `<h2>Experiments (N)</h2>` first, then the anomaly banner card,
  then the grid

#### Scenario: Heading still on top when no anomalies
- **GIVEN** a project with zero anomalies
- **WHEN** the user opens `/p/<project>`
- **THEN** the page heading is the first child of the page wrapper
  (the anomaly banner returns null and is not in the DOM at all)

## MODIFIED Requirements

### Requirement: Anomaly banner pinned at the top of the grid

The list page SHALL render a yellow-bordered card pinned **above** the
experiment-card grid whenever the project has at least one anomaly
(per `experiment-membership-anomalies`). The banner card:
- Header: `⚠ <count> issues need resolution` on the left; a single
  `Copy all` action button anchored to the top-right via shadcn's
  `CardAction` slot.
- Body: scrollable list of anomaly messages (`max-h-[20vh]
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

#### Scenario: Scroll-area max-height
- **GIVEN** a project with enough anomalies to overflow the banner
- **WHEN** the banner renders
- **THEN** the scrollable list `<ul>` carries the class
  `max-h-[20vh]` (NOT `max-h-[40vh]` — the historic value)
