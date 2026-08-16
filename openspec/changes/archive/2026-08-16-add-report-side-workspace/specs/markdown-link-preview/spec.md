## ADDED Requirements

### Requirement: Local artifact links compose with existing Markdown link enhancements

When project and source-document context are available, the shared Markdown renderer SHALL allow resolvable current-project Experiment and Report references to use the artifact navigation behavior defined by `report-workspace`. Artifact recognition SHALL apply both to generated links for bare IDs and to existing Markdown links whose destination resolves to an artifact document.

Artifact recognition SHALL run without changing GitHub line-permalink preview behavior. An href that is not recognized as a current-project artifact or GitHub line permalink SHALL continue to render as an ordinary link with its original destination and native link behavior.

#### Scenario: Artifact link and GitHub preview coexist
- **GIVEN** one Markdown document contains a relative link to a Report and a GitHub blob line-permalink
- **WHEN** the document renders with project and source-document context
- **THEN** the Report link uses artifact navigation
- **AND** the GitHub permalink retains its hover preview

#### Scenario: Unrecognized link keeps its href
- **GIVEN** a Markdown href cannot be resolved to a current-project artifact and is not a GitHub line-permalink
- **WHEN** the document renders
- **THEN** it remains an ordinary link with the original href unchanged
