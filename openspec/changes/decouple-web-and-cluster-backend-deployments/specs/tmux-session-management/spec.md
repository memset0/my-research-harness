## ADDED Requirements

### Requirement: Central tmux inventory and mutations are Host-scoped
In central mode, every tmux list, detail, create, rename, kill, stale classification, and pane-info request SHALL carry one Host selector and execute only on that Host's Backend. The management page SHALL select among Hosts whose negotiated capabilities enable tmux.

#### Scenario: List executes on selected Host
- **WHEN** the owner selects Host A on `/manage/tmux`
- **THEN** the page shows only sessions enumerated by Host A's Backend

#### Scenario: Rename cannot broadcast
- **WHEN** a rename request omits Host in central mode
- **THEN** central rejects it and no Backend session changes

### Requirement: Tmux session identity includes Host
Client query keys, URL state, row keys, cached terminal views, popup targets, and BroadcastChannel messages SHALL distinguish `{host, sessionName}`. Equal session names on different Hosts SHALL coexist without collision.

#### Scenario: Killing one equal-name session is isolated
- **WHEN** Host A and Host B both contain session `work` and the owner kills Host A's session
- **THEN** Host B's session and cached terminal remain unchanged

### Requirement: Host state gates tmux controls
Tmux controls SHALL be unavailable with an explicit reason when the selected Host is offline, incompatible, authentication-failed, or does not advertise tmux. Another usable Host's controls SHALL remain available.

#### Scenario: Capability-disabled Host is not selectable
- **WHEN** a usable Backend reports `tmux: false`
- **THEN** it does not appear as a tmux target and receives no tmux request
