## ADDED Requirements

### Requirement: Standalone Results snapshot reports invalid results with the central status

Standalone `GET /api/experiments/:id/results` SHALL answer a `results.yaml`
that exists but fails to parse or validate with status `400`, the same status
central returns for that failure. The body SHALL keep its existing shape:
`{"error":{"code":"INVALID_RESULTS","message":…},"diagnostics":[…],"updatedAt":…}`.
A missing `results.yaml` SHALL remain `404` `RESULTS_NOT_FOUND`.

#### Scenario: Malformed results.yaml in standalone
- **GIVEN** an Experiment whose `results.yaml` is not valid YAML
- **WHEN** a standalone client requests its Results snapshot
- **THEN** the response is `400` with code `INVALID_RESULTS` and the parser
  diagnostics, instead of `422`
