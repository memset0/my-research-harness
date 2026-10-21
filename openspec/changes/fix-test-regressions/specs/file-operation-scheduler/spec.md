## REMOVED Requirements

### Requirement: Human attention resets automatic backoff
**Reason**: Central no longer keeps persistent observations or long automatic backoff intervals; reuse is bounded at 30 s (see the published catalogs change).
**Migration**: Replaced by "Observation reuse is bounded and subscriptions poll from one second".

## ADDED Requirements

### Requirement: Observation reuse is bounded and subscriptions poll from one second
Central keeps no persistent observation cache. A completed observation SHALL be reused for at most 30 s; a read after that SHALL re-check the source before answering. Files and directories with an active subscription SHALL be checked from 1 s, with unchanged checks doubling their interval up to the 30 s bound, and human attention, manual refresh and known writes SHALL reset those intervals. Manual refresh SHALL bypass reuse for the selected document. Heartbeats SHALL NOT reset backoff. A completion from an older attention generation SHALL NOT undo a newer explicit reset.

#### Scenario: Collections are not human attention
- **WHEN** opening, focusing, or manually refreshing a document needs a collection for navigation, counts, main-content lists, or link resolution
- **THEN** the collection and its internal inventory work remain automatic, do not reset schedules as human demand, and cannot be promoted by a caller-supplied human reason
- **AND** the selected document retains its foreground reason, while mutation contexts retain write freshness

#### Scenario: Expired observation
- **WHEN** a file observed more than 30 s ago is read again
- **THEN** the source is checked before the read answers and a changed file is returned at once

#### Scenario: Subscribed file changes
- **WHEN** a subscribed file changes on the source
- **THEN** the subscriber is notified within the current interval, which starts at 1 s and never exceeds 30 s

#### Scenario: Late completion
- **WHEN** a human reset occurs while an earlier automatic check runs
- **THEN** that check cannot increase the newly reset interval
