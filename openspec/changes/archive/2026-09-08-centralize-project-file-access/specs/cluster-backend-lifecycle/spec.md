## ADDED Requirements

### Requirement: Remote installation contains no required Backend lifecycle
The remote memon installation SHALL provide CLI and managed skills without a required Backend worker, supervisor, protocol negotiation or fleet update service. Removed Backend commands SHALL not remain as compatibility shims that start the retired service.

#### Scenario: CLI only node
- **WHEN** a user installs or updates remote memon
- **THEN** the CLI and skills can operate without starting a memon listener

## REMOVED Requirements

### Requirement: Backend distribution is versioned and independently installable
**Reason**: The remote Backend hosting model is retired.
**Migration**: Remove Backend serving/daemon/token/distribution commands and use independent memon update for CLI/skills. Central service management remains local deployment configuration.

### Requirement: Native Backend lifecycle commands are complete and structured
**Reason**: The remote Backend hosting model is retired.
**Migration**: Remove Backend serving/daemon/token/distribution commands and use independent memon update for CLI/skills. Central service management remains local deployment configuration.

### Requirement: Native supervisor has single ownership and bounded restart
**Reason**: The remote Backend hosting model is retired.
**Migration**: Remove Backend serving/daemon/token/distribution commands and use independent memon update for CLI/skills. Central service management remains local deployment configuration.

### Requirement: Runtime state is safe on shared NFS homes
**Reason**: The remote Backend hosting model is retired.
**Migration**: Remove Backend serving/daemon/token/distribution commands and use independent memon update for CLI/skills. Central service management remains local deployment configuration.

### Requirement: Pinned update is preflighted, immutable, and reversible
**Reason**: The remote Backend hosting model is retired.
**Migration**: Remove Backend serving/daemon/token/distribution commands and use independent memon update for CLI/skills. Central service management remains local deployment configuration.

### Requirement: Activation verifies and rolls back automatically
**Reason**: The remote Backend hosting model is retired.
**Migration**: Remove Backend serving/daemon/token/distribution commands and use independent memon update for CLI/skills. Central service management remains local deployment configuration.

### Requirement: Foreground, native, and external supervision share one worker contract
**Reason**: The remote Backend hosting model is retired.
**Migration**: Remove Backend serving/daemon/token/distribution commands and use independent memon update for CLI/skills. Central service management remains local deployment configuration.
