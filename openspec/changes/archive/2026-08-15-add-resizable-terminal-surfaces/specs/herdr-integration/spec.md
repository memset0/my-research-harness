## MODIFIED Requirements

### Requirement: Herdr TUI is available through ttyd in drawer and popup surfaces

An owner SHALL be able to open the configured Herdr TUI from the sidebar in the root terminal drawer, in the docked right split, and in a chrome-less popup. All surfaces SHALL attach to a single manager-deduplicated ttyd entry whose command is the configured Herdr CLI. Closing or switching any browser surface, ttyd idle eviction, memon shutdown, or tmux management actions SHALL NOT stop the Herdr server or its pane processes.

#### Scenario: Sidebar opens the Herdr drawer

- **GIVEN** Herdr is configured and ttyd is available
- **WHEN** an owner clicks `Open Herdr` in the sidebar
- **THEN** the root drawer opens a ttyd-backed Herdr TUI
- **AND** closing the drawer does not issue a Herdr stop command

#### Scenario: Herdr opens in the right split

- **GIVEN** Herdr is configured on a desktop viewport
- **WHEN** an owner moves the Herdr drawer to `Split right` or selects the Herdr target's split action
- **THEN** the dashboard remains visible on the left and the Herdr TUI fills the right terminal region

#### Scenario: Herdr opens in a popup

- **GIVEN** Herdr is configured
- **WHEN** an owner chooses the Herdr popup action
- **THEN** a same-origin `/terminal-popup?integration=herdr` window opens with the Herdr TUI filling its viewport

#### Scenario: All Herdr surfaces reuse one ttyd

- **GIVEN** any Herdr surface already has a healthy ttyd entry
- **WHEN** the owner switches to or opens another Herdr surface
- **THEN** the new browser client receives the same proxy URL and ttyd port
- **AND** no second Herdr client process is spawned

#### Scenario: Drawer and popup reuse one ttyd

- **GIVEN** the Herdr drawer already has a healthy ttyd entry
- **WHEN** the Herdr popup opens
- **THEN** both surfaces receive the same proxy URL and ttyd port
- **AND** no second Herdr client process is spawned
