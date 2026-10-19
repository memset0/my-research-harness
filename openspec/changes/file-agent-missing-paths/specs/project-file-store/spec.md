## MODIFIED Requirements

### Requirement: Empty missing and failed observations remain distinct
The Store SHALL distinguish a present empty file, a present empty directory, and a missing path. These successful outcomes SHALL be cached, timed and periodically rechecked. Access errors SHALL NOT become empty or missing results and SHALL NOT advance the last successful observation time. Agent path resolution SHALL expose a filesystem missing error when an authenticated source confirms absence after a generic resolution I/O failure; an unconfirmed failure SHALL remain an error.

#### Scenario: Missing becomes present
- **WHEN** a cached missing YAML file is later created
- **THEN** a due observation transitions it to present and invalidates dependent resource versions

#### Scenario: Empty stays cached
- **WHEN** an empty directory is requested repeatedly before its next check
- **THEN** the empty list is reused without repeated physical enumeration

#### Scenario: Unavailable mount
- **WHEN** a known storage mount is unavailable or a read fails
- **THEN** old successful data is retained with an unavailable/error state rather than a fabricated deletion

#### Scenario: Older agent resolves a deleted document
- **WHEN** a compatible agent reports a generic I/O error resolving a historical Run document and confirms that the same path is missing
- **THEN** callers receive a filesystem missing error and can retain the reference without failing the experiment list

#### Scenario: Failed resolution without confirmed absence
- **WHEN** resolution fails and the source still reports the path present, or the confirming request fails
- **THEN** the failure remains visible and no missing observation is fabricated
