## ADDED Requirements

### Requirement: Experiment document reads use a document-sized response bound

The Backend SHALL bound the JSON response of the Experiment detail read and the Experiment Results snapshot read by a 16 MiB document response limit instead of the 1 MiB control-response limit that bounds other Project data reads. A detail or Results snapshot response over 16 MiB SHALL still answer `500` with code `PAYLOAD_TOO_LARGE` and a bounded error body. Every other route SHALL keep its existing response bound, and the Run list SHALL keep paging to fit its bound.

#### Scenario: Large Results document is served
- **GIVEN** an Experiment whose Results snapshot serializes to more than 1 MiB and less than 16 MiB of JSON
- **WHEN** central serves its detail and its Results snapshot
- **THEN** both answer `200` with the complete document

#### Scenario: Oversized document stays bounded
- **GIVEN** an Experiment whose detail serializes to more than 16 MiB of JSON
- **WHEN** central serves its detail
- **THEN** the response is `500` with code `PAYLOAD_TOO_LARGE`

#### Scenario: Other reads keep the control bound
- **GIVEN** a Run list page whose JSON would exceed 1 MiB
- **WHEN** the Backend answers it
- **THEN** the response is `500` with code `PAYLOAD_TOO_LARGE`, as before
