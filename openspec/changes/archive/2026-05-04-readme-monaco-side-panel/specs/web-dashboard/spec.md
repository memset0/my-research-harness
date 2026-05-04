## MODIFIED Requirements

### Requirement: README inline editing with conflict-aware save

The detail page SHALL provide an "Edit README" mode that opens a markdown editor prefilled with the current README content. The editor's container SHALL be responsive to viewport width:

- **<1024px** (mobile + tablet): the editor opens inside a full-screen `<Dialog>` modal (preserving existing behavior).
- **≥1024px** (desktop): the editor opens as a right-side resizable panel beside the detail page body, NOT as a `<Dialog>`. The detail body remains visible in the left column. (See `experiment-edit` spec for panel collapse/expand/resize semantics.)

Saving SHALL go through `PUT /api/readme` carrying `expectedMtime` (and optional `expectedHash`) regardless of container.

#### Scenario: Successful save (mobile/tablet)
- **WHEN** the user is at viewport <1024px, edits, and saves; `expectedMtime` matches disk
- **THEN** the `<Dialog>` closes, the rendered detail view updates, and a success toast is shown

#### Scenario: Successful save (desktop)
- **WHEN** the user is at viewport ≥1024px, edits in the side panel, and saves; `expectedMtime` matches disk
- **THEN** the side panel remains open with cleared dirty state (does NOT auto-close — the user typically iterates), the rendered detail view updates, and a success toast is shown

#### Scenario: Conflict on save
- **WHEN** save returns 409 (in either container)
- **THEN** the editor enters a conflict resolution view showing a diff between the user's draft and the current disk content, with three options: "Keep my changes (overwrite)", "Discard mine (use disk)", "Cancel" / "Manual merge"
- **AND** the conflict view renders inside whichever container is active (Dialog on <1024px, side panel on ≥1024px)
