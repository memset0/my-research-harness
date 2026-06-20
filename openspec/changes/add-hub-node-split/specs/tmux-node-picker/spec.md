## ADDED Requirements

### Requirement: Node single-select on the tmux management page
The `/manage/tmux` page SHALL present a single-select of connected nodes that declare the `tmux` capability. Selecting a node SHALL scope the displayed tmux session list to that node.

#### Scenario: Picker lists tmux-capable nodes
- **WHEN** two connected nodes both share tmux
- **THEN** the page shows a single-select listing both nodes by name, and selecting one shows only that node's sessions

#### Scenario: Non-tmux node is absent from the picker
- **WHEN** a connected node declares `capabilities.tmux = false`
- **THEN** it does not appear in the node single-select

### Requirement: Tmux session listing is node-scoped
Listing tmux sessions SHALL carry a node selector; the hub SHALL forward the `tmux ls` enumeration to the selected node and return its sessions.

#### Scenario: List reflects the selected node
- **WHEN** the user selects node N in the picker
- **THEN** the session list reflects `tmux ls` executed on N — its sessions, not another node's

### Requirement: Node-scoped terminal attach over localhost
Starting or attaching a terminal SHALL target the selected node. On localhost (hub and node share the loopback), the hub SHALL proxy `/api/terminal/proxy/*` to the selected node's ttyd loopback port (resolved via the node) so the terminal is interactive, without any cross-machine tunnel.

#### Scenario: Attach yields a working local terminal
- **WHEN** the user attaches a session on the local node
- **THEN** the hub proxies the terminal WebSocket to the node's loopback ttyd port and the user gets an interactive terminal
