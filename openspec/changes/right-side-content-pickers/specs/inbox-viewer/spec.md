## MODIFIED Requirements

### Requirement: Desktop Report inbox layout (≥ md breakpoint)

The dashboard SHALL provide an inbox-shaped layout for browsing per-project
markdown artifact families. On viewports at the `md` breakpoint or wider, the
layout SHALL render two columns by default: a left pane (flex) holding the
rendered markdown of the currently selected item, and a right rail (~280–320 px)
holding a scrollable list of items. The active item in the rail SHALL be visually
highlighted.

On Report routes, the desktop rail SHALL include an accessible control that
lets the user hide it. Hiding the rail SHALL remove it from the layout and let
the reading pane reclaim the available width. A corresponding accessible control
SHALL remain visible in the reading pane so the user can show the rail again. The
rail SHALL be shown by default when the Report inbox mounts.

When the user clicks Edit, the layout SHALL add a Monaco editor to the right of
the rendered markdown and to the left of the list rail. This produces three
columns when the list rail is shown and two columns when a Report user has hidden
the list rail. Closing the editor (Save or Cancel) SHALL preserve the current
Report rail visibility and remove the editor.

#### Scenario: Two-column read mode default

- **WHEN** the user opens an inbox URL at desktop width
- **THEN** the layout renders the reading pane (rendered markdown of the selected
  item, or empty-state if none selected) on the left and the rail (file list) on
  the right
- **AND** no Monaco editor is mounted

#### Scenario: Report picker can be hidden and restored

- **GIVEN** the user opens a Report detail route at desktop width
- **WHEN** the user activates the Hide reports control
- **THEN** the Report rail is removed and the rendered Report pane expands into
  the reclaimed width
- **AND** a Show reports control remains visible and keyboard accessible
- **WHEN** the user activates Show reports
- **THEN** the Report rail returns on the right with the same active Report selected

#### Scenario: Switch to three-column edit mode

- **GIVEN** the user is reading a Report at desktop width
- **WHEN** the user clicks the Edit button in the reading pane's header
- **THEN** the layout adds a Monaco editor pane (~440 px) to the right of the
  rendered markdown and left of the rail, and the rendered markdown stays visible
  as a live preview
- **AND** the editor mounts with the current file's content as its initial value
- **AND** the layout has three columns when the Report rail is shown and two
  columns when it is hidden

#### Scenario: Return to read mode on save

- **WHEN** the user clicks Save in the editor and the write succeeds
- **THEN** the editor pane unmounts and the rendered markdown updates to reflect
  the saved content
- **AND** a Report rail returns to its pre-edit shown or hidden state

## ADDED Requirements

### Requirement: Report content filters form one icon row

The Report rail and the mobile Report list SHALL render the category, freshness
and presentation filters as one row of three equal-width selects. Each select
SHALL show a distinct icon identifying its filter and its current value, shown as
`All` when that filter is not narrowing the list, truncated to fit. Each select
SHALL keep an accessible name and a tooltip naming its filter. The available
options and the filtering result SHALL be unchanged.

#### Scenario: Filters share one row

- **WHEN** the Report rail renders at desktop width
- **THEN** the category, freshness and presentation selects appear side by side
  in one row, each with its own icon
- **AND** each select is announced by its filter name

#### Scenario: Selected value replaces All

- **WHEN** the reader selects `STALE` in the freshness filter
- **THEN** that select shows its icon with `STALE` and the list narrows as before
