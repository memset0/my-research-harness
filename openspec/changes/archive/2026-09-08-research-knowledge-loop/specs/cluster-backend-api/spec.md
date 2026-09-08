## ADDED Requirements

### Requirement: Central service mutations record activity without peer negotiation

Supported non-readonly project-service invocations SHALL record automatic activity while enforcing owner authorization, read-only project policy and path safety. Direct document submissions SHALL remain CLI-owned. This surface SHALL NOT require a remote Backend or advertise unimplemented evidence-review endpoints.

#### Scenario: Read-only project refuses a mutation
- **WHEN** a request attempts to mutate a read-only configured project
- **THEN** central rejects the research write without a remote capability probe

### Requirement: Journal authoring endpoints are removed

Central manual journal-append routes SHALL be removed along with their advertised schemas/capabilities and client helpers. Automatic native mutation receipts SHALL remain supported. New receipt diagnostic reads SHALL be owner-only; existing legacy Journal read scope SHALL not expand to include these receipts.

#### Scenario: Retired append endpoint
- **WHEN** an old client POSTs manual Journal prose
- **THEN** the request is rejected without creating legacy content or an activity receipt
