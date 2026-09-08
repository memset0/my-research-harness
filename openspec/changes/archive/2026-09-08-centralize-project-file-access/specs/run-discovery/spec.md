## ADDED Requirements

### Requirement: Run walk composes cached listings from project roots
Run discovery SHALL be the sole recursive project discovery exception, implemented as a composite walk through shared cached listDir operations rooted exclusively at logs/, outputs/, and experiments/ directly beneath each configured project root. Missing entry directories SHALL be skipped; the project root and unrelated subtrees SHALL NOT be enumerated. Default and configured excludes SHALL apply to entry directories and descendants. A recognized Run directory SHALL be recorded and never descended into, even without a README. Depth beneath these three entries SHALL remain unrestricted. Directory symlinks, including entry-directory symlinks, SHALL NOT be followed.

#### Scenario: Variable depth
- **WHEN** Runs exist at different depths under the project's logs/, outputs/, or experiments/
- **THEN** the walk discovers them through listDir and stops at each recognized Run

#### Scenario: Unrelated project directories
- **WHEN** other directories under the project root contain matching Run names
- **THEN** they are not visited or discovered, and absent permitted entry directories are skipped

#### Scenario: Run contains outputs
- **WHEN** a Run directory contains many output directories
- **THEN** discovery does not enumerate those descendants

#### Scenario: Warm walk
- **WHEN** a walk repeats while its directory observations are reusable
- **THEN** it composes cached listings rather than unconditionally repeating filesystem enumeration

### Requirement: Run dependencies use shared operation backoff
Run directory-list and README observations SHALL use the shared per-operation automatic backoff and configured active/inactive intervals, not an independent Run scan timer or watcher. Directory listings detect topology; README dependencies detect list-field changes.

#### Scenario: Quiet run discovery
- **WHEN** directory listings remain unchanged during automatic checking
- **THEN** their intervals double to the configured cap

#### Scenario: Changed status
- **WHEN** an existing Run README status changes without directory-entry changes
- **THEN** the Run list updates after the file check and frontend heartbeat

### Requirement: Human Run attention resets shared dependency schedules
Human detail operations SHALL reset the selected document's relevant schedules according to the file Store policy. Identity lists and discovery preparation SHALL remain automatic, including when needed by an opened document. This SHALL NOT opt an expanded Run README body into automatic refresh.

#### Scenario: Open experiment
- **WHEN** the user opens an experiment with associated Runs
- **THEN** explicitly requested detail dependencies receive attention, identity discovery remains automatic, and Run body refresh remains manual

### Requirement: Run identity bookkeeping derives records from file observations
The runtime SHALL retain lightweight Run identity/path and dependency bookkeeping, deriving Run records from cached file/list observations without a second long-lived domain-payload cache. Records SHALL preserve configured project membership, canonical Run metadata, missing README behavior, archived handling, distinct effective mtime and README locking mtime. Effective mtime SHALL NOT replace expectedMtime for writes.

#### Scenario: Missing README
- **WHEN** a recognized Run has no README
- **THEN** its derived record remains discoverable with UNKNOWN status, hasReadme false and readmeMtime zero

#### Scenario: Metadata changes
- **WHEN** a Run README observation changes
- **THEN** the next projection updates list metadata while preserving project identity and separate locking time

### Requirement: Identity inventories do not load content or membership
Navigation, discovered-identity counts and reference entry points SHALL use name/path inventories rather than rich Run or Experiment projections. Run inventory SHALL use the bounded directory walk without per-Run stat, README reads, archive/deprecation parsing or membership joins. Experiment inventory SHALL obtain canonical or legacy Markdown paths from one directory listing, preferring canonical folders on collisions. Explicit rich lists and details MAY read the metadata they actually display. No membership/result cache or filesystem-layout migration SHALL be introduced by this separation.

#### Scenario: Unreadable content still has an identity
- **WHEN** a canonically named Run or Experiment has a missing or unreadable README
- **THEN** its identity and path remain enumerable without reading that README, while an explicit detail request retains normal missing/error behavior

#### Scenario: Counting Runs
- **WHEN** the caller only needs the number of discovered Runs or their reference targets
- **THEN** the caller counts or resolves the identity inventory without computing Experiment membership or reading Run content

## REMOVED Requirements

### Requirement: Recursive scan from configured project roots
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Run walk composes cached listings from project roots" in this capability; preserve the public safety and data semantics stated there.

### Requirement: Polling with exponential backoff
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Run dependencies use shared operation backoff" in this capability; preserve the public safety and data semantics stated there.

### Requirement: Active-attention reset
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Human Run attention resets shared dependency schedules" in this capability; preserve the public safety and data semantics stated there.

### Requirement: In-memory run index
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Run identity bookkeeping derives records from file observations" in this capability; preserve the public safety and data semantics stated there.
