## ADDED Requirements

### Requirement: Sidebar footer exposes enabled terminal integrations

For owners, the sidebar footer SHALL show `Manage tmux` only while tmux is
enabled and SHALL show `Open Herdr` plus a Herdr popup affordance only while
Herdr is enabled. Viewers SHALL see neither shell-capable integration. Existing
Slurm footer behavior SHALL remain unchanged.

#### Scenario: Both footer integrations enabled

- **GIVEN** the owner runtime config enables tmux and Herdr
- **WHEN** a project page renders
- **THEN** the footer contains the existing `Manage tmux` link and an `Open Herdr` launcher

#### Scenario: Tmux footer is hidden when disabled

- **GIVEN** tmux is disabled and Herdr is enabled
- **WHEN** the sidebar renders
- **THEN** `Manage tmux` is absent and `Open Herdr` remains available

#### Scenario: Viewer has no shell launcher

- **GIVEN** the session role is viewer
- **WHEN** the sidebar renders
- **THEN** neither the tmux management link nor Herdr drawer/popup actions are present
