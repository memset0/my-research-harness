## MODIFIED Requirements

### Requirement: Structured sections share deterministic readable projections

Core SHALL expose one normalized model and deterministic display/Markdown projection. CLI, standalone Web, and central-through-Backend Web SHALL use that same projection. Specialized components SHALL consume sanitized normalized Implementation, Investigation, and Results models rather than parse generated Markdown. A valid current v6 payload MUST NOT be rendered through the legacy Method/Plan/Caveats fallback.

#### Scenario: CLI and web projection agree
- **WHEN** the same valid v6 Experiment is read by CLI, standalone Web, and central through a Backend
- **THEN** all expose equivalent canonical section order, Implementation/Investigation hierarchy, Results Variants, IDs, statuses, dependencies, links, outcomes, and diagnostics
- **AND** deprecated Plan/Caveats sections are absent unless preserved as explicitly unsupported source content
