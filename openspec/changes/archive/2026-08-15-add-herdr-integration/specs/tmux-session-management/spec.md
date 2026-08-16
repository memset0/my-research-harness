## ADDED Requirements

### Requirement: Tmux management is gated by terminal configuration

All existing tmux session-management requirements SHALL apply unchanged when
`terminal.tmux_enabled` is true. When it is false, `/manage/tmux` SHALL not
render the inventory, tmux-only APIs SHALL return a disabled/not-found response
before loading inventory or invoking the tmux executable, and Herdr entries
SHALL not appear in tmux inventory.

#### Scenario: Tmux remains enabled by default

- **GIVEN** `terminal.tmux_enabled` is omitted
- **WHEN** the owner opens `/manage/tmux`
- **THEN** the existing inventory, create, attach, rename, and kill behavior is unchanged

#### Scenario: Disabled tmux does no tmux work

- **GIVEN** `terminal.tmux_enabled` is `false`
- **WHEN** a client requests the tmux management page or any `/api/tmux-sessions` route
- **THEN** no tmux discovery or mutation command is invoked
- **AND** the route reports that the integration is disabled or unavailable
