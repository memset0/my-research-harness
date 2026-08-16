## ADDED Requirements

### Requirement: Report picker visibility persists across visits

The shown/hidden state of the desktop Report picker SHALL be a user preference
shared across Report inbox routes and projects. With no saved preference, the
picker SHALL default to shown. When a user hides or shows the picker, the UI
SHALL update immediately and the chosen state SHALL be restored after switching
Reports, switching projects, remounting the inbox, or reloading the page.

The preference SHALL use the dashboard's browser-first preference behavior. For
an authenticated owner, a stored server preference SHALL reconcile through the
existing owner-keyed UI-preferences store. Viewer and anonymous sessions SHALL
remain browser-local and SHALL NOT read or write owner preference storage.

This preference SHALL control only the desktop Report rail. The mobile
Report-list Sheet and all Digest rails SHALL retain their existing behavior.

#### Scenario: First visit defaults to shown

- **GIVEN** no Report picker preference exists in browser or owner storage
- **WHEN** the user opens a Report inbox route at desktop width
- **THEN** the Report picker is shown

#### Scenario: Hidden preference survives Report navigation and reload

- **GIVEN** the user hides the desktop Report picker
- **WHEN** the user switches to another Report or reloads the Report route
- **THEN** the desktop Report picker remains hidden
- **AND** its Show reports control remains available

#### Scenario: Restored picker state is saved immediately in the browser

- **GIVEN** the saved Report picker preference is hidden
- **WHEN** the user activates Show reports
- **THEN** the picker appears without waiting for a server request
- **AND** a subsequent inbox mount restores the shown state

#### Scenario: Invalid stored value falls back safely

- **GIVEN** browser or owner preference storage contains a non-boolean Report
  picker value
- **WHEN** the Report inbox resolves that preference
- **THEN** the picker uses the default shown state
- **AND** the invalid value does not create an indeterminate layout

#### Scenario: Owner preference reconciles across browsers

- **GIVEN** an authenticated owner's server preference records the Report
  picker as hidden
- **WHEN** the owner opens a Report route in a browser with no preference or a
  conflicting shown preference
- **THEN** the server value becomes authoritative and the picker resolves to
  hidden

#### Scenario: Viewer preference remains browser-local

- **GIVEN** a viewer or anonymous session changes the Report picker preference
- **WHEN** the preference is saved
- **THEN** only browser storage is updated
- **AND** no owner UI-preference row is read or written

#### Scenario: Mobile and Digest navigation are unaffected

- **GIVEN** the persisted desktop Report picker preference is hidden
- **WHEN** the user opens the Report inbox below the desktop breakpoint or opens
  a Digest inbox
- **THEN** the mobile Report-list Sheet remains available
- **AND** the Digest desktop rail remains visible

### Requirement: Collapsed Report identity opens a quick switcher

When a selected Report is displayed at desktop width and the Report picker is
hidden, the toolbar's current Report identity SHALL combine the Report ID and
slug into an accessible quick-switch trigger, for example `R0001
fastvideo-fa4-nvfp4-inference`. Activating it SHALL open a shadcn-styled Popover
containing a compact, vertically scrollable list of the current project's
Reports.

Each Popover item SHALL be a native link to the existing Report detail route,
SHALL expose its ID, slug, and title, and SHALL use a distinct selected treatment
plus `aria-current="page"` for the current Report. Selecting another Report SHALL
close the Popover and navigate while leaving the persisted picker state hidden.
The Popover SHALL support keyboard activation, visible focus, Escape/outside
dismissal, and focus return to its trigger.

While the Report list query is still pending, the Popover SHALL show the same
list loading treatment as the full rail rather than an incorrect empty-list
message.

When the desktop picker is shown, the Report identity SHALL remain ordinary
toolbar metadata and SHALL NOT open a duplicate quick switcher. On mobile, the
identity SHALL remain non-interactive and the existing Report-list Sheet SHALL
remain the switching surface. Digest toolbars SHALL NOT gain this trigger.

#### Scenario: Collapsed identity opens the Report list

- **GIVEN** the desktop Report picker is hidden while `R0001
  fastvideo-fa4-nvfp4-inference` is selected
- **WHEN** the user activates the current Report identity
- **THEN** a Popover opens with the project's available Reports
- **AND** `R0001` is marked as the current native link

#### Scenario: Quick switch navigates without expanding the rail

- **GIVEN** the quick-switch Popover is open and another Report `R0002` is
  available
- **WHEN** the user activates the `R0002` link
- **THEN** the Popover closes and navigation targets the existing `R0002`
  detail URL
- **AND** the persisted desktop Report picker preference remains hidden

#### Scenario: Long Report lists scroll inside the Popover

- **GIVEN** the project has more Reports than fit in the Popover's bounded
  viewport height
- **WHEN** the quick switcher opens
- **THEN** the list scrolls vertically inside the Popover
- **AND** the surrounding Report document does not need to scroll to reach every
  option

#### Scenario: Keyboard dismissal returns focus

- **GIVEN** the quick-switch Popover was opened from the current Report identity
- **WHEN** the user presses Escape
- **THEN** the Popover closes
- **AND** keyboard focus returns to the identity trigger

#### Scenario: Expanded, mobile, and Digest identities stay non-interactive

- **WHEN** the Report rail is expanded, the Report page is below the desktop
  breakpoint, or a Digest is selected
- **THEN** the current artifact identity does not expose the Report
  quick-switch trigger
- **AND** the existing desktop rail or mobile Sheet remains the applicable
  switching mechanism
