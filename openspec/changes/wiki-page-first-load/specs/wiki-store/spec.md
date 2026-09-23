## ADDED Requirements

### Requirement: Opening one page does not wait on project-wide work

A single-page read (`GET /api/wiki/<id>`) and the projection returned after a page write SHALL derive git review state for the requested page only, never for every page of the wiki. The inventory of Run directories that bare Run citations and `@` Run mentions resolve against SHALL be shared by every wiki projection of a Project (list, single page, write, backlinks): concurrent projections SHALL share one directory walk, and once an inventory exists it SHALL be served immediately while a walk older than a short refresh age runs in the background. Failure of a background refresh SHALL keep the last successful inventory. Reads of cited Run metadata SHALL be issued with bounded concurrency, so a projection citing many Runs does not delay the file operations of a concurrent single-page read until all of its own reads finish. The metadata of cited Runs SHALL still be read at request time, so staleness of an already-resolved citation is always current; only whether a newly created or removed Run directory exists may lag by one refresh.

#### Scenario: Page and list requested together
- **GIVEN** a Project with many Run directories and no inventory cached yet
- **WHEN** the page `W0004` and the wiki list are requested concurrently
- **THEN** the Run directories are walked once and both responses use that walk

#### Scenario: Warm page open
- **GIVEN** a Run inventory was built by an earlier wiki request
- **WHEN** `W0004` is requested again
- **THEN** the response is built from the cached inventory without waiting for a new walk
- **AND** an inventory older than the refresh age is refreshed in the background for later requests

#### Scenario: Single page review
- **WHEN** `W0004` is requested from a wiki of 30 pages
- **THEN** git review is derived for `W0004` alone and its `review` field is the same as the list reports for it
