## ADDED Requirements

### Requirement: Skills create new Reports and Wiki pages only as folders
The Report skill, the Wiki skill and the shared maintenance reference SHALL state that every new Report or Wiki page is a folder (`R<NNNN>-<slug>/` or `W<NNNN>-<slug>/`) holding `README.md` for Markdown or `manifest.json` for HTML and services, SHALL forbid creating new standalone `R<NNNN>-<slug>.md` or `W<NNNN>-<slug>.md` files, and SHALL state that existing standalone documents remain readable and keep their paths.

#### Scenario: Agent writes a Markdown Report
- **WHEN** an agent following the Report skill writes a new Markdown Report
- **THEN** it creates `docs/reports/R<NNNN>-<slug>/README.md`, not `docs/reports/R<NNNN>-<slug>.md`
