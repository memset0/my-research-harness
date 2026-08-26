## ADDED Requirements

### Requirement: Embedded ttyd terminals support reliable text copying

Every shared `TerminalView` SHALL preserve ttyd/xterm's native auto-copy-on-selection behavior in tmux-backed and Herdr-backed sessions across drawer, right split, popup, and management surfaces. The ttyd iframe SHALL declare clipboard permission. Plain `Ctrl+C` SHALL remain terminal input, while `Ctrl+Shift+C` and `Cmd+C` SHALL copy the current selection again without forwarding the copy shortcut to the terminal process.

The view SHALL use xterm's native selection behavior and SHALL NOT expose a separate Copy mode. Ordinary drag SHALL select and auto-copy through ttyd when terminal mouse reporting is inactive. When a tmux or Herdr TUI enables mouse reporting, ordinary drag SHALL remain available to the TUI and xterm's standard `Shift+drag` gesture SHALL force local text selection that ttyd auto-copies on selection change.

#### Scenario: Copy shortcut does not interrupt the process
- **GIVEN** a ttyd terminal has a text selection
- **WHEN** the user presses `Ctrl+Shift+C` or `Cmd+C`
- **THEN** the selection is offered to the browser clipboard
- **AND** the shortcut is not forwarded to tmux, Herdr, or the foreground process

#### Scenario: Plain Ctrl+C remains terminal input
- **WHEN** the user presses plain `Ctrl+C`
- **THEN** the shared iframe bridge does not intercept it
- **AND** xterm can continue sending ETX to the foreground process

#### Scenario: Native Shift-drag selects from a mouse-reporting TUI
- **GIVEN** tmux or Herdr has enabled terminal mouse reporting
- **WHEN** the user holds Shift and drags with the primary mouse button
- **THEN** xterm performs its native forced text selection
- **AND** ttyd automatically copies the resulting selection without requiring another shortcut
- **AND** no memon-specific mouse mode is required

#### Scenario: Ordinary TUI mouse input remains unchanged
- **GIVEN** terminal mouse reporting is active
- **WHEN** the user drags without Shift
- **THEN** the event remains available to the TUI
- **AND** memon does not transform or intercept the mouse event

#### Scenario: Clipboard capability applies to every backend and surface
- **WHEN** any standard, raw tmux-attach, or Herdr `TerminalView` renders in drawer, split, popup, or management presentation
- **THEN** its ttyd iframe declares clipboard read/write permission
- **AND** the same native xterm selection and copy shortcut behavior is available
