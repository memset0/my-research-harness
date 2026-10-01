## MODIFIED Requirements

### Requirement: URL redirects from legacy run paths

Legacy run-detail URLs SHALL redirect to the new exp-detail URL with a
`?run=` query param. The route `/p/<project>/r/<run-dir>` (and its v2
form `/p/<project>/experiments/<run-dir>`) SHALL respond with a 308
(or client-side replace) to `/p/<project>/e/<E-id-of-parent>?run=<run-dir>`
when exactly one Experiment declares the run (the parent is derived
from Experiment declarations, never from a Run README field). When no
Experiment declares it, the redirect SHALL go to `/p/<project>`.

#### Scenario: Bound run redirects with run param
- **GIVEN** a run `bar-260501-100000` declared by `E0001-foo`
- **WHEN** the user navigates to `/p/<project>/r/bar-260501-100000`
- **THEN** the URL is rewritten to
  `/p/<project>/e/E0001-foo?run=bar-260501-100000`

#### Scenario: Orphan run redirects to project list
- **GIVEN** a run `solo-260501-100000` that no Experiment declares
- **WHEN** the user navigates to `/p/<project>/r/solo-260501-100000`
- **THEN** the URL is rewritten to `/p/<project>`

## REMOVED Requirements

### Requirement: Orphan run cards in the grid
**Reason**: An unassigned Run is valid in FS v7 and is not an anomaly; the experiment grid lists Experiments only.
**Migration**: Unassigned Runs remain reachable through global Run browsing and can be declared with `memon experiment link`.
