## ADDED Requirements

### Requirement: Warnings card draft autosave parity

The Warnings card's per-row Note edits and the in-progress Add-warning form contents SHALL be persisted to `localStorage` under key patterns parallel to the README editor's draft scheme:

- Pending row Note edits: `memon:warning-note-draft:<absolute README path>:<rowId>:<mtime opened>` storing the current textarea value, debounced ~500ms.
- Pending Add-warning form: `memon:warning-add-draft:<absolute README path>:<mtime opened>` storing `{category, message}`, debounced ~500ms.

Both key families SHALL participate in the existing 7-day stale draft cleanup (`memon:draft:*` glob is extended or paralleled to also match `memon:warning-*-draft:*`). On Warnings card open, drafts SHALL be restored if they correspond to the current `mtime`; otherwise they SHALL be silently discarded.

#### Scenario: Note edit autosaves while typing
- **WHEN** the user starts editing a Note cell on a RESOLVED row, types for 5 seconds, then closes the tab without submitting
- **THEN** the latest content (typed > 500ms before close) is in localStorage under `memon:warning-note-draft:<path>:<rowId>:<mtime>`

#### Scenario: Add-warning form autosaves
- **WHEN** the user opens the Add-warning form, picks a category, types a message, and closes the tab without submitting
- **THEN** the partial `{category, message}` is in localStorage under `memon:warning-add-draft:<path>:<mtime>`

#### Scenario: Stale warning drafts cleaned with the existing sweep
- **WHEN** the user opens any editor or Warnings card and `localStorage` contains a `memon:warning-*-draft:*` key with `savedAt > 7 days ago`
- **THEN** that key is deleted as part of the same 7-day cleanup sweep that handles README drafts

### Requirement: Warnings card uses the conflict-resolution dialog

When a Warnings card write returns `409 CONFLICT`, the existing README conflict-resolution dialog SHALL be reused (or a parallel dialog with identical UX). The dialog SHALL show the user's pending change (the row they were resolving / the form they were submitting) alongside the current server state, and SHALL offer the same "discard mine / replay mine on top of server's" choices.

The dialog SHALL preserve the pending edit as a draft (under the localStorage keys above) until the user explicitly discards it.

#### Scenario: Resolve hits CONFLICT, dialog opens, user replays
- **GIVEN** an OPEN warning row with the user mid-resolve at mtime M0
- **WHEN** the resolve PATCH returns 409 because mtime advanced to M1 (with an unrelated note edit on a different row)
- **THEN** the conflict dialog opens, shows both states, and on "replay mine" the resolve is re-attempted with `expectedMtime=M1` and the user's note text intact
