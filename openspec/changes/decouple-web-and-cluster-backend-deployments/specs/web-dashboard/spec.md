## ADDED Requirements

### Requirement: Central dashboard presents configured Hosts and live Projects
In central mode, the dashboard SHALL show every configured Host with its explicit availability/compatibility state and SHALL show live Projects grouped or labelled by owning Host. Offline or unusable Hosts SHALL remain visible without stale Project payloads, and one Host failure SHALL not prevent other Host Projects from rendering.

#### Scenario: Offline Host remains visible
- **WHEN** Host A is offline and Host B is online
- **THEN** the dashboard shows Host A as offline, omits stale Host A Project data, and renders Host B normally

### Requirement: Central navigation is Host-qualified
Every central Project, run, Experiment, report, code-review, inbox, Git, terminal, and management link/action SHALL preserve the selected Host and Project. Equal names/IDs on two Hosts SHALL produce distinct links and state. Standalone routes SHALL remain project-only.

#### Scenario: Equal Project names open distinct pages
- **WHEN** two Hosts expose `project-x`
- **THEN** selecting each entry navigates to a different `/h/<host>/p/project-x/...` route and loads only that Host

### Requirement: Central mode never guesses an omitted Host
The UI SHALL NOT issue a Project/resource mutation without an exact Host selector. Legacy project-only navigation MAY redirect only for a unique live match; ambiguous navigation SHALL display a Host choice or error.

#### Scenario: Ambiguous legacy detail link is safe
- **WHEN** a project-only detail link could refer to two Hosts
- **THEN** no resource is loaded or mutated until the user selects a Host

### Requirement: Production central does not implicitly display mock Projects
A production central dashboard SHALL display mock Projects only when an explicit local Backend Host is configured. Development mock Backends SHALL be visibly Host-labelled and traverse the same API as remote Backends.

#### Scenario: No local Backend means no mock cards
- **WHEN** production central has only remote Host entries
- **THEN** repository fixtures do not appear in navigation or Project results
