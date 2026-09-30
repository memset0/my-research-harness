## ADDED Requirements

### Requirement: Generated timestamps carry the local offset

Every timestamp memon generates for a scan result, a membership anomaly, a synthesized Run `created_at`, a code-review `updated_at`, a commit-mark `updatedAt`, a rename `updated_at` or a project-store metric SHALL be ISO8601 with the writer's local timezone offset (`YYYY-MM-DDTHH:MM:SS±HH:MM`). None of them SHALL be a UTC `Z` timestamp. All of them SHALL come from one shared formatter so their shape cannot drift.

#### Scenario: Scan result is stamped with a local offset

- **WHEN** a project root is scanned
- **THEN** the result's `scannedAt` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$`

#### Scenario: Membership anomaly default detection time

- **WHEN** membership is computed without an explicit detection time
- **THEN** every anomaly's `detectedAt` carries a numeric offset and no `Z` suffix

#### Scenario: Code-review toggle writes a local timestamp

- **WHEN** a code-review commit or todo item is toggled through the central document service
- **THEN** the `updated_at` written to disk carries a numeric offset and no `Z` suffix
