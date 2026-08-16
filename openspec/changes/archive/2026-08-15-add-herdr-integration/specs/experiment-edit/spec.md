## ADDED Requirements

### Requirement: Run Open-with picker includes enabled peer backends

The expanded run action stripe SHALL continue to use the unified Open-with
component. Its four existing tmux agent items SHALL remain unchanged when tmux
is enabled, and an enabled Herdr integration SHALL add a `Herdr` item whose
drawer and popup actions create-or-focus a run-labelled Herdr workspace.

#### Scenario: Run picker includes Herdr without replacing tmux

- **GIVEN** tmux and Herdr are enabled
- **WHEN** the owner opens a run panel's Open-with picker
- **THEN** all four existing tmux agent items remain in their existing order
- **AND** `Herdr` appears after them and opens a workspace labelled with the run ID
