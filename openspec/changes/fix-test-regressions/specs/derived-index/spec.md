## MODIFIED Requirements

### Requirement: Index entries are validated before they outlive their window

Every entry SHALL carry the time it was last verified against its file. A reader SHALL NOT serve an entry whose file observation is older than 30 s without re-taking the file's fingerprint; when the fingerprint differs the entry SHALL be reloaded from the file. Central lists of FS11 Projects SHALL read the source-published catalogs, and detail consumers SHALL read the requested document itself on every request. A Run directory created outside memon SHALL appear in walk-based lists after the next walk validation.

#### Scenario: Script rewrites a Run status
- **GIVEN** a Run indexed as `RUNNING`
- **WHEN** a launch script rewrites its README to `status: FINISHED` without memon
- **THEN** central lists show `FINISHED` once its observation is re-taken (at most 30 s later), and the Run detail shows it on the next request

#### Scenario: git pull rewrites READMEs
- **WHEN** a pull changes 50 tracked Run READMEs
- **THEN** each changed entry is reloaded after its fingerprint is re-taken and no stale value survives past its window
