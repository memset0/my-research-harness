## ADDED Requirements

### Requirement: Refresh warns about new standalone documents
When a plain `memon refresh` publishes the Wiki and Report catalogs and a previously published catalog of the same kind is readable, it SHALL report a warning for every standalone Markdown Wiki page or Report (a `W<NNNN>-<slug>.md` or `R<NNNN>-<slug>.md` file rather than a folder) whose ID that previous catalog does not contain, naming the folder path to use instead (`<…>/R<NNNN>-<slug>/README.md`). Standalone documents already in the previous catalog, and all documents when no previous catalog exists, SHALL NOT be warned about. These warnings SHALL NOT prevent publication or change the exit status.

#### Scenario: New flat Report
- **GIVEN** a published Report catalog without `R0007`
- **WHEN** the agent adds `docs/reports/R0007-friction.md` and runs `memon refresh`
- **THEN** the refresh publishes and warns that `docs/reports/R0007-friction.md` should be `docs/reports/R0007-friction/README.md`

#### Scenario: Legacy flat Report
- **WHEN** `docs/reports/R0001-old.md` is already in the published catalog
- **THEN** refresh reports no warning for it
