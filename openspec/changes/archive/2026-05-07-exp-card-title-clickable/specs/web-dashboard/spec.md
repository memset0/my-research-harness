## ADDED Requirements

### Requirement: Exp card title navigates to the detail page

The card title SHALL be rendered as a Link that navigates to the exp detail page (`/p/<project>/e/<exp-id>`) — the same URL the existing E-id link points at — so clicking the title text takes the user to the detail page. The title link SHALL carry `hover:underline` for the standard click affordance. The E-id link remains a separate Link so the monospace id keeps its canonical visual treatment.

#### Scenario: Click on title navigates
- **GIVEN** a project with at least one exp doc whose title is `vpred convergence`
- **WHEN** the user clicks anywhere on the rendered title text
- **THEN** the browser navigates to `/p/<project>/e/<exp-id>` (the same URL the E-id link points at)

#### Scenario: Title shows hover affordance
- **WHEN** the user hovers the title text
- **THEN** the text shows the underline affordance (the link is rendered with the `hover:underline` Tailwind utility)
