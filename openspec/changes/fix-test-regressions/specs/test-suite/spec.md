## MODIFIED Requirements

### Requirement: Component test coverage for stateful UI components

The web app SHALL include vitest + RTL component tests for the user-facing stateful components: `ReadmeEditor` (load / debounced draft / save / 409 conflict / recovery prompt), `LogViewer` (search / follow / line selection / SSE append), `AppSidebar` (collapse + localStorage persistence) and `StatusEdit` (PATCH success + 409 conflict). Display-heavy components such as the Experiment results table SHALL be covered by render tests; their interaction logic SHALL be tested in the pure modules behind them rather than by simulating pointer sequences.

#### Scenario: ReadmeEditor 409 conflict path tested
- **WHEN** the test mocks `PUT /api/readme` to return 409 with current content
- **THEN** the editor transitions to diff view; clicking "Keep mine" re-issues PUT with the new mtime; clicking "Discard mine" replaces editor content with disk content

#### Scenario: AppSidebar persistence tested
- **WHEN** the test toggles a project group expansion and reads `localStorage.getItem('memon:sidebar:expanded')`
- **THEN** the stored JSON array reflects the toggle; reloading restores the same expansion state

#### Scenario: Results table renders
- **WHEN** the results table test renders a representative Experiment results payload
- **THEN** it asserts the rendered columns and rows without simulating menus, tooltips or typing

### Requirement: Backend route integration tests against real fixtures

The web app SHALL include integration tests for the API route handlers (`/api/experiments`, `/api/runs`, `/api/readme`, `/api/log`, `/api/log/stream`) loaded against the existing `mock/` fixtures. Both success and error paths (404 / 403 / 409) SHALL be covered.

#### Scenario: PUT /api/readme 409 mtime conflict tested
- **WHEN** an integration test sends `PUT /api/readme` with `expectedMtime` not matching the current file mtime
- **THEN** the response is 409 with the current `content` + `mtime` in the body and the file on disk is unchanged

#### Scenario: Path-confinement 403 tested
- **WHEN** an integration test sends `PUT /api/readme` for a path outside any configured project root
- **THEN** the response is 403 and the file outside the root is unchanged

## REMOVED Requirements

### Requirement: v3 read-flow integration tests against mock fixtures
**Reason**: The CLI read commands it named were retired; the read flow is covered through the HTTP route handlers only.
**Migration**: Replaced by "Read-flow integration tests against mock fixtures".

### Requirement: Browser-level UI regression coverage
**Reason**: It required run counts, an anomaly copy-all banner and persisted run-panel state that the current UI no longer has.
**Migration**: Replaced by "Component-state regression coverage".

## ADDED Requirements

### Requirement: Read-flow integration tests against mock fixtures

The web app SHALL include integration tests that drive the read flow end-to-end against the existing `mock/project-{a,b}` fixtures through the HTTP route handlers: `/api/experiments`, `/api/experiments/:id`, `/api/experiments/:id/warnings`, `/api/runs`, `/api/runs/:id`, `/api/runs/:id/warnings` and `/api/anomalies?project=…`. The tests SHALL invoke the route handlers directly (no live server) and SHALL NOT mutate the mock fixtures.

#### Scenario: Exp doc list returns effective times
- **WHEN** the integration test invokes `GET /api/experiments?project=project-a` via the route handler
- **THEN** the response is 200 with at least one exp doc, and every entry includes `effectiveCreatedAt` + `effectiveUpdatedAt` (both non-empty ISO8601)

#### Scenario: Unknown Experiment is not found
- **WHEN** the integration test requests an Experiment ID that does not exist
- **THEN** the response is 404

#### Scenario: Anomaly endpoint returns structured records
- **WHEN** the integration test invokes `GET /api/anomalies?project=project-a`
- **THEN** the response is a structured array of anomaly records

### Requirement: Component-state regression coverage

The web app SHALL include regression tests for UI flows that are purely component state, using vitest + @testing-library/react.

#### Scenario: Project list grid renders exp docs
- **GIVEN** `mock/project-a` is configured
- **WHEN** the list grid renders the Project's Experiments
- **THEN** it renders one card per Experiment showing its short ID (the full ID in its accessible name), title and status

#### Scenario: /r/<run-id> redirects to /e/<exp>?run=<run-id>
- **GIVEN** a Run `foo-260501-100000` owned by Experiment `E0001-foo`
- **WHEN** the user navigates to `/p/project-a/r/foo-260501-100000`
- **THEN** the response redirects to `/p/project-a/e/E0001-foo?run=foo-260501-100000`

### Requirement: Unit tests avoid heavy external processes
Unit tests SHALL NOT clone repositories, install or build packages, spawn additional Node or tsx processes, or build Go binaries. Behaviour that depends on such processes SHALL be tested through its in-process logic with the external step stubbed. Creating a temporary Git repository in process to test code that reads Git remains allowed.

#### Scenario: No subprocess-heavy unit tests
- **WHEN** the unit suites are searched for `git clone`, package-manager installs or builds, `process.execPath`/`tsx` child processes or Go builds
- **THEN** no unit test performs them
