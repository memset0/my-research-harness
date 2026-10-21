## ADDED Requirements

### Requirement: Hypothesis authoring and projection are retired
The CLI SHALL reject retired hypothesis commands/options, omit hypothesis columns and stop loading hypotheses in project scans. New Experiment/Run records SHALL NOT scaffold hypothesis metadata or sections. Existing historical files SHALL not be migrated by deployment or refresh.

#### Scenario: Create current research records
- **WHEN** an agent creates an Experiment and Run
- **THEN** no hypothesis field, registry, template or extra step is introduced
