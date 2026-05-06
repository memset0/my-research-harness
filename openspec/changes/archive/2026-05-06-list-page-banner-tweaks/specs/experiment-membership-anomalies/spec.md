## MODIFIED Requirements

### Requirement: Web banner for anomalies

The web list page SHALL render a yellow-bordered card pinned at the top
of the experiment-card grid whenever the project has at least one
anomaly. The card:
- Shows a count summary in its header (`⚠ 3 issues need resolution`)
- Lists each anomaly's message in a scrollable body (`max-h-[20vh]
  overflow-y-auto`)
- Provides a `Copy all` action button anchored to the top-right of the
  card header (via shadcn's `CardAction` slot) that copies the
  anomalies as plain text formatted for paste into an agent prompt

The banner SHALL NOT provide a `Hide` button or any per-session
dismissal affordance. Users resolve anomalies by acting on them (CLI,
linking the run to an exp, etc.), not by hiding the banner.

When the project has zero anomalies, the card SHALL NOT render.

#### Scenario: Empty anomaly state hides banner
- **WHEN** `/api/anomalies?project=foo` returns `[]`
- **THEN** the banner card is not rendered

#### Scenario: Copy all formats anomalies for agent paste
- **WHEN** the user clicks Copy all on a banner showing 2 anomalies
- **THEN** the system clipboard contains a single text block listing
  each anomaly with `code`, the relevant ID(s), and `message`, prefixed
  by a header naming the project and timestamp

#### Scenario: Copy all is the only header action
- **WHEN** the banner renders
- **THEN** the only action button in the card header is `Copy all`,
  rendered with the shadcn `data-slot="card-action"` attribute so it
  occupies the header's right column
