# test-suite Specification

## Purpose
TBD - created by archiving change add-test-suite. Update Purpose after archive.
## Requirements
### Requirement: Web app vitest + jsdom test infrastructure

The `apps/web` package SHALL provide a runnable vitest test environment configured with `jsdom` + `@testing-library/react`. `pnpm test` at the monorepo root SHALL execute both `packages/core` (already wired) and `apps/web` test suites and report a unified pass/fail.

#### Scenario: Root `pnpm test` runs everything
- **WHEN** `pnpm test` is invoked at the monorepo root
- **THEN** vitest discovers `packages/core/**/*.test.ts` AND `apps/web/**/*.test.tsx?` and reports both suites' results

#### Scenario: A component test imports a shadcn primitive
- **WHEN** an `apps/web/components/*.test.tsx` file imports `Button` from `@/components/ui/button`
- **THEN** the import resolves under jsdom; the rendered DOM is queryable via Testing Library helpers

### Requirement: Component test coverage for stateful UI components

The web app SHALL include vitest + RTL component tests for the user-facing stateful components introduced through `add-memon-mvp` / `add-write-flow` / `add-sidebar-and-log-tools`: `ReadmeEditor` (load / debounced draft / save / 409 conflict / recovery prompt), `LogViewer` (search / follow / line selection / SSE append), `AppSidebar` (collapse + localStorage persistence), `AgentHandoffDialog` (prompt assembly + clipboard toast), `StatusEdit` (PATCH success + 409 conflict), `NewExperimentModal` (name validation + create + collision).

#### Scenario: ReadmeEditor 409 conflict path tested
- **WHEN** the test mocks `PUT /api/readme` to return 409 with current content
- **THEN** the editor transitions to diff view; clicking "Keep mine" re-issues PUT with the new mtime; clicking "Discard mine" replaces editor content with disk content

#### Scenario: AppSidebar persistence tested
- **WHEN** the test toggles a project group expansion and reads `localStorage.getItem('memon:sidebar:expanded')`
- **THEN** the stored JSON array reflects the toggle; reloading restores the same expansion state

### Requirement: Backend route integration tests against real fixtures

The web app SHALL include integration tests for the API route handlers (`/api/experiments`, `/api/hypotheses`, `/api/journal/append`, `/api/readme`, `/api/log`, `/api/log/stream`) loaded against the existing `mock/` fixtures. Both success and error paths (404 / 403 / 409) SHALL be covered.

#### Scenario: PUT /api/readme 409 mtime conflict tested
- **WHEN** an integration test sends `PUT /api/readme` with `expectedMtime` not matching the current file mtime
- **THEN** the response is 409 with the current `content` + `mtime` in the body and the file on disk is unchanged

#### Scenario: Path-confinement 403 tested
- **WHEN** an integration test sends `PUT /api/readme` for a path outside any configured project root
- **THEN** the response is 403 and the file outside the root is unchanged

