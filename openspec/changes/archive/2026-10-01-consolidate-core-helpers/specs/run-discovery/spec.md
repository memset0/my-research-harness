## ADDED Requirements

### Requirement: Run references accept every discoverable Run name

Every place that validates or classifies a single Run reference SHALL accept
every base name that Run discovery identifies as a Run (any name matching
`^.+-\d{6}-\d{6}$` that contains no `/`). This covers wiki `sources` entries
and `@` references, hypothesis Run lists, Experiment membership slug checks,
journal and CLI target arguments, and the base name of a project-relative
Run path (`logs|outputs|experiments/…/<name>`). Reference validation SHALL
NOT be stricter than discovery. Free-text mention scanning (hypothesis
fields, Report evidence extraction, finding evidence checks) SHALL keep every
token it extracted before and SHALL additionally recognise a whole
whitespace- or comma-delimited token that is a discoverable Run name when the
legacy scanner finds no Run token inside it.

#### Scenario: Wiki source cites a Run name with a dot
- **GIVEN** a discovered Run directory `model.v2-260501-100000`
- **WHEN** a wiki page declares `sources: [model.v2-260501-100000]`
- **THEN** the source is classified as a Run reference and resolves to that
  Run instead of being left unclassified

#### Scenario: Hypothesis Runs list names a non-ASCII Run
- **GIVEN** a discovered Run directory `模型-260501-100000`
- **WHEN** a hypothesis entry declares `**Runs**: 模型-260501-100000`
- **THEN** the parsed entry lists `模型-260501-100000` in its Runs

#### Scenario: Previously extracted mentions are unchanged
- **GIVEN** a hypothesis field `foo-260501-100000 (data) → bar-260502-150000`
- **WHEN** the field is parsed
- **THEN** exactly `foo-260501-100000` and `bar-260502-150000` are extracted,
  as before

#### Scenario: Membership slug check covers every discovered Run
- **GIVEN** Experiment `E0001-foo` declaring Run `bar.x-260501-100000`
- **WHEN** membership is computed
- **THEN** a `RUN_SLUG_PREFIX_VIOLATION` anomaly is reported for that Run
  just as for a Run whose name uses only letters, digits and underscores
