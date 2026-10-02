## MODIFIED Requirements

### Requirement: Refresh coverage is unified with manual Run bodies
Experiment documents, their managed YAML sidecars, the description file `experiment.json` and the generated Results summary, Wiki lists/details and current component dependencies, Reports, Run lists and other metadata resources SHALL use one resource polling lifecycle. Results-specific refresh timers SHALL be removed. Run README bodies SHALL load initially and through manual refresh only, not on heartbeat, focus or parent-list invalidation.

All collection GET/HEAD requests SHALL be classified as automatic on both client and server, including navigation, tab counts, main-content lists, and link-resolution inventories. Manual/focus resource pulses SHALL exclude collection queries; automatic heartbeats MAY continue refreshing them. An existing in-flight batch remains shared rather than being duplicated or having its collection requests promoted. Mutations SHALL retain write priority. The fingerprint-validated Results summary of `experiment-results-summary` is the only result cache; this policy SHALL NOT introduce any other result cache or change primitive-cache TTLs or independent Git-status polling.

#### Scenario: Results changes
- **WHEN** `experiment.json` or a member Run's `result.csv` changes while the experiment page is active
- **THEN** the common resource refresh updates the table, regenerating the summary when its inputs changed, without an independent table timer

#### Scenario: Run list changes
- **WHEN** a Run status changes while its body is open
- **THEN** the list may update but the displayed Run body remains unchanged until manual refresh
