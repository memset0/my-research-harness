## ADDED Requirements

### Requirement: Experiment references accept every discoverable Experiment folder

Every place that validates a single Experiment reference SHALL accept every
folder name Experiment discovery accepts (`E<NNNN>-<slug>` with a slug matching
`[a-z0-9][a-z0-9-]*`), including one-character slugs. Hypothesis
`Experiments:` fields SHALL recognise such references. Creating a new
Experiment SHALL keep its stricter slug rule (at least two characters, not
ending in `-`); that stricter rule SHALL NOT be applied when reading or
resolving existing references.

#### Scenario: Hypothesis references a one-character slug
- **GIVEN** a discovered Experiment folder `docs/experiments/E0003-a/`
- **WHEN** a hypothesis entry declares `**Experiments**: E0003-a`
- **THEN** the parsed entry lists `E0003-a` in its experiments

#### Scenario: Creation keeps the strict slug rule
- **WHEN** `memon experiment create a` is run
- **THEN** the command fails with `BAD_REQUEST` because a new slug needs at
  least two characters
