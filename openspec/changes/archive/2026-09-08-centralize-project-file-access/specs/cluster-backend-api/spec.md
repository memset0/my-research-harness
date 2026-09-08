## ADDED Requirements

### Requirement: Retired service boundary does not remove safety
Central SHALL enforce exact project authorization, read-only data mode, separately authorized share administration, path containment, runtime-validated public data and bounded streaming. Browser credentials SHALL never be forwarded to remote command targets. Ambiguous mutation failures SHALL not be automatically replayed.

#### Scenario: Viewer mutation
- **WHEN** a viewer requests a document write or shell operation
- **THEN** central rejects it before file or command access

#### Scenario: Read only data
- **WHEN** a read-only project receives a document write
- **THEN** the write is rejected; share administration remains separately governed and physical write errors are surfaced

### Requirement: Central detail preserves the safe v6 document contract
Central Experiment detail SHALL preserve ordered raw sections, sanitized Implementation/Investigation/Results data, canonical projections, diagnostics, read-only state and Results update metadata including bounded column/value annotations. It SHALL omit absolute filesystem authority. Lists SHALL remain summary-only. This contract SHALL not require a Backend HTTP request.

#### Scenario: Valid detail
- **WHEN** an experiment bundle parses successfully
- **THEN** central returns the data needed for canonical sections and Results without absolute paths

#### Scenario: Summary list
- **WHEN** the user requests experiment summaries
- **THEN** managed document bodies are omitted

## REMOVED Requirements

### Requirement: Backend read-only policy is enforced locally
**Reason**: The remote Backend hosting model is retired.
**Migration**: Retire private Backend listeners/authentication/DTO transport; central public routes retain owner/viewer checks, bounded data transport, path safety and read-only controls.

### Requirement: Backend exposes one versioned static API
**Reason**: The remote Backend hosting model is retired.
**Migration**: Retire private Backend listeners/authentication/DTO transport; central public routes retain owner/viewer checks, bounded data transport, path safety and read-only controls.

### Requirement: Backend uses independent service Bearer authentication
**Reason**: The remote Backend hosting model is retired.
**Migration**: Retire private Backend listeners/authentication/DTO transport; central public routes retain owner/viewer checks, bounded data transport, path safety and read-only controls.

### Requirement: Backend validates central actor authorization
**Reason**: The remote Backend hosting model is retired.
**Migration**: Retire private Backend listeners/authentication/DTO transport; central public routes retain owner/viewer checks, bounded data transport, path safety and read-only controls.

### Requirement: Backend DTOs and resource identifiers are safe and portable
**Reason**: The remote Backend hosting model is retired.
**Migration**: Retire private Backend listeners/authentication/DTO transport; central public routes retain owner/viewer checks, bounded data transport, path safety and read-only controls.

### Requirement: Backend transport streams with cancellation and bounds
**Reason**: The remote Backend hosting model is retired.
**Migration**: Retire private Backend listeners/authentication/DTO transport; central public routes retain owner/viewer checks, bounded data transport, path safety and read-only controls.

### Requirement: Backend event stream identifies continuity
**Reason**: The remote Backend hosting model is retired.
**Migration**: Retire private Backend listeners/authentication/DTO transport; central public routes retain owner/viewer checks, bounded data transport, path safety and read-only controls.

### Requirement: Experiment detail preserves the safe v6 document contract
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Central detail preserves the safe v6 document contract" in this capability; preserve the public safety and data semantics stated there.
