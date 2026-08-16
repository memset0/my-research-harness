## ADDED Requirements

### Requirement: Terminal backends are independently enabled

The resolved terminal config SHALL expose `tmuxEnabled` and an optional Herdr
CLI alongside the existing ttyd tuning and tmux agent commands. Tmux SHALL
default to enabled when `terminal.tmux_enabled` is absent, preserving every
existing tmux terminal behavior. Herdr SHALL be enabled only when
`terminal.herdr` is present. A client with no enabled backend SHALL not issue
the ttyd availability probe for an Open-with control that will not render.

#### Scenario: Legacy config preserves tmux

- **GIVEN** a valid config written before this change with no `tmux_enabled` or `herdr` field
- **WHEN** it is loaded
- **THEN** `tmuxEnabled` is `true` and Herdr is disabled
- **AND** existing Terminal, Claude Code, Codex, and OpenCode behavior is unchanged

#### Scenario: Only Herdr is enabled

- **GIVEN** `terminal.tmux_enabled` is `false` and `terminal.herdr.cli` is configured
- **WHEN** the Open-with control renders
- **THEN** it offers Herdr and no tmux-backed agent choices
- **AND** its primary action opens Herdr even if local storage names a previous tmux agent

#### Scenario: Every backend disabled

- **GIVEN** `terminal.tmux_enabled` is `false` and `terminal.herdr` is absent
- **WHEN** a project, experiment, or run action bar renders
- **THEN** it renders no Open-with control and performs no ttyd probe

### Requirement: Shared ttyd manager supports tmux and Herdr entries

The ttyd manager SHALL apply the same loopback binding, authenticated proxy,
dynamic port allocation, per-key request serialization, LRU cap, idle TTL, and
process-exit cleanup to both backend kinds. Cleanup SHALL kill only the ttyd
client child; backend-owned durable processes SHALL remain alive.

#### Scenario: LRU evicts a Herdr ttyd client

- **GIVEN** the Herdr ttyd entry is the disconnected least-recently-used entry at the configured cap
- **WHEN** a new ttyd entry starts
- **THEN** the Herdr ttyd child is stopped
- **AND** no `herdr server stop` or tmux command is invoked

### Requirement: Open-with lists only enabled integrations

The unified Open-with picker SHALL preserve the existing tmux agent ordering
when tmux is enabled and append `Herdr` when Herdr is enabled. The stored
default MAY be either a tmux agent or Herdr; if it is no longer enabled, the
control SHALL select the first enabled backend deterministically. The popup
action SHALL open the currently selected backend.

#### Scenario: Both integrations enabled

- **GIVEN** tmux and Herdr are enabled
- **WHEN** the owner opens the picker
- **THEN** it lists `Terminal`, `Claude Code`, `Codex`, `OpenCode`, then `Herdr`, followed by the popup action
- **AND** all pre-existing tmux selections use their unchanged API and session naming
