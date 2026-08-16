## ADDED Requirements

### Requirement: Experiment and run Open-with actions can launch the right split

The unified Open-with component used by experiment and run action stripes SHALL provide `Open in split view` after the enabled integration choices and before `Open in new window`. The action SHALL open the current default integration against the same experiment or run target that the drawer and popup actions use.

#### Scenario: Run picker includes the split action

- **GIVEN** an owner opens the Open-with picker for a run
- **WHEN** the picker renders
- **THEN** it includes `Open in split view` before `Open in new window`
- **AND** selecting it opens the current default integration against that run in the right split

#### Scenario: Experiment picker uses experiment identity

- **GIVEN** an owner opens the Open-with picker at experiment scope
- **WHEN** the owner selects `Open in split view`
- **THEN** the right terminal region opens using the experiment target identity

#### Scenario: Herdr uses the common Open-with presentation

- **GIVEN** Herdr is enabled alongside the tmux-backed choices
- **WHEN** the Open-with picker renders
- **THEN** the Herdr menu item uses the same text-only presentation as the peer agent items
- **AND** the main `Open with Herdr` action uses the common agent icon rather than a Herdr-specific extra icon
