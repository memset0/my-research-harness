## ADDED Requirements

### Requirement: Experiment hypothesis references are validated like Run ones

The Experiment frontmatter parser SHALL validate `hypotheses` elements with
the same rule and diagnostics as the Run frontmatter parser: a non-string
element SHALL be dropped with an `INVALID_HYPOTHESIS_REF` warning, and a
string that is not canonical `H<NNNN>` SHALL be dropped with an
`INVALID_HYPOTHESIS_REF` warning naming the element.

#### Scenario: Non-string hypothesis element warns
- **GIVEN** an Experiment README with `hypotheses: [H0001, 7]`
- **WHEN** it is parsed
- **THEN** `hypotheses` is `["H0001"]` and an `INVALID_HYPOTHESIS_REF`
  warning reports the dropped non-string element
