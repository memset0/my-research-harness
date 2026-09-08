## ADDED Requirements

### Requirement: Foreground polling serves stale content before verification
Document/list resources SHALL return available cached content immediately and schedule appropriate file checks independently. Foreground heartbeats SHALL return semantic changed/unchanged plus freshness and queue/error status. No proactive document/list push SHALL be required or opened. Hidden or unfocused pages SHALL stop periodic resource requests; opening or reactivating SHALL trigger human attention for documents, never collections.

#### Scenario: Warm open then edit
- **WHEN** a cached Report is opened after an external edit
- **THEN** cached content renders first; after file checking a later heartbeat returns changed content

#### Scenario: No semantic change
- **WHEN** a file check changes only metadata or equivalent source formatting
- **THEN** the frontend does not replace content or display an update toast

#### Scenario: Background activation
- **WHEN** a hidden Wiki page becomes visible and focused
- **THEN** it immediately sends human attention and resumes the shared heartbeat

### Requirement: Refresh coverage is unified with manual Run bodies
Experiment documents and all three managed YAML tables, Wiki lists/details and current component dependencies, Reports, Run lists and other metadata resources SHALL use one resource polling lifecycle. Results-specific refresh timers SHALL be removed. Run README bodies SHALL load initially and through manual refresh only, not on heartbeat, focus or parent-list invalidation.

All collection GET/HEAD requests SHALL be classified as automatic on both client and server, including navigation, tab counts, main-content lists, and link-resolution inventories. Manual/focus resource pulses SHALL exclude collection queries; automatic heartbeats MAY continue refreshing them. An existing in-flight batch remains shared rather than being duplicated or having its collection requests promoted. Mutations SHALL retain write priority. This policy SHALL NOT introduce a second result cache or change primitive-cache TTLs or independent Git-status polling.

#### Scenario: Results changes
- **WHEN** results.yaml changes while the experiment page is active
- **THEN** the common resource refresh updates the table without an independent table timer

#### Scenario: Run list changes
- **WHEN** a Run status changes while its body is open
- **THEN** the list may update but the displayed Run body remains unchanged until manual refresh

### Requirement: Resource updates preserve user state
The client SHALL apply only current-page, non-obsolete responses, preserve scroll/expansion/table interaction state, and never overwrite unsaved editor text. A changed rendered content batch SHALL show one small update notification; first load and status-only changes SHALL not.

#### Scenario: Old response arrives
- **WHEN** a response from a previous page or older resource generation arrives
- **THEN** it is ignored rather than replacing newer content

#### Scenario: Unsaved editor
- **WHEN** new filesystem content is observed while an editor has local changes
- **THEN** the editor buffer is preserved and conflict/update state is shown

### Requirement: Hydrated resources register attention without duplicate content fetches
Production SSR and browser hydration SHALL share resource versions and avoid duplicate initial content fetches. Page-open attention SHALL be registered once without requiring a duplicate payload request. Subsequent visible-and-focused heartbeats SHALL query semantic versions through the common resource protocol, replacing independent per-query document timers.

#### Scenario: Hydrated page
- **WHEN** a page hydrates a prefetched resource
- **THEN** content renders without duplicate initial payload fetch and a single attention lifecycle starts

#### Scenario: Version changed
- **WHEN** a later heartbeat reports a different semantic version
- **THEN** the client obtains or applies the returned new resource data

## REMOVED Requirements

### Requirement: Single SSE connection from the root layout
**Reason**: The remote Backend hosting model is retired.
**Migration**: Document/list updates use foreground resource heartbeat queries; dedicated log streaming remains separate and preserves its byte-stream behavior.

### Requirement: Cache invalidation on experiment-change
**Reason**: The remote Backend hosting model is retired.
**Migration**: Document/list updates use foreground resource heartbeat queries; dedicated log streaming remains separate and preserves its byte-stream behavior.

### Requirement: Experiment-doc and anomaly SSE topics
**Reason**: The remote Backend hosting model is retired.
**Migration**: Document/list updates use foreground resource heartbeat queries; dedicated log streaming remains separate and preserves its byte-stream behavior.

### Requirement: Central fans Backend events into one browser SSE stream
**Reason**: The remote Backend hosting model is retired.
**Migration**: Document/list updates use foreground resource heartbeat queries; dedicated log streaming remains separate and preserves its byte-stream behavior.

### Requirement: One Backend stream failure does not close aggregate SSE
**Reason**: The remote Backend hosting model is retired.
**Migration**: Document/list updates use foreground resource heartbeat queries; dedicated log streaming remains separate and preserves its byte-stream behavior.

### Requirement: Event gaps cause Host-wide resynchronization
**Reason**: The remote Backend hosting model is retired.
**Migration**: Document/list updates use foreground resource heartbeat queries; dedicated log streaming remains separate and preserves its byte-stream behavior.

### Requirement: Event streams are bounded and live
**Reason**: The remote Backend hosting model is retired.
**Migration**: Document/list updates use foreground resource heartbeat queries; dedicated log streaming remains separate and preserves its byte-stream behavior.

### Requirement: SSR-prefetched queries do not refetch on hydration
**Reason**: The old requirement depends on the retired hosting, parsed-cache or event model.
**Migration**: Replace it with "Hydrated resources register attention without duplicate content fetches" in this capability; preserve the public safety and data semantics stated there.
