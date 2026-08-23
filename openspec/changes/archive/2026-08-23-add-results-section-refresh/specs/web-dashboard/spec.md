## ADDED Requirements

### Requirement: Results can refresh independently with visible snapshot age

Every valid YAML-backed Results card SHALL expose a Refresh action. Activating it SHALL read and normalize the current `results.yaml` through an authenticated, read-only Results snapshot endpoint and SHALL replace only the Results document rendered inside that card. The action SHALL NOT reload or refetch the complete Experiment page, remount unrelated document sections or Run panels, or reset Results table visibility, ordering, filters, pinning, sorting, stars, temporary controls, or other client preferences.

The Results card SHALL show `Last updated` using the server-observed `results.yaml` modification time and `Stale for` using elapsed time since the currently displayed snapshot was read. The stale duration SHALL advance while the page remains open and SHALL reset after each successful refresh. The initial Experiment detail response SHALL provide both timestamps so rendering the status does not require an immediate duplicate Results request.

While refresh is pending, the action SHALL be disabled and visibly indicate progress. A successful response SHALL atomically replace the Results document and timestamps. A missing file, invalid current YAML, authorization failure, network failure, or other non-success response SHALL retain the complete last good Results snapshot and its timestamps, clear the pending state, and show a local understandable error with Refresh still available for retry. The refresh path SHALL NOT modify, clean, or rewrite `results.yaml`.

#### Scenario: Results refresh without disturbing the page

- **GIVEN** an open Experiment page with a valid Results table, expanded Run panel, and configured table preferences
- **AND** `results.yaml` changes on disk
- **WHEN** the user activates the Results Refresh action
- **THEN** only the Results table receives the newly normalized document
- **AND** the expanded Run panel, other document sections, and all Results preferences remain unchanged
- **AND** Last updated reflects the new file mtime and Stale for restarts near zero

#### Scenario: Refresh retains the last good snapshot on invalid YAML

- **GIVEN** the open page displays a valid Results snapshot
- **AND** the current `results.yaml` becomes invalid
- **WHEN** the user activates Refresh
- **THEN** the endpoint returns a validation failure without writing the file
- **AND** the Results card continues to display the previous table and timestamps
- **AND** a local error appears and the Refresh action becomes available for retry

#### Scenario: Initial status does not duplicate the Results request

- **GIVEN** the Experiment detail response contains a valid Results document
- **WHEN** the Results card first renders
- **THEN** it displays the source modification time and current snapshot age from that response
- **AND** it does not call the dedicated Results snapshot endpoint until the user activates Refresh
