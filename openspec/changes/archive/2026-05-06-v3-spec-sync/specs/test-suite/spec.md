## ADDED Requirements

### Requirement: v3 read-flow integration tests against mock fixtures

The web app SHALL include integration tests that drive the v3 read flow
end-to-end against the existing `mock/project-{a,b}` fixtures. Both
CLI and HTTP surfaces SHALL be exercised:

- CLI: `memon list` (run dirs), `memon show <run-id>`,
  `memon experiment ls`, `memon experiment show <exp-id-or-slug>`
- Web GET: `/api/experiments`, `/api/experiments/:id`,
  `/api/experiments/:id/warnings`, `/api/runs`, `/api/runs/:id`,
  `/api/runs/:id/warnings`, `/api/anomalies?project=…`

The tests SHALL invoke the API route handlers directly (no live
server), to avoid coupling the integration suite to a port-bound
server. The mock fixtures SHALL NOT be mutated by the test run.

#### Scenario: Exp doc list returns effective times
- **WHEN** the integration test invokes `GET /api/experiments?project=project-a`
  via the route handler
- **THEN** the response is 200 with at least one exp doc, and every
  entry includes `effectiveCreatedAt` + `effectiveUpdatedAt`
  computed from member-run times (both fields are non-empty ISO8601)

#### Scenario: Anomaly endpoint surfaces slug-uniqueness anomalies
- **GIVEN** the mock fixture intentionally contains two exp docs whose
  slugs collide on prefix (e.g. `fsdp` and `fsdp-collective`)
- **WHEN** the integration test invokes `GET /api/anomalies?project=project-a`
- **THEN** the response includes at least one `EXPERIMENT_SLUG_PREFIX_COLLISION`
  record naming both exp doc ids

#### Scenario: CLI experiment show is bidirectional with HTTP detail
- **WHEN** the integration test runs `memon experiment show <exp-id>
  --format json` and parses the result; then runs the same against
  `GET /api/experiments/<exp-id>`
- **THEN** the two responses agree on `id`, `frontMatter.runs`,
  `sections.motivation`, and `effectiveCreatedAt`
  (the HTTP response carries extra fields like `memberRuns[]` not
  present in the CLI; the CLI is a strict subset)

### Requirement: v2→v3 migration regression test

The core package SHALL include a snapshot regression test that walks
the v2-to-v3 migration recipe (`packages/core/migrations/v2-to-v3.md`)
against a hand-written v2 fixture and asserts byte-for-byte equality
with the post-migration `mock/project-a/` layout (modulo timestamps
and ordering-equivalent diffs).

The fixture SHALL live at `packages/core/test-fixtures/v2-mock/` and
SHALL be a literal v2 layout (run dirs with v2 frontmatter shape, no
`docs/experiments/` directory, hypotheses with `Experiments:` carrying
run-dir names).

#### Scenario: Migration produces stable v3 output
- **GIVEN** the v2 fixture under `test-fixtures/v2-mock/`
- **WHEN** the test programmatically applies each step from
  `v2-to-v3.md` (in order) to a temp copy
- **THEN** the resulting tree's file set, frontmatter shapes, body
  sections, and warnings tables match `mock/project-a/` byte-for-byte;
  any line-level diff fails the test with a unified diff hint

#### Scenario: Migration is idempotent
- **WHEN** the test re-applies the migration recipe to the
  already-migrated tree
- **THEN** no files change; the recipe SHALL detect "already at v3"
  via `.memon/version.json` and exit cleanly

### Requirement: Browser-level UI regression coverage

The web app SHALL include browser-grade regression tests for v3 UI
flows that vitest + jsdom cannot exercise truthfully. The tests MAY
use Playwright (preferred for genuine browser flows) or vitest +
@testing-library/react when the flow is purely component-state.
The decision per scenario is captured in the implementation tasks.

#### Scenario: Project list grid renders v3 exp docs
- **GIVEN** `mock/project-a` is configured
- **WHEN** the user navigates to `/p/project-a`
- **THEN** the list grid renders one card per v3 exp doc, each card
  showing the exp id, title, run count, and one StatusPill aggregating
  the status of member runs

#### Scenario: Anomaly banner copy-all writes the structured payload
- **GIVEN** `/api/anomalies?project=project-a` returns ≥1 record
- **WHEN** the user clicks the banner's `Copy all` button
- **THEN** the clipboard contains a structured text payload listing
  each anomaly with code, project, runId, experimentId, message, and
  detectedAt; a toast confirms the copy

#### Scenario: Run-panel expand persists across reload
- **GIVEN** the user is on `/p/project-a/e/<exp-id>` with all run
  panels closed
- **WHEN** the user expands one panel and refreshes the page
- **THEN** the same panel is open after reload (state persisted in
  `localStorage` keyed on `memon:exp-page:<exp>:<run>:open`)

#### Scenario: /r/<run-id> redirects to /e/<exp>?run=<run-id>
- **GIVEN** a run dir `foo-260501-100000` bound to exp `E0001-foo`
- **WHEN** the user navigates to `/p/project-a/r/foo-260501-100000`
- **THEN** the response is a 308 redirect to
  `/p/project-a/e/E0001-foo?run=foo-260501-100000`; the destination
  page renders with that run's panel auto-expanded
