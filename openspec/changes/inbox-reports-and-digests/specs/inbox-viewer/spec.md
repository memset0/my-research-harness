## ADDED Requirements

### Requirement: Desktop inbox layout (≥ md breakpoint)

The dashboard SHALL provide an inbox-shaped layout for browsing per-project markdown artifact families. On viewports at the `md` breakpoint or wider, the layout SHALL render two columns by default: a left rail (~280–320 px) holding a scrollable list of items, and a right pane (flex) holding the rendered markdown of the currently selected item. The active item in the rail SHALL be visually highlighted. When the user clicks Edit, the layout SHALL transition to three columns: list, rendered markdown, Monaco editor. Closing the editor (Save or Cancel) SHALL return to the two-column read mode.

#### Scenario: Two-column read mode default
- **WHEN** the user opens an inbox URL at desktop width
- **THEN** the layout renders the left rail (file list) and the right pane (rendered markdown of the selected item, or empty-state if none selected)
- **AND** no Monaco editor is mounted

#### Scenario: Switch to three-column edit mode
- **WHEN** the user clicks the Edit button in the right pane's header
- **THEN** the layout adds a Monaco editor pane (~440 px) to the right of the rendered markdown, and the rendered markdown stays visible as a live preview
- **AND** the editor mounts with the current file's content as its initial value

#### Scenario: Return to read mode on save
- **WHEN** the user clicks Save in the editor and the write succeeds
- **THEN** the editor pane unmounts, the layout returns to two columns, and the rendered markdown updates to reflect the saved content

### Requirement: Mobile inbox layout (< md breakpoint)

On viewports narrower than the `md` breakpoint, the layout SHALL render a single column showing the rendered markdown of the currently selected item (or an empty-state when none is selected). A floating action button (FAB) SHALL be anchored at `bottom-right` and SHALL be visible only on mobile (`md:hidden`). Tapping the FAB SHALL open a Sheet drawer from the right edge containing the same scrollable item list. Selecting an item from the drawer SHALL navigate to that item's URL and close the drawer.

#### Scenario: Mobile default view
- **WHEN** the user opens an inbox URL at viewport width < md
- **THEN** the layout shows only the rendered markdown of the currently selected item, with a FAB at bottom-right
- **AND** no list rail is visible

#### Scenario: FAB opens drawer
- **WHEN** the user taps the FAB
- **THEN** a Sheet slides in from the right showing the item list
- **AND** the rendered markdown remains in the background (faded by the Sheet's overlay)

#### Scenario: Drawer selection navigates and closes
- **WHEN** the user taps an item inside the drawer
- **THEN** the URL navigates to that item's detail route, the drawer closes, and the main content updates

### Requirement: Mobile edit mode is full-viewport

On mobile, tapping Edit SHALL open the Monaco editor in a full-viewport Sheet (`side="bottom"`, `h-[100svh]`) that covers the AppBar and the inbox layout below. The editor SHALL include a sticky toolbar with Save and Cancel buttons. Saving (success path) SHALL close the editor and refresh the rendered view; Cancel SHALL discard local edits and close.

#### Scenario: Mobile edit takeover
- **WHEN** the user taps Edit on mobile
- **THEN** a Sheet slides up from the bottom and covers the entire viewport including the AppBar
- **AND** Monaco is mounted inside the sheet with the current content

#### Scenario: Mobile save closes editor
- **WHEN** the user taps Save and the write succeeds
- **THEN** the sheet closes and the underlying rendered view shows the saved content

#### Scenario: Mobile cancel discards edits
- **WHEN** the user taps Cancel
- **THEN** the sheet closes immediately without writing; any unsaved typing is lost (no auto-save)

### Requirement: Optimistic locking on save

The editor SHALL submit writes with `expectedMtime` and `expectedHash` (sha1 of the content as last fetched). On a 409 CONFLICT response the UI SHALL show a toast indicating the on-disk content has changed since the editor opened, with a "Reload" action that re-fetches and re-mounts the editor with the fresh content. The user SHALL NOT silently overwrite a divergent on-disk version.

#### Scenario: Save under concurrent external write
- **GIVEN** the user has the editor open with the on-disk content as it was 30 seconds ago
- **WHEN** an external process (a skill, a `code` edit) writes the file in between, then the user clicks Save
- **THEN** the API returns 409 CONFLICT with the current on-disk mtime, hash, and content
- **AND** the UI shows a toast "External edit detected; click Reload to see the new content"
- **AND** the editor stays open with the user's unsaved typing intact until they click Reload

#### Scenario: Successful save updates the rendered view
- **WHEN** the user clicks Save and the API returns 200 with new mtime+hash
- **THEN** the editor closes and the rendered markdown view reflects the new content immediately (no second fetch needed)

### Requirement: Live updates from external writes

The inbox SHALL react to file additions, deletions, and content edits performed outside the dashboard (by a skill writing a new digest, or `code` editing a report) without a full-page reload. The trigger SHALL be the same SSE invalidation channel the existing Poller uses for experiments / journal / hypotheses, extended with `reports` and `digests` event kinds.

#### Scenario: New file appears in the rail
- **WHEN** a skill writes a new file matching the kind's filename pattern to the watched directory
- **THEN** within the polling backoff window, an SSE event fires and the rail re-renders with the new entry
- **AND** the user does not need to refresh

#### Scenario: External edit refreshes rendered view
- **WHEN** an external process edits the currently-selected file
- **THEN** the rendered markdown view updates to reflect the new content (assuming no editor is open; if the editor is open the user receives the conflict toast on save instead)

### Requirement: Empty state copy is kind-specific

When the watched directory is empty (no matching files yet), the inbox SHALL render an empty-state message tailored to the kind:
- For Reports: "No reports yet. Reports are written by `memon-write-report`; pick a hypothesis or set of experiments and ask the skill to summarize."
- For Digests: "No digests yet. Digests are written by `memon-digest-journal` and snapshot a date range from JOURNAL.md."

The kind-specific copy SHALL come from a prop on the shared layout component, not hardcoded inside it.

#### Scenario: Empty reports directory
- **WHEN** a project has no files matching `R<NNNN>-<slug>.md`
- **THEN** the right pane shows the Reports empty-state copy referencing `memon-write-report`
- **AND** the rail shows a small "no reports" placeholder

#### Scenario: Empty digests directory
- **WHEN** a project has no files matching `D<NNNN>-<YYYY-MM-DD>.md`
- **THEN** the right pane shows the Digests empty-state copy referencing `memon-digest-journal`
