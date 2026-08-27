## ADDED Requirements

### Requirement: Central data page titles identify Host and Project
In central mode, page titles for Project-scoped runs, Experiments, reports, reviews, inbox entries, Git views, tmux, and terminals SHALL include enough Host and Project identity to distinguish equal names across Hosts. Standalone titles SHALL preserve their existing form.

#### Scenario: Equal Project names produce distinct titles
- **WHEN** two tabs show `project-x` on Host A and Host B
- **THEN** their document titles visibly distinguish Host A from Host B

### Requirement: Host failure title remains contextual
When direct navigation targets an unusable Host, the error page title SHALL retain the requested Host/Project context rather than falling back to a generic or another Host's title.

#### Scenario: Offline direct link keeps identity
- **WHEN** a bookmarked Host-qualified Project URL is opened while that Host is offline
- **THEN** the title identifies the requested Host/Project and the page shows its availability state
