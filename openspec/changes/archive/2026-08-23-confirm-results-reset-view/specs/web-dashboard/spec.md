## ADDED Requirements

### Requirement: Results view reset requires destructive confirmation

The Results `Reset view` toolbar action SHALL NOT modify browser, in-memory, or SQLite-backed preferences when first activated. It SHALL open an accessible confirmation dialog that states the action will clear the configured default sort, row filters, checkbox visibility, column order, pinning, row overrides, maximum line count, and temporary view/sort controls, and that the reset cannot be undone.

The dialog SHALL provide a non-destructive Cancel action and a visually destructive explicit confirmation. Initial focus SHALL favor Cancel. Cancel, close, overlay dismissal, and Escape SHALL close the dialog without modifying any Results preference or current table presentation. Only explicit confirmation SHALL replace the preference with defaults, clear temporary controls, close the dialog, update local presentation/localStorage immediately, and enqueue the owner SQLite update through the normal preference path.

Reset view SHALL remain disabled when the current persistent and temporary view already equals defaults.

#### Scenario: Accidental activation does not reset preferences

- **GIVEN** a user configured filters, hidden columns, and a default sort
- **WHEN** the user activates Reset view once
- **THEN** the confirmation dialog opens
- **AND** the table, localStorage, and SQLite write queue remain unchanged

#### Scenario: Cancel and Escape retain the configured view

- **GIVEN** the reset confirmation dialog is open
- **WHEN** the user chooses Cancel or presses Escape
- **THEN** the dialog closes
- **AND** every configured Results preference and temporary control remains unchanged

#### Scenario: Explicit confirmation performs one reset

- **GIVEN** the reset confirmation dialog is open for a non-default Results view
- **WHEN** the user activates the destructive confirmation
- **THEN** the complete Results view returns to defaults
- **AND** localStorage and owner SQLite receive the default preference through the existing persistence path
- **AND** the dialog closes and Reset view becomes disabled
